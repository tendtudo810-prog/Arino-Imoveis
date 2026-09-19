// Lightbox compartilhado pelas páginas de detalhes
(function () {
    const lightbox = document.createElement("div");
    lightbox.className = "lightbox";
    const lightboxContent = document.createElement("div");
    lightboxContent.className = "lightbox-content";
    const lightboxImage = document.createElement("img");
    lightboxImage.className = "lightbox-image";
    const lightboxClose = document.createElement("button");
    lightboxClose.className = "lightbox-close";
    lightboxClose.type = "button";
    lightboxClose.textContent = "×";
    lightboxClose.setAttribute("aria-label", "Fechar");
    const lightboxPrev = document.createElement("button");
    lightboxPrev.className = "lightbox-nav prev";
    lightboxPrev.type = "button";
    lightboxPrev.textContent = "‹";
    lightboxPrev.setAttribute("aria-label", "Imagem anterior");
    const lightboxNext = document.createElement("button");
    lightboxNext.className = "lightbox-nav next";
    lightboxNext.type = "button";
    lightboxNext.textContent = "›";
    lightboxNext.setAttribute("aria-label", "Próxima imagem");
    const lightboxDots = document.createElement("div");
    lightboxDots.className = "lightbox-dots";

    lightboxContent.append(lightboxClose, lightboxPrev, lightboxImage, lightboxNext, lightboxDots);
    lightbox.appendChild(lightboxContent);
    document.body.appendChild(lightbox);

    let images = [];
    let currentIndex = 0;

    function updateLightbox() {
        if (!images.length) return;
        lightboxImage.src = images[currentIndex];
        lightboxImage.alt = `Imagem ${currentIndex + 1}`;
        lightboxDots.querySelectorAll(".lightbox-dot").forEach((dot, index) => {
            dot.classList.toggle("active", index === currentIndex);
        });
    }

    function moveLightbox(step) {
        if (!images.length) return;
        currentIndex = (currentIndex + step + images.length) % images.length;
        updateLightbox();
    }

    function createDots() {
        lightboxDots.innerHTML = "";
        images.forEach((_, index) => {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.className = "lightbox-dot";
            dot.setAttribute("aria-label", `Imagem ${index + 1}`);
            dot.addEventListener("click", () => {
                currentIndex = index;
                updateLightbox();
            });
            lightboxDots.appendChild(dot);
        });
    }

    function openLightbox(index) {
        if (!images.length) return;
        currentIndex = (index + images.length) % images.length;
        createDots();
        updateLightbox();
        lightbox.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function closeLightbox() {
        lightbox.classList.remove("active");
        document.body.style.overflow = "";
    }

    function initLightbox(sourceImages) {
        const imageElements = Array.from(sourceImages || []);
        images = imageElements.map((image) => image.currentSrc || image.src).filter(Boolean);
        imageElements.forEach((image, index) => {
            image.style.cursor = "pointer";
            image.onclick = (event) => {
                event.preventDefault();
                openLightbox(index);
            };
        });
    }

    lightboxPrev.addEventListener("click", () => moveLightbox(-1));
    lightboxNext.addEventListener("click", () => moveLightbox(1));
    lightboxClose.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (event) => {
        if (!lightbox.classList.contains("active")) return;
        if (event.key === "Escape") closeLightbox();
        if (event.key === "ArrowLeft") moveLightbox(-1);
        if (event.key === "ArrowRight") moveLightbox(1);
    });

    window.initLightbox = initLightbox;
    document.addEventListener("DOMContentLoaded", () => {
        initLightbox(document.querySelectorAll(".carousel-slide img"));
    });
})();
