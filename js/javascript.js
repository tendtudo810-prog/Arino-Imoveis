// Centralized redirect for property cards
// Change this value to update all property redirects in one place
const BASE_IMOVEL_URL = 'imovel-detalhado.html';

document.addEventListener('DOMContentLoaded', () => {
    const cards = document.querySelectorAll('.imovel-card');
    cards.forEach((card) => {
        const id = card.dataset.id;
        const url = id ? `${BASE_IMOVEL_URL}?id=${encodeURIComponent(id)}` : BASE_IMOVEL_URL;
        card.setAttribute('href', url);
    });

    const perguntas = document.querySelectorAll('.pergunta');

    perguntas.forEach((pergunta) => {
        pergunta.addEventListener('click', () => {
            const isOpen = pergunta.classList.contains('active');

            perguntas.forEach((item) => item.classList.remove('active'));

            if (!isOpen) {
                pergunta.classList.add('active');
            }
        });
    });
});