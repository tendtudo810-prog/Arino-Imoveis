
document.addEventListener("DOMContentLoaded", () => {
    const carousel = document.querySelector(".carousel");
    const carouselInner = document.querySelector("#carouselInner");
    const slides = document.querySelectorAll(".carousel .slide");

    const botaoVoltar = document.querySelector(".carousel .prev");
    const botaoAvancar = document.querySelector(".carousel .next");

    if (!carousel || !carouselInner || slides.length === 0) {
        console.error("Carrossel não encontrado.");
        return;
    }

    let slideIndex = 0;
    let autoplay;

    const intervalo = 5000;

    // Atualiza a posição do carrossel
    function atualizarSlide() {
        carouselInner.style.transform = `translateX(-${slideIndex * 100}%)`;
    }

    // Próximo ou anterior
    function mudarSlide(direcao) {
        slideIndex += direcao;

        if (slideIndex >= slides.length) {
            slideIndex = 0;
        }

        if (slideIndex < 0) {
            slideIndex = slides.length - 1;
        }

        atualizarSlide();
    }

    // Reinicia o autoplay
    function iniciarAutoplay() {
        clearInterval(autoplay);

        autoplay = setInterval(() => {
            mudarSlide(1);
        }, intervalo);
    }

    // Botão anterior
    if (botaoVoltar) {
        botaoVoltar.addEventListener("click", () => {
            mudarSlide(-1);
            iniciarAutoplay();
        });
    }

    // Botão próximo
    if (botaoAvancar) {
        botaoAvancar.addEventListener("click", () => {
            mudarSlide(1);
            iniciarAutoplay();
        });
    }

    // Pausa quando o mouse está sobre o carrossel
    carousel.addEventListener("mouseenter", () => {
        clearInterval(autoplay);
    });

    carousel.addEventListener("mouseleave", iniciarAutoplay);

    // Suporte a gestos de deslizar no celular
    let toqueInicial = 0;
    let toqueFinal = 0;

    carousel.addEventListener("touchstart", (event) => {
        toqueInicial = event.changedTouches[0].screenX;
    }, { passive: true });

    carousel.addEventListener("touchend", (event) => {
        toqueFinal = event.changedTouches[0].screenX;

        const diferenca = toqueInicial - toqueFinal;

        if (Math.abs(diferenca) > 50) {
            mudarSlide(diferenca > 0 ? 1 : -1);
            iniciarAutoplay();
        }
    }, { passive: true });

    // Estado inicial
    atualizarSlide();
    iniciarAutoplay();
});