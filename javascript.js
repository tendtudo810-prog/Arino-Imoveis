document.addEventListener('DOMContentLoaded', () => {
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
