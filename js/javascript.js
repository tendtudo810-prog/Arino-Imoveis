// Centralized redirect for property cards
// Change this value to update all property redirects in one place
const BASE_IMOVEL_URL = 'imovel-detalhado.html';

    document.addEventListener('DOMContentLoaded', () => {
    // Sistema de cards foi movido para inline no index.html
    // Este arquivo agora gerencia apenas FAQ e menu mobile

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

    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.header');

    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('is-open');
            menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            menuToggle.innerHTML = isOpen
                ? '<i class="fa-solid fa-xmark"></i>'
                : '<i class="fa-solid fa-bars"></i>';
        });

        navLinks.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('is-open');
                menuToggle.setAttribute('aria-expanded', 'false');
                menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
            });
        });
    }
});