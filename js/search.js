const tabs = document.querySelectorAll('.tab');
const searchInput = document.getElementById('searchInput');

function getRecentItems() {
  return document.querySelectorAll('.recent-item');
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(item => item.classList.remove('active'));
    tab.classList.add('active');
  });
});

getRecentItems().forEach(item => {
  const closeBtn = item.querySelector('button');

  closeBtn.addEventListener('click', event => {
    event.stopPropagation();
    item.style.transform = 'translateX(30px)';
    item.style.opacity = '0';

    setTimeout(() => {
      item.remove();
    }, 300);
  });
});

searchInput.addEventListener('input', () => {
  const value = searchInput.value.toLowerCase();

  getRecentItems().forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(value) ? 'flex' : 'none';
  });
});

document.querySelectorAll('.person-card').forEach(card => {
  card.addEventListener('click', () => {
    card.style.background = '#f4f4f4';

    setTimeout(() => {
      card.style.background = '#fff';
    }, 250);
  });
});