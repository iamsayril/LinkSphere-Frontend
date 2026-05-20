const cards = document.querySelectorAll('.log-card');

cards.forEach((card) => {
  card.addEventListener('click', () => {
    card.classList.remove('pulse');
    void card.offsetWidth;
    card.classList.add('pulse');
  });
});

const style = document.createElement('style');
style.textContent = `
  .pulse { animation: quickPulse .45s ease both !important; }
  @keyframes quickPulse {
    0% { transform: scale(1); }
    45% { transform: scale(.985); box-shadow: 4px 4px 0 #000; }
    100% { transform: scale(1); }
  }
`;
document.head.appendChild(style);