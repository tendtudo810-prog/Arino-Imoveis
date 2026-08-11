const propertyData = {
  '1': {
    title: 'Casa moderna em condomínio',
    location: 'Brasília - DF',
    images: ['pic1/Anuncio 1 (6).jpeg', 'pic1/Anuncio 1 (7).jpeg', 'pic1/Anuncio 1 (8).jpeg'],
    description: 'Casa moderna em condomínio com 4 quartos, 3 banheiros, 2 vagas de garagem e área gourmet. Excelente conforto para a sua família em localização privilegiada.'
  },
  '2': {
    title: 'Apartamento com vista privilegiada',
    location: 'Águas Claras - DF',
    images: ['pic1/Anuncio 1 (6).jpeg', 'pic1/Anuncio 1 (7).jpeg', 'pic1/Anuncio 1 (8).jpeg'],
    description: 'Apartamento com vista privilegiada, 3 quartos, 2 banheiros, 2 vagas de garagem, varanda e piscina. Ótima localização para o seu dia a dia.'
  },
  '3': {
    title: 'Terreno amplo em localização estratégica',
    location: 'Brasília - DF',
    images: ['pic1/Anuncio 1 (6).jpeg', 'pic1/Anuncio 1 (7).jpeg', 'pic1/Anuncio 1 (8).jpeg'],
    description: 'Terreno amplo de 500 m² em localização estratégica, plano e com área verde. Excelente oportunidade para construir sua casa dos sonhos.'
  },
  '4': {
    title: 'Espaço comercial pronto para seu negócio',
    location: 'Taguatinga - DF',
    images: ['pic1/Anuncio 1 (6).jpeg', 'pic1/Anuncio 1 (7).jpeg', 'pic1/Anuncio 1 (8).jpeg'],
    description: 'Espaço comercial pronto para seu negócio, 120 m², sala comercial com 2 vagas de garagem. Localização estratégica em Taguatinga.'
  },
  '5': {
    title: 'Casa térrea com piscina',
    location: 'Valparaíso de Goiás - DF',
    images: ['pic1/Anuncio 1 (6).jpeg', 'pic1/Anuncio 1 (7).jpeg', 'pic1/Anuncio 1 (8).jpeg'],
    description: 'Casa térrea com piscina, 3 quartos, 2 banheiros, 2 vagas de garagem e área de lazer. Excelente opção para família em Valparaíso de Goiás.'
  },
  '6': {
    title: 'Apartamento de alto padrão',
    location: 'Lago Sul - DF',
    images: ['pic1/Anuncio 1 (6).jpeg', 'pic1/Anuncio 1 (7).jpeg', 'pic1/Anuncio 1 (8).jpeg'],
    description: 'Apartamento de alto padrão com 4 quartos, 4 banheiros, 3 vagas de garagem, varanda gourmet e vista panorâmica. Localização exclusiva no Lago Sul.'
  }
};

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function loadPropertyDetails() {
  const id = getQueryParam('id');
  const property = propertyData[id];

  // Tratamento de erro para ID inválido
  if (!property) {
    document.getElementById('property-title').textContent = 'Imóvel não encontrado';
    document.getElementById('property-location').textContent = '';
    document.getElementById('property-description').textContent = 'O imóvel solicitado não foi encontrado. Por favor, volte à página de anúncios.';
    document.getElementById('carousel-container').style.display = 'none';
    document.getElementById('contact-button').style.display = 'none';
    return;
  }

  // Preencher dados do imóvel
  document.getElementById('property-title').textContent = property.title;
  document.getElementById('property-location').textContent = property.location;
  document.getElementById('property-description').textContent = property.description;

  // Gerar slides do carrossel dinamicamente
  const carouselContainer = document.getElementById('carousel-container');
  const carouselDots = document.getElementById('carousel-dots');
  
  // Remover slides e dots existentes (exceto botões de navegação)
  const existingSlides = carouselContainer.querySelectorAll('.carousel-slide');
  existingSlides.forEach(slide => slide.remove());
  
  carouselDots.innerHTML = '';

  // Criar slides e dots
  property.images.forEach((imgSrc, index) => {
    // Criar slide
    const slide = document.createElement('div');
    slide.className = `carousel-slide ${index === 0 ? 'active' : ''}`;
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = `${property.title} - Foto ${index + 1}`;
    slide.appendChild(img);
    carouselContainer.insertBefore(slide, carouselContainer.querySelector('.carousel-nav.prev'));

    // Criar dot
    const dot = document.createElement('button');
    dot.className = `carousel-dot ${index === 0 ? 'active' : ''}`;
    dot.setAttribute('aria-label', `Foto ${index + 1}`);
    carouselDots.appendChild(dot);
  });

  // Atualizar link do WhatsApp com mensagem personalizada
  const contactButton = document.getElementById('contact-button');
  if (contactButton) {
    const message = encodeURIComponent(`Olá, tenho interesse no imóvel: ${property.title} em ${property.location}`);
    contactButton.href = `https://wa.me/5561996973773?text=${message}`;
  }
}

// Funcionalidade do Carrossel
let currentSlide = 0;

function initCarousel() {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  const prevBtn = document.querySelector('.carousel-nav.prev');
  const nextBtn = document.querySelector('.carousel-nav.next');

  if (slides.length === 0) return;

  function showSlide(index) {
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
    currentSlide = index;
  }

  function nextSlide() {
    const nextIndex = (currentSlide + 1) % slides.length;
    showSlide(nextIndex);
  }

  function prevSlide() {
    const prevIndex = (currentSlide - 1 + slides.length) % slides.length;
    showSlide(prevIndex);
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      prevSlide();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      nextSlide();
    });
  }

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      showSlide(index);
    });
  });

  // Navegação por teclado
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      prevSlide();
    } else if (e.key === 'ArrowRight') {
      nextSlide();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadPropertyDetails();
  // Inicializar carrossel após os slides serem gerados dinamicamente
  setTimeout(initCarousel, 100);
});
