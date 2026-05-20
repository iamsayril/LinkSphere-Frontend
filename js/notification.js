const toast = document.getElementById('toast');
const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
};

document.querySelectorAll('.btn').forEach((button) => {
  button.addEventListener('click', () => showToast(`${button.textContent.trim()} selected`));
});

const pushSwitch = document.getElementById('pushSwitch');
pushSwitch.addEventListener('click', () => {
  pushSwitch.classList.toggle('active');
  showToast(pushSwitch.classList.contains('active') ? 'Push alerts on' : 'Push alerts off');
});

document.querySelectorAll('.priority').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.priority').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    showToast(`${button.dataset.priority} selected`);
  });
});

const activeCount = document.getElementById('activeCount');
document.querySelectorAll('.channel button').forEach((button) => {
  button.addEventListener('click', () => {
    const channel = button.closest('.channel');
    channel.style.opacity = '.45';
    channel.style.transform = 'translateX(12px)';
    button.textContent = 'Muted';
    button.disabled = true;
    const remaining = [...document.querySelectorAll('.channel button')].filter(btn => !btn.disabled).length;
    activeCount.textContent = `${remaining} Active`;
    showToast('Channel unmuted');
  });
});

document.querySelector('.add-channel').addEventListener('click', () => showToast('Add channel clicked'));

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('reveal');
  });
}, { threshold: 0.2 });

document.querySelectorAll('.feed-card,.push-card,.priority-card,.muted-card').forEach((item) => observer.observe(item));