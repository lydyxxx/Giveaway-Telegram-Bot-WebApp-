const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const { Pool } = require('pg');
const app = express();

const BOT_TOKEN = 'токенбота';
const CHANNEL_USERNAME = '@heartedtiktok';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const pool = new Pool({
  connectionString: 'бд'
});

const lastRequestTime = {};

app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  console.log('GET / - Serving index.html');
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/check_subscription', async (req, res) => {
  console.log('POST /check_subscription - Request body:', req.body);
  const { initData } = req.body;

  if (!initData) {
    console.log('No initData provided');
    return res.json({ success: false, message: 'Данные авторизации отсутствуют' });
  }

  const authData = new URLSearchParams(initData);
  const hash = authData.get('hash');
  authData.delete('hash');
  
  const dataCheckString = Array.from(authData.entries())
    .sort()
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    console.log('Invalid auth data');
    return res.json({ success: false, message: 'Неверные данные авторизации' });
  }

  const user = JSON.parse(authData.get('user'));
  const user_id = user.id;
  const username = user.username || `user_${user_id}`;
  console.log(`User ID: ${user_id}, Username: ${username}`);

  const now = Date.now();
  if (lastRequestTime[user_id] && now - lastRequestTime[user_id] < 5000) {
    return res.json({ success: false, message: 'Слишком много запросов, подождите' });
  }
  lastRequestTime[user_id] = now;

  try {
    const member = await bot.getChatMember(CHANNEL_USERNAME, user_id);
    console.log(`User status: ${member.status}`);

    if (['member', 'administrator', 'creator'].includes(member.status)) {
      const client = await pool.connect();
      try {
        const existingUser = await client.query('SELECT user_number FROM participants WHERE user_id = $1', [user_id]);
        if (existingUser.rows.length > 0) {
          return res.json({
            success: true,
            user_number: existingUser.rows[0].user_number,
            message: 'Вы уже участвуете!'
          });
        }

        const userCount = (await client.query('SELECT COUNT(*) FROM participants')).rows[0].count;
        const user_number = parseInt(userCount) + 1;

        await client.query(
          'INSERT INTO participants (user_id, username, user_number) VALUES ($1, $2, $3)',
          [user_id, username, user_number]
        );

        if (user_number >= 50) {
          const countdownCheck = await client.query('SELECT start_time FROM countdown WHERE id = 1');
          if (countdownCheck.rows.length === 0) {
            const countdownStartTime = new Date().toISOString();
            await client.query(
              'INSERT INTO countdown (id, start_time) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
              [countdownStartTime]
            );
          }
        }

        console.log(`User ${username} assigned number: ${user_number}`);
        return res.json({
          success: true,
          user_number: user_number
        });
      } finally {
        client.release();
      }
    } else {
      console.log(`User ${username} is not subscribed`);
      return res.json({
        success: false,
        message: 'Пожалуйста, подпишитесь на канал @heartedtiktok'
      });
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    if (e.response && e.response.statusCode === 429) {
      return res.json({ success: false, message: 'Слишком много запросов к Telegram, попробуйте позже' });
    }
    return res.json({ success: false, message: `Ошибка: ${e.message}` });
  }
});

app.get('/get_countdown', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const userCount = (await client.query('SELECT COUNT(*) FROM participants')).rows[0].count;
      const countdownCheck = await client.query('SELECT start_time FROM countdown WHERE id = 1');

      if (parseInt(userCount) < 50 || countdownCheck.rows.length === 0) {
        return res.json({
          countdownStarted: false,
          participants: parseInt(userCount)
        });
      }

      const startTime = new Date(countdownCheck.rows[0].start_time).getTime();
      const countdownDuration = 48 * 60 * 60 * 1000;
      const currentTime = new Date().getTime();
      const timeRemaining = Math.max(0, countdownDuration - (currentTime - startTime));

      return res.json({
        countdownStarted: true,
        timeRemaining: timeRemaining,
        participants: parseInt(userCount)
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(`Error in /get_countdown: ${e.message}`);
    return res.json({ countdownStarted: false, error: e.message });
  }
});

bot.onText(/\/info/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const client = await pool.connect();
    try {
      const user = await client.query('SELECT user_number FROM participants WHERE user_id = $1', [userId]);
      let userNumber = user.rows.length > 0 ? user.rows[0].user_number : null;

      const userCount = (await client.query('SELECT COUNT(*) FROM participants')).rows[0].count;
      const countdownCheck = await client.query('SELECT start_time FROM countdown WHERE id = 1');

      let message = '';
      if (parseInt(userCount) < 50 || countdownCheck.rows.length === 0) {
        message = `До начала розыгрыша нужно набрать 50 участников. Сейчас: ${userCount}/50.`;
      } else {
        const startTime = new Date(countdownCheck.rows[0].start_time).getTime();
        const countdownDuration = 48 * 60 * 60 * 1000;
        const currentTime = new Date().getTime();
        const timeRemaining = Math.max(0, countdownDuration - (currentTime - startTime));

        if (timeRemaining <= 0) {
          message = 'Розыгрыш завершён!';
        } else {
          const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
          const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
          message = `До розыгрыша осталось: ${hours}ч ${minutes}м ${seconds}с.`;
        }
      }

      if (userNumber) {
        message += `\nВаш номер участника: ${userNumber}.`;
      } else {
        message += '\nВы ещё не участвуете в розыгрыше. Подпишитесь на канал и зарегистрируйтесь!';
      }

      await bot.sendMessage(chatId, message);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(`Error in /info command: ${e.message}`);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
});

async function checkCountdownAndAnnounceWinner() {
  const client = await pool.connect();
  try {
    const countdownCheck = await client.query('SELECT start_time FROM countdown WHERE id = 1');
    if (countdownCheck.rows.length === 0) return;

    const startTime = new Date(countdownCheck.rows[0].start_time).getTime();
    const countdownDuration = 48 * 60 * 60 * 1000;
    const currentTime = new Date().getTime();
    const timeRemaining = countdownDuration - (currentTime - startTime);

    if (timeRemaining <= 0) {
      const winnerCheck = await client.query('SELECT winner_announced FROM countdown WHERE id = 1');
      if (winnerCheck.rows[0].winner_announced) return;

      const participants = await client.query('SELECT user_id, user_number FROM participants');
      if (participants.rows.length === 0) return;

      const winner = participants.rows[Math.floor(Math.random() * participants.rows.length)];
      const winnerNumber = winner.user_number;

      const allParticipants = await client.query('SELECT user_id FROM participants');
      for (const participant of allParticipants.rows) {
        try {
          await bot.sendMessage(
            participant.user_id,
            `Розыгрыш окончен, победителем оказался - номер участника: ${winnerNumber}.\nПоздравим победителя в комментариях!`
          );
        } catch (e) {
          console.error(`Failed to send message to user ${participant.user_id}: ${e.message}`);
        }
      }

      await client.query('UPDATE countdown SET winner_announced = TRUE WHERE id = 1');
    }
  } catch (e) {
    console.error(`Error in checkCountdownAndAnnounceWinner: ${e.message}`);
  } finally {
    client.release();
  }
}

setInterval(checkCountdownAndAnnounceWinner, 60 * 1000);

app.listen(3000, async () => {
  console.log('Server started and running on port 3000');
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        user_id BIGINT PRIMARY KEY,
        username TEXT NOT NULL,
        user_number INTEGER NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS countdown (
        id INTEGER PRIMARY KEY,
        start_time TIMESTAMP NOT NULL,
        winner_announced BOOLEAN DEFAULT FALSE
      )
    `);
    console.log('Database tables checked/created');
  } catch (e) {
    console.error(`Database setup error: ${e.message}`);
  } finally {
    client.release();
  }
});