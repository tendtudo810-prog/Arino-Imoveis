const BASE_IMOVEL_URL = 'imovel.html';
const API_URL = window.ARINO_API_URL;

function formatPrice(value) {
    if (typeof value !== 'number') return value || 'Não informado';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getFirstImage(property) {
    const images = Array.isArray(property.fotos) ? property.fotos : [];
    const image = property.imagemPrincipal || images[0] || '';
    return image.startsWith('/') ? `${API_URL}${image}` : image;
}

function renderPropertyCards(properties, grid) {
    grid.replaceChildren();
    properties.forEach((property) => {
        if (property.id === undefined || property.id === null) return;

        const card = document.createElement('a');
        card.href = `${BASE_IMOVEL_URL}?id=${encodeURIComponent(property.id)}`;
        card.className = 'imovel-card';
        card.dataset.imovelId = property.id;

        const image = document.createElement('img');
        image.src = getFirstImage(property);
        image.alt = property.titulo || 'Imóvel';

        const info = document.createElement('div');
        info.className = 'imovel-info';

        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = property.tipo || 'Imóvel';

        const title = document.createElement('h3');
        title.textContent = property.titulo || 'Imóvel';

        const price = document.createElement('p');
        price.className = 'preco';
        price.textContent = formatPrice(property.preco);

        const location = document.createElement('p');
        location.className = 'local';
        location.textContent = property.localizacao || [property.cidade, property.estado].filter(Boolean).join(' - ') || 'Localização não informada';

        const area = document.createElement('p');
        area.className = 'area';
        area.textContent = property.area === null || property.area === undefined ? 'Não informado' : `${property.area} m²`;

        info.append(tag, title, price, location, area);
        card.append(image, info);
        grid.appendChild(card);
    });
}

async function loadPropertyCards() {
    const grid = document.getElementById('imoveis-grid');
    if (!grid) return;
    grid.replaceChildren();

    try {
        const featuredOnly = Boolean(document.querySelector('.df'));
        const response = await fetch(`${API_URL}${featuredOnly ? '/api/Imoveis/destaques' : '/api/Imoveis'}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const properties = await response.json();
        if (!Array.isArray(properties)) throw new Error('Formato de listagem inválido');
        if (featuredOnly && properties.length !== 6) throw new Error(`A vitrine precisa de exatamente 6 destaques. Atualmente: ${properties.length}.`);
        renderPropertyCards(properties, grid);
    } catch (error) {
        grid.replaceChildren();
        const message = document.createElement('p');
        message.textContent = 'Não foi possível carregar os imóveis no momento. Tente novamente mais tarde.';
        grid.appendChild(message);
        console.error('Erro ao carregar imóveis:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadPropertyCards();

    document.querySelectorAll('.imovel-card[data-imovel-id]').forEach((card) => {
        card.addEventListener('click', (event) => {
            event.preventDefault();
            const propertyId = card.dataset.imovelId;
            window.location.href = `${BASE_IMOVEL_URL}?id=${encodeURIComponent(propertyId)}`;
        });
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

    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.sections');

    if (menuToggle && nav) {
        const syncMenuState = (isOpen) => {
            nav.classList.toggle('is-open', isOpen);
            menuToggle.setAttribute('aria-expanded', String(isOpen));
            menuToggle.innerHTML = isOpen
                ? '<i class="fa-solid fa-xmark"></i>'
                : '<i class="fa-solid fa-bars"></i>';
        };

        menuToggle.addEventListener('click', () => {
            const isOpen = !nav.classList.contains('is-open');
            syncMenuState(isOpen);
        });

        nav.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                syncMenuState(false);
            });
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) {
                syncMenuState(false);
            }
        });
    }
});