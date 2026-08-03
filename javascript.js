document.addEventListener('DOMContentLoaded', () => {
    const perguntas = document.querySelectorAll('.pergunta');
    const btnPublicar = document.getElementById('btn-publicar');
    const modal = document.getElementById('modal-publicar');
    const closeModalBtn = document.getElementById('close-modal');
    const form = document.getElementById('form-publicar');
    const message = document.getElementById('form-message');
    const container = document.getElementById('imoveis-grid');
    const storageKey = 'arino-admin-auth';
    const authorizedUser = 'you';

    let isAuthorized = localStorage.getItem(storageKey) === 'true';

    const isCurrentUserAuthorized = () => {
        const currentUser = window.location.search.match(/user=([^&]+)/);
        const userParam = currentUser ? decodeURIComponent(currentUser[1]) : '';
        return userParam === authorizedUser || isAuthorized;
    };

    const openModal = () => {
        if (!isCurrentUserAuthorized()) {
            return;
        }

        if (!isAuthorized) {
            isAuthorized = true;
            localStorage.setItem(storageKey, 'true');
        }

        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        message.textContent = '';
    };

    const closeModal = () => {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        form.reset();
        message.textContent = '';
    };

    if (btnPublicar) {
        btnPublicar.style.display = isCurrentUserAuthorized() ? 'flex' : 'none';
        btnPublicar.addEventListener('click', (event) => {
            event.preventDefault();
            openModal();
        });
    }
    closeModalBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal?.classList.contains('active')) {
            closeModal();
        }
    });

    form?.addEventListener('submit', (event) => {
        event.preventDefault();

        const titulo = form.titulo.value.trim();
        const tipo = form.tipo.value;
        const preco = form.preco.value.trim();
        const local = form.local.value.trim();
        const descricao = form.descricao.value.trim();
        const imagem = form.imagem.value.trim() || 'pic1/house-isolated-field.jpg';
        const categoria = form.categoria.value;

        if (!titulo || !preco || !local || !descricao) {
            message.textContent = 'Preencha todos os campos obrigatórios.';
            return;
        }

        const card = document.createElement('article');
        card.className = 'imovel-card is-new';
        card.innerHTML = `
            <img src="${imagem}" alt="${titulo}">
            <div class="imovel-info">
                <span class="tag">${tipo}</span>
                <h3>${titulo}</h3>
                <p class="preco">${preco}</p>
                <p class="local">${local}</p>
                <p class="desc">${descricao}</p>
            </div>
        `;

        if (categoria === 'destaque') {
            const destaqueSection = document.querySelector('.imoveis');
            destaqueSection?.appendChild(card);
        } else {
            const normalSection = document.querySelector('.imoveis1');
            normalSection?.appendChild(card);
        }
        message.textContent = 'Anúncio publicado com sucesso!';
        form.reset();
        setTimeout(closeModal, 700);
    });

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
