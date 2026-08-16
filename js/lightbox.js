// Lightbox - Sistema de Ampliação de Imagens
(function() {
    // Criar elementos do lightbox
    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    
    const lightboxContent = document.createElement('div');
    lightboxContent.className = 'lightbox-content';
    
    const lightboxImage = document.createElement('img');
    lightboxImage.className = 'lightbox-image';
    
    const lightboxClose = document.createElement('button');
    lightboxClose.className = 'lightbox-close';
    lightboxClose.innerHTML = '×';
    lightboxClose.setAttribute('aria-label', 'Fechar');
    
    const lightboxPrev = document.createElement('button');
    lightboxPrev.className = 'lightbox-nav prev';
    lightboxPrev.innerHTML = '‹';
    lightboxPrev.setAttribute('aria-label', 'Imagem anterior');
    
    const lightboxNext = document.createElement('button');
    lightboxNext.className = 'lightbox-nav next';
    lightboxNext.innerHTML = '›';
    lightboxNext.setAttribute('aria-label', 'Próxima imagem');
    
    const lightboxDots = document.createElement('div');
    lightboxDots.className = 'lightbox-dots';
    
    lightboxContent.appendChild(lightboxClose);
    lightboxContent.appendChild(lightboxPrev);
    lightboxContent.appendChild(lightboxImage);
    lightboxContent.appendChild(lightboxNext);
    lightboxContent.appendChild(lightboxDots);
    lightbox.appendChild(lightboxContent);
    document.body.appendChild(lightbox);
    
    // Obter imagens do carousel da página atual
    const carouselImages = document.querySelectorAll('.carousel-slide img');
    let currentIndex = 0;
    let images = [];
    
    // Extrair URLs das imagens
    carouselImages.forEach((img) => {
        images.push(img.src);
    });
    
    // Criar bolinhas de navegação
    function createDots() {
        lightboxDots.innerHTML = '';
        images.forEach((_, index) => {
            const dot = document.createElement('button');
            dot.className = 'lightbox-dot';
            if (index === currentIndex) {
                dot.classList.add('active');
            }
            dot.setAttribute('aria-label', `Imagem ${index + 1}`);
            dot.addEventListener('click', () => {
                currentIndex = index;
                updateLightbox();
            });
            lightboxDots.appendChild(dot);
        });
    }
    
    // Atualizar lightbox
    function updateLightbox() {
        lightboxImage.src = images[currentIndex];
        
        // Atualizar bolinhas
        const dots = lightboxDots.querySelectorAll('.lightbox-dot');
        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === currentIndex);
        });
    }
    
    // Abrir lightbox
    function openLightbox(index) {
        currentIndex = index;
        createDots();
        updateLightbox();
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    
    // Fechar lightbox
    function closeLightbox() {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }
    
    // Navegação
    lightboxPrev.addEventListener('click', () => {
        currentIndex = (currentIndex - 1 + images.length) % images.length;
        updateLightbox();
    });
    
    lightboxNext.addEventListener('click', () => {
        currentIndex = (currentIndex + 1) % images.length;
        updateLightbox();
    });
    
    lightboxClose.addEventListener('click', closeLightbox);
    
    // Fechar ao clicar fora da imagem
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });
    
    // Navegação por teclado
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;
        
        if (e.key === 'Escape') {
            closeLightbox();
        } else if (e.key === 'ArrowLeft') {
            currentIndex = (currentIndex - 1 + images.length) % images.length;
            updateLightbox();
        } else if (e.key === 'ArrowRight') {
            currentIndex = (currentIndex + 1) % images.length;
            updateLightbox();
        }
    });
    
    // Adicionar clique nas imagens do carousel
    carouselImages.forEach((img, index) => {
        img.style.cursor = 'pointer';
        img.addEventListener('click', (e) => {
            e.preventDefault();
            openLightbox(index);
        });
    });
    
})();
