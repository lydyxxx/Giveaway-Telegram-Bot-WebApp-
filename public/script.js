const script = document.createElement('script');
script.src = 'https://telegram.org/js/telegram-web-app.js';
script.onload = () => console.log('Telegram Web App SDK loaded');
document.head.appendChild(script);

let countdownInterval;

function formatTimeRemaining(timeRemaining) {
  const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

async function updateCountdown() {
  try {
    const response = await fetch('/get_countdown');
    const data = await response.json();

    const countdownDiv = document.getElementById('countdown');
    if (!data.countdownStarted) {
      countdownDiv.innerHTML = `Ожидаем 50 участников (${data.participants}/50)`;
      countdownDiv.classList.add('waiting');
      countdownDiv.classList.add('show');
      return;
    }

    const timeRemaining = data.timeRemaining;
    if (timeRemaining <= 0) {
      countdownDiv.innerHTML = 'Розыгрыш завершён!';
      countdownDiv.classList.remove('waiting');
      countdownDiv.classList.add('show');
      clearInterval(countdownInterval);
      return;
    }

    countdownDiv.innerHTML = `До розыгрыша: ${formatTimeRemaining(timeRemaining)}`;
    countdownDiv.classList.remove('waiting');
    countdownDiv.classList.add('show');
  } catch (error) {
    console.error('Error fetching countdown:', error);
  }
}

async function checkSubscription(autoCheck = false) {
  const resultDiv = document.getElementById('result');
  const telegramNotice = document.getElementById('telegram-notice');
  const joinButton = document.getElementById('join-button');
  const description = document.getElementById('description');

  if (!autoCheck) {
    resultDiv.innerHTML = 'Проверка...';
    resultDiv.className = '';
    resultDiv.style.opacity = '1';
  }

  try {
    const initData = window.Telegram.WebApp.initData;
    if (!initData) {
      resultDiv.innerHTML = 'Ошибка: Это приложение должно быть запущено через Telegram';
      resultDiv.classList.add('error');
      setTimeout(() => resultDiv.classList.add('show'), 100);
      return;
    }

    const response = await fetch('/check_subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData })
    });
    const result = await response.json();

    if (result.success) {
      const user = JSON.parse(new URLSearchParams(initData).get('user'));
      const username = user.username || `user_${user.id}`;
      resultDiv.innerHTML = `
        <div class="user-info">
          <span>Ты в игре!</span>
          <span>Номер участника: ${result.user_number}</span>
          <span>Юзернейм: @${username}</span>
          <span>Удачи!</span>
        </div>
      `;
      resultDiv.classList.add('success');
      telegramNotice.classList.add('hidden');
      joinButton.classList.add('hidden');
      description.classList.add('hidden');

      localStorage.setItem('hasParticipated', 'true');
      localStorage.setItem('userNumber', result.user_number);
      localStorage.setItem('username', username);
    } else {
      resultDiv.innerHTML = result.message;
      resultDiv.classList.add('error');
      telegramNotice.classList.remove('hidden');
      joinButton.classList.remove('hidden');
      description.classList.remove('hidden');
    }
    setTimeout(() => resultDiv.classList.add('show'), 100);
  } catch (error) {
    resultDiv.innerHTML = `Ошибка: ${error.message}`;
    resultDiv.classList.add('error');
    telegramNotice.classList.remove('hidden');
    joinButton.classList.remove('hidden');
    description.classList.remove('hidden');
    setTimeout(() => resultDiv.classList.add('show'), 100);
  }
}

window.addEventListener('load', () => {
  if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.ready();

    const hasParticipated = localStorage.getItem('hasParticipated');
    if (hasParticipated === 'true') {
      const resultDiv = document.getElementById('result');
      const telegramNotice = document.getElementById('telegram-notice');
      const joinButton = document.getElementById('join-button');
      const description = document.getElementById('description');
      const userNumber = localStorage.getItem('userNumber');
      const username = localStorage.getItem('username');

      resultDiv.innerHTML = `
        <div class="user-info">
          <span>Ты в игре!</span>
          <span>Номер участника: ${userNumber}</span>
          <span>Юзернейм: @${username}</span>
          <span>Удачи!</span>
        </div>
      `;
      resultDiv.classList.add('success');
      telegramNotice.classList.add('hidden');
      joinButton.classList.add('hidden');
      description.classList.add('hidden');
      setTimeout(() => resultDiv.classList.add('show'), 100);
    } else {
      checkSubscription(true);
    }

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  }
});