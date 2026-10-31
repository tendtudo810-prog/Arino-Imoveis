(function () {
    "use strict";

    const API_URL = String(
        window.ARINO_API_URL ||
        ""
    ).replace(/\/$/, "");

    const TOKEN_KEY = "arino_admin_token";
    const MAX_FEATURED = 6;
    const MAX_FILE_SIZE = 8 * 1024 * 1024;

    const ALLOWED_IMAGE_TYPES = new Set([
        "image/jpeg",
        "image/png",
        "image/webp"
    ]);

    const form = document.getElementById("propertyForm");
    const propertyList = document.getElementById("propertyList");
    const listMessage = document.getElementById("listMessage");
    const formMessage = document.getElementById("formMessage");
    const priceInput = document.getElementById("preco");
    const featuredList = document.getElementById("featuredList");
    const featuredMessage = document.getElementById("featuredMessage");
    const photoUpload = document.getElementById("fotosUpload");
    const photoPreview = document.getElementById("photoPreview");

    let properties = [];
    let featuredProperties = [];
    let pendingFiles = [];

    function getToken() {
        return sessionStorage.getItem(TOKEN_KEY);
    }

    function clearSession() {
        sessionStorage.removeItem(TOKEN_KEY);
        window.location.href = "login.html";
    }

    function setMessage(element, text, type = "") {
        if (!element) return;

        element.textContent = text || "";
        element.className = `panel-message ${type}`.trim();
    }

    function setApiStatus(text, type = "") {
        const element = document.getElementById("apiStatus");

        if (!element) return;

        element.textContent = text || "";
        element.className = type
            ? `panel-message ${type}`
            : "";
    }

    function normalizeProperty(property) {
        if (!property || typeof property !== "object") {
            return property;
        }

        const fotos = Array.isArray(property.fotos)
            ? property.fotos.filter(Boolean)
            : [];

        return {
            ...property,

            fotos,

            imagemPrincipal:
                property.imagemPrincipal ||
                fotos[0] ||
                "",

            status:
                property.status ||
                (
                    property.vendido
                        ? "Vendido"
                        : "Disponível"
                ),

            destaque:
                property.destaque === true
        };
    }

    function getErrorMessage(data, status) {
        if (data && typeof data === "object") {
            return (
                data.erro ||
                data.mensagem ||
                data.message ||
                `A API respondeu com erro ${status}.`
            );
        }

        return `A API respondeu com erro ${status}.`;
    }

    async function request(path, options = {}) {
        const token = getToken();

        if (!token) {
            clearSession();

            throw new Error(
                "Sessão administrativa ausente."
            );
        }

        const isFormData =
            options.body instanceof FormData;

        const headers = {
            Accept:
                "application/json",

            Authorization:
                `Bearer ${token}`,

            ...(options.headers || {})
        };

        if (!isFormData) {
            headers[
                "Content-Type"
            ] =
                "application/json";
        }

        let response;

        try {
            response = await fetch(
                `${API_URL}${path}`,
                {
                    ...options,

                    headers,

                    credentials:
                        "omit",

                    cache:
                        "no-store"
                }
            );
        } catch (error) {
            console.error(
                "Erro de conexão com a API:",
                error
            );

            throw new Error(
                "Não foi possível conectar à API. Confirme que o backend está em execução (npm start em backend/) e que esta origem está em FRONTEND_ORIGINS."
            );
        }

        let data = null;

        try {
            data =
                await response.json();
        } catch {
            data = null;
        }

        if (
            response.status === 401
        ) {
            clearSession();

            throw new Error(
                "Sessão inválida ou expirada. Faça login novamente."
            );
        }

        if (
            response.status === 403
        ) {
            throw new Error(
                "Seu usuário não possui permissão administrativa."
            );
        }

        if (!response.ok) {
            throw new Error(
                getErrorMessage(
                    data,
                    response.status
                )
            );
        }

        return data;
    }

    async function publicGet(path) {
        let response;

        try {
            response =
                await fetch(
                    `${API_URL}${path}`,
                    {
                        method:
                            "GET",

                        headers: {
                            Accept:
                                "application/json"
                        },

                        credentials:
                            "omit",

                        cache:
                            "no-store"
                    }
                );
        } catch (error) {
            console.error(
                "Erro ao consultar API pública:",
                error
            );

            throw new Error(
                "Não foi possível conectar à API."
            );
        }

        let data = null;

        try {
            data =
                await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {
            throw new Error(
                getErrorMessage(
                    data,
                    response.status
                )
            );
        }

        return data;
    }

    function formatPrice(value) {
        const number =
            Number(value);

        if (
            !Number.isFinite(
                number
            )
        ) {
            return "R$ 0,00";
        }

        return number.toLocaleString(
            "pt-BR",
            {
                style:
                    "currency",

                currency:
                    "BRL"
            }
        );
    }

    function formatPriceInput(value) {
        const digits =
            String(
                value ?? ""
            ).replace(
                /\D/g,
                ""
            );

        if (!digits) {
            return "";
        }

        return Number(
            digits
        ).toLocaleString(
            "pt-BR",
            {
                minimumFractionDigits:
                    2,

                maximumFractionDigits:
                    2
            }
        );
    }

    function parsePriceInput(value) {
        const digits =
            String(
                value ?? ""
            ).replace(
                /\D/g,
                ""
            );

        return digits
            ? Number(digits)
            : NaN;
    }

    function setPriceDigits(value) {
        if (!priceInput) return;

        const digits =
            String(
                value ?? ""
            ).replace(
                /\D/g,
                ""
            );

        priceInput.dataset.rawDigits =
            digits;

        priceInput.value =
            formatPriceInput(
                digits
            );

        try {
            priceInput.setSelectionRange(
                priceInput.value.length,
                priceInput.value.length
            );
        } catch {
            // Ignorado.
        }
    }

    function imageUrl(value) {
        if (!value) {
            return "";
        }

        if (
            /^https?:\/\//i.test(
                value
            )
        ) {
            return value;
        }

        if (
            value.startsWith("/")
        ) {
            return `${API_URL}${value}`;
        }

        return value;
    }

    function updateStats() {
        const total =
            document.getElementById(
                "totalProperties"
            );

        const featured =
            document.getElementById(
                "featuredProperties"
            );

        const sold =
            document.getElementById(
                "soldProperties"
            );

        const available =
            document.getElementById(
                "availableProperties"
            );

        if (total) {
            total.textContent =
                properties.length;
        }

        if (featured) {
            featured.textContent =
                featuredProperties.length;
        }

        if (sold) {
            sold.textContent =
                properties.filter(
                    (item) =>
                        item.status ===
                            "Vendido" ||
                        item.vendido ===
                            true
                ).length;
        }

        if (available) {
            available.textContent =
                properties.filter(
                    (item) =>
                        item.status !==
                            "Vendido" &&
                        item.vendido !==
                            true
                ).length;
        }
    }

    function renderProperties() {
        if (!propertyList) {
            return;
        }

        propertyList.replaceChildren();

        if (!properties.length) {
            if (listMessage) {
                listMessage.hidden =
                    false;

                listMessage.textContent =
                    "Nenhum imóvel cadastrado.";
            }

            return;
        }

        if (listMessage) {
            listMessage.hidden =
                true;
        }

        properties.forEach(
            (property) => {
                const item =
                    document.createElement(
                        "article"
                    );

                item.className =
                    "property-row";
                
                item.dataset.id = property.id;

                const image =
                    document.createElement(
                        "img"
                    );

                const source =
                    property.imagemPrincipal ||
                    property.fotos?.[0];

                if (source) {
                    image.src =
                        imageUrl(
                            source
                        );
                    
                    // Adicionar lazy loading para melhorar performance
                    image.loading = "lazy";
                    image.decoding = "async";
                } else {
                    image.hidden =
                        true;
                }

                image.alt =
                    property.titulo ||
                    "Imóvel";

                image.onerror =
                    () => {
                        image.hidden =
                            true;
                    };

                const details =
                    document.createElement(
                        "div"
                    );

                details.className =
                    "property-details";

                const title =
                    document.createElement(
                        "strong"
                    );

                title.textContent =
                    property.titulo ||
                    "Sem título";

                const location =
                    document.createElement(
                        "span"
                    );

                location.textContent =
                    `${property.tipo || "Imóvel"} · ${property.cidade || "Localização não informada"}`;

                const status =
                    document.createElement(
                        "small"
                    );

                status.textContent =
                    `${formatPrice(property.preco)} · ${property.status || "Disponível"}`;

                details.append(
                    title,
                    location,
                    status
                );

                const actions =
                    document.createElement(
                        "div"
                    );

                actions.className =
                    "property-actions";

                const edit =
                    document.createElement(
                        "button"
                    );

                edit.type =
                    "button";

                edit.className =
                    "secondary-button";

                edit.textContent =
                    "Editar";

                edit.addEventListener(
                    "click",
                    () =>
                        fillForm(
                            property
                        )
                );

                const remove =
                    document.createElement(
                        "button"
                    );

                remove.type =
                    "button";

                remove.className =
                    "danger-button";

                remove.textContent =
                    "Excluir";

                remove.addEventListener(
                    "click",
                    () =>
                        deleteProperty(
                            property
                        )
                );

                actions.append(
                    edit,
                    remove
                );

                item.append(
                    image,
                    details,
                    actions
                );

                propertyList.appendChild(
                    item
                );
            }
        );
    }

    function addOption(
        select,
        value,
        label
    ) {
        if (!select) {
            return;
        }

        const option =
            document.createElement(
                "option"
            );

        option.value =
            String(value);

        option.textContent =
            label;

        select.appendChild(
            option
        );
    }

    function syncHighlightControls() {
        const count =
            featuredProperties.length;

        const complete =
            count ===
            MAX_FEATURED;

        const addButton =
            document.getElementById(
                "addHighlightButton"
            );

        const swapButton =
            document.getElementById(
                "swapHighlightButton"
            );

        const candidateSelect =
            document.getElementById(
                "highlightCandidate"
            );

        const currentSelect =
            document.getElementById(
                "highlightCurrent"
            );

        const countElement =
            document.getElementById(
                "featuredCount"
            );

        if (countElement) {
            countElement.textContent =
                `${count} de ${MAX_FEATURED}`;
        }

        if (addButton) {
            addButton.disabled =
                count !==
                MAX_FEATURED - 1;

            addButton.title =
                count >= MAX_FEATURED
                    ? "Já existem 6 imóveis em destaque. Use Trocar imóvel."
                    : count === MAX_FEATURED - 1
                        ? "Adicionar o sexto imóvel ao destaque."
                        : "A adição só pode completar a vitrine quando houver exatamente 5 destaques.";
        }

        if (swapButton) {
            swapButton.disabled =
                !complete;
        }

        if (candidateSelect) {
            candidateSelect.disabled =
                false;
        }

        if (currentSelect) {
            currentSelect.disabled =
                !complete;
        }

        if (featuredMessage) {
            if (
                count ===
                MAX_FEATURED
            ) {
                setMessage(
                    featuredMessage,
                    "A vitrine está completa com exatamente 6 imóveis.",
                    "success"
                );
            } else if (
                count <
                MAX_FEATURED
            ) {
                setMessage(
                    featuredMessage,
                    `A vitrine está incompleta: faltam ${MAX_FEATURED - count} imóvel(is) em destaque.`,
                    "warning"
                );
            } else {
                setMessage(
                    featuredMessage,
                    "A API possui mais de 6 destaques. Não faça alterações até corrigir a inconsistência.",
                    "error"
                );
            }
        }

        updateStats();
    }

    function renderHighlights(data) {
        const list =
            Array.isArray(data)
                ? data
                : [];

        featuredProperties =
            list
                .map(
                    normalizeProperty
                )
                .filter(
                    (property) =>
                        property.destaque ===
                        true
                );

        const candidates =
            properties.filter(
                (property) =>
                    property.destaque !==
                    true
            );

        if (featuredList) {
            featuredList.replaceChildren();

            featuredProperties.forEach(
                (property) => {
                    const item =
                        document.createElement(
                            "article"
                        );

                    item.className =
                        "feature-item";

                    const image =
                        document.createElement(
                            "img"
                        );

                    const source =
                        property.imagemPrincipal ||
                        property.fotos?.[0];

                    if (source) {
                        image.src =
                            imageUrl(
                                source
                        );
                        
                        // Adicionar lazy loading para melhorar performance
                        image.loading = "lazy";
                        image.decoding = "async";
                    }

                    image.alt =
                        property.titulo ||
                        "Imóvel em destaque";

                    image.onerror =
                        () => {
                            image.hidden =
                                true;
                        };

                    const title =
                        document.createElement(
                            "strong"
                        );

                    title.textContent =
                        property.titulo ||
                        "Imóvel";

                    const remove =
                        document.createElement(
                            "button"
                        );

                    remove.type =
                        "button";

                    remove.textContent =
                        "Remover do destaque";

                    /*
                     * A regra do painel é:
                     *
                     * exatamente 6 destaques.
                     *
                     * Portanto, não permitimos remover
                     * um destaque sozinho.
                     *
                     * A substituição deve ser feita
                     * por "Trocar imóvel".
                     */
                    remove.disabled =
                        true;

                    remove.title =
                        "Use 'Trocar imóvel' para manter exatamente 6 destaques.";

                    remove.addEventListener(
                        "click",
                        () => {
                            setMessage(
                                featuredMessage,
                                "Use 'Trocar imóvel' para substituir este anúncio e manter exatamente 6 destaques.",
                                "warning"
                            );
                        }
                    );

                    item.append(
                        image,
                        title,
                        remove
                    );

                    featuredList.appendChild(
                        item
                    );
                }
            );
        }

        const candidateSelect =
            document.getElementById(
                "highlightCandidate"
            );

        const currentSelect =
            document.getElementById(
                "highlightCurrent"
            );

        if (candidateSelect) {
            candidateSelect.replaceChildren();

            addOption(
                candidateSelect,
                "",
                "Selecione o novo imóvel"
            );

            candidates.forEach(
                (property) => {
                    addOption(
                        candidateSelect,
                        property.id,
                        property.titulo ||
                            `Imóvel #${property.id}`
                    );
                }
            );
        }

        if (currentSelect) {
            currentSelect.replaceChildren();

            addOption(
                currentSelect,
                "",
                "Selecione o destaque atual"
            );

            featuredProperties.forEach(
                (property) => {
                    addOption(
                        currentSelect,
                        property.id,
                        property.titulo ||
                            `Imóvel #${property.id}`
                    );
                }
            );
        }

        syncHighlightControls();
    }

    async function loadHighlights() {
        /*
         * A API atual disponibiliza:
         *
         * GET /api/Imoveis/destaques
         *
         * Esse endpoint é público e serve apenas
         * para leitura dos destaques.
         */
        const data =
            await publicGet(
                "/api/Imoveis/destaques"
            );

        renderHighlights(
            data
        );
    }

    async function loadProperties() {
        const data =
            await request("/api/admin/imoveis");

        if (
            !Array.isArray(
                data
            )
        ) {
            throw new Error(
                "A API retornou uma lista inválida de imóveis."
            );
        }

        properties =
            data.map(
                normalizeProperty
            );

        renderProperties();
        updateStats();

        // Carregar destaques em paralelo após ter os imóveis
        loadHighlights().catch(console.error);

        setApiStatus(
            `${properties.length} imóvel(is) carregado(s).`,
            "success"
        );
    }

    async function refreshAdminLists() {
        const [propertyData, highlightData] =
            await Promise.all([
                request("/api/admin/imoveis"),
                publicGet("/api/Imoveis/destaques")
            ]);

        if (
            !Array.isArray(propertyData) ||
            !Array.isArray(highlightData)
        ) {
            throw new Error(
                "A API retornou uma lista inválida de imóveis."
            );
        }

        properties =
            propertyData.map(
                normalizeProperty
            );

        renderProperties();
        renderHighlights(highlightData);
        updateStats();
    }

    async function addHighlight() {
        const count =
            featuredProperties.length;

        if (
            count !==
            MAX_FEATURED - 1
        ) {
            setMessage(
                featuredMessage,
                count >= MAX_FEATURED
                    ? "Já existem 6 imóveis em destaque. Para substituir um anúncio, use 'Trocar imóvel'."
                    : "A adição só pode completar a vitrine quando houver exatamente 5 destaques.",
                "warning"
            );

            return;
        }

        const candidateSelect =
            document.getElementById(
                "highlightCandidate"
            );

        const id =
            candidateSelect?.value;

        if (!id) {
            setMessage(
                featuredMessage,
                "Selecione um imóvel para adicionar ao destaque.",
                "error"
            );

            return;
        }

        const property =
            properties.find(
                (item) =>
                    String(
                        item.id
                    ) ===
                    String(id)
            );

        if (!property) {
            setMessage(
                featuredMessage,
                "O imóvel selecionado não existe mais.",
                "error"
            );

            await loadProperties();
            return;
        }

        if (
            property.destaque ===
            true
        ) {
            setMessage(
                featuredMessage,
                "Esse imóvel já está em destaque.",
                "error"
            );

            return;
        }

        try {
            await request(
                `/api/Imoveis/${encodeURIComponent(id)}/destaque`,
                {
                    method:
                        "POST"
                }
            );

            // Atualizar estado local ao invés de recarregar tudo
            property.destaque = true;
            await loadHighlights();
            renderProperties();
            updateStats();

            setMessage(
                featuredMessage,
                "Imóvel adicionado aos destaques.",
                "success"
            );
        } catch (error) {
            setMessage(
                featuredMessage,
                error.message,
                "error"
            );
        }
    }

    async function removeHighlight() {
        /*
         * Não fazemos DELETE aqui porque isso criaria
         * temporariamente 5 destaques.
         *
         * Para o usuário final, a troca deve ser feita
         * usando a operação "Trocar imóvel".
         */
        setMessage(
            featuredMessage,
            "Para manter exatamente 6 anúncios em destaque, use 'Trocar imóvel'.",
            "warning"
        );
    }

    async function swapHighlight() {
        if (
            featuredProperties.length !==
            MAX_FEATURED
        ) {
            setMessage(
                featuredMessage,
                "A troca só pode ser feita quando existirem exatamente 6 destaques.",
                "warning"
            );

            return;
        }

        const currentSelect =
            document.getElementById(
                "highlightCurrent"
            );

        const candidateSelect =
            document.getElementById(
                "highlightCandidate"
            );

        const oldId =
            currentSelect?.value;

        const newId =
            candidateSelect?.value;

        if (
            !oldId ||
            !newId
        ) {
            setMessage(
                featuredMessage,
                "Escolha o destaque atual e o novo imóvel.",
                "error"
            );

            return;
        }

        if (
            String(oldId) ===
            String(newId)
        ) {
            setMessage(
                featuredMessage,
                "Escolha um imóvel diferente para fazer a troca.",
                "error"
            );

            return;
        }

        const oldProperty =
            featuredProperties.find(
                (property) =>
                    String(
                        property.id
                    ) ===
                    String(
                        oldId
                    )
            );

        const newProperty =
            properties.find(
                (property) =>
                    String(
                        property.id
                    ) ===
                    String(
                        newId
                    )
            );

        if (
            !oldProperty ||
            oldProperty.destaque !==
                true
        ) {
            setMessage(
                featuredMessage,
                "O destaque atual selecionado é inválido.",
                "error"
            );

            return;
        }

        if (
            !newProperty ||
            newProperty.destaque ===
                true
        ) {
            setMessage(
                featuredMessage,
                "O novo imóvel precisa estar fora dos 6 destaques.",
                "error"
            );

            return;
        }

        const swapButton =
            document.getElementById(
                "swapHighlightButton"
            );

        if (swapButton) {
            swapButton.disabled = true;
        }

        let swapCompleted = false;

        try {
            setMessage(
                featuredMessage,
                "Trocando imóvel em destaque..."
            );

            const result =
                await request(
                "/api/Imoveis/destaques/trocar",
                {
                    method: "POST",
                    body: JSON.stringify({
                        antigoId: oldId,
                        novoId: newId
                    })
                }
            );

            if (
                result?.quantidade !== MAX_FEATURED ||
                !Array.isArray(result.destaques) ||
                result.destaques.length !== MAX_FEATURED
            ) {
                throw new Error(
                    "A API não confirmou a troca com exatamente 6 destaques."
                );
            }

            swapCompleted = true;

            const featuredIds =
                new Set(
                    result.destaques.map(
                        (property) => String(property.id)
                    )
                );

            properties =
                properties.map(
                    (property) => ({
                        ...property,
                        destaque: featuredIds.has(
                            String(property.id)
                        )
                    })
                );

            renderProperties();
            renderHighlights(result.destaques);
            updateStats();

            try {
                await refreshAdminLists();
            } catch (refreshError) {
                console.error(
                    "A troca foi persistida, mas não foi possível atualizar as listas:",
                    refreshError
                );
                setMessage(
                    featuredMessage,
                    `Troca concluída, mas não foi possível atualizar as listas: ${refreshError.message}`,
                    "warning"
                );
                return;
            }

            if (
                featuredProperties.length !==
                MAX_FEATURED
            ) {
                throw new Error(
                    "A troca terminou com quantidade diferente de 6 destaques. Verifique o backend."
                );
            }

            setMessage(
                featuredMessage,
                "Imóvel trocado com sucesso. Agora existem exatamente 6 destaques.",
                "success"
            );
        } catch (error) {
            if (!swapCompleted) {
                try {
                    await refreshAdminLists();
                } catch (refreshError) {
                    console.error(
                        "Não foi possível sincronizar o painel após a falha na troca:",
                        refreshError
                    );
                }
            }

            setMessage(
                featuredMessage,
                error.message,
                "error"
            );
        } finally {
            syncHighlightControls();
        }
    }

    function renderPhotoPreview(
        property = null
    ) {
        if (!photoPreview) {
            return;
        }

        photoPreview.replaceChildren();

        const photos =
            Array.isArray(
                property?.fotos
            )
                ? property.fotos
                : [];

        const managedPhotos =
            Array.isArray(
                property?.fotosGerenciadas
            )
                ? property.fotosGerenciadas
                : photos;

        photos.forEach(
            (photo) => {
                const item =
                    document.createElement(
                        "div"
                    );

                item.className =
                    "photo-item";

                const image =
                    document.createElement(
                        "img"
                    );

                image.src =
                    imageUrl(
                        photo
                    );

                image.alt =
                    "Foto do imóvel";
                
                // Adicionar lazy loading para melhorar performance
                image.loading = "lazy";
                image.decoding = "async";

                image.onerror =
                    () => {
                        image.hidden =
                            true;
                    };

                const main =
                    document.createElement(
                        "button"
                    );

                main.type =
                    "button";

                const isMain =
                    property?.imagemPrincipal ===
                    photo;

                main.textContent =
                    isMain
                        ? "Imagem principal"
                        : "Definir como principal";

                main.disabled =
                    isMain;

                main.addEventListener(
                    "click",
                    async () => {
                        try {
                            /*
                             * A API atual usa:
                             *
                             * PUT /api/Imoveis/:id/foto-principal
                             */
                            const updated =
                                await request(
                                    `/api/Imoveis/${encodeURIComponent(property.id)}/foto-principal`,
                                    {
                                        method:
                                            "PUT",

                                        body:
                                            JSON.stringify(
                                                {
                                                    foto:
                                                        photo
                                                }
                                            )
                                    }
                                );

                            const normalized =
                                normalizeProperty(
                                    updated
                                );

                            Object.assign(
                                property,
                                normalized
                            );

                            const index =
                                properties.findIndex(
                                    (item) =>
                                        String(
                                            item.id
                                        ) ===
                                        String(
                                            property.id
                                        )
                                );

                            if (
                                index !==
                                -1
                            ) {
                                properties[
                                    index
                                ] =
                                    normalized;
                            }

                            renderPhotoPreview(
                                normalized
                            );

                            // Não é necessário re-renderizar a lista inteira
                            // Apenas atualizar o item específico se estiver visível
                            const propertyItem = propertyList?.querySelector(
                                `article[data-id="${property.id}"]`
                            );
                            if (propertyItem) {
                                const image = propertyItem.querySelector('img');
                                if (image && property.imagemPrincipal) {
                                    image.src = imageUrl(property.imagemPrincipal);
                                }
                            }

                            setMessage(
                                formMessage,
                                "Imagem principal atualizada.",
                                "success"
                            );
                        } catch (
                            error
                        ) {
                            setMessage(
                                formMessage,
                                error.message,
                                "error"
                            );
                        }
                    }
                );

                item.append(
                    image,
                    main
                );

                if (
                    managedPhotos.includes(
                        photo
                    )
                ) {
                    const remove =
                        document.createElement(
                            "button"
                        );

                    remove.type =
                        "button";

                    remove.textContent =
                        "Remover foto";

                    remove.addEventListener(
                        "click",
                        async () => {
                            try {
                                const updated =
                                    await request(
                                        `/api/Imoveis/${encodeURIComponent(property.id)}/fotos`,
                                        {
                                            method:
                                                "DELETE",

                                            body:
                                                JSON.stringify(
                                                    {
                                                        foto:
                                                            photo
                                                    }
                                                )
                                        }
                                    );

                                const normalized =
                                    normalizeProperty(
                                        updated
                                    );

                                Object.assign(
                                    property,
                                    normalized
                                );

                                const index =
                                    properties.findIndex(
                                        (item) =>
                                            String(
                                                item.id
                                            ) ===
                                            String(
                                                property.id
                                            )
                                    );

                                if (
                                    index !==
                                    -1
                                ) {
                                    properties[
                                        index
                                    ] =
                                        normalized;
                                }

                                renderPhotoPreview(
                                    normalized
                                );

                                // Não é necessário re-renderizar a lista inteira
                                // Apenas atualizar o item específico se estiver visível
                                const propertyItem = propertyList?.querySelector(
                                    `article[data-id="${property.id}"]`
                                );
                                if (propertyItem) {
                                    const image = propertyItem.querySelector('img');
                                    if (image && property.imagemPrincipal) {
                                        image.src = imageUrl(property.imagemPrincipal);
                                    }
                                }

                                setMessage(
                                    formMessage,
                                    "Foto removida com sucesso.",
                                    "success"
                                );
                            } catch (
                                error
                            ) {
                                setMessage(
                                    formMessage,
                                    error.message,
                                    "error"
                                );
                            }
                        }
                    );

                    item.appendChild(
                        remove
                    );
                }

                photoPreview.appendChild(
                    item
                );
            }
        );

        pendingFiles.forEach(
            (file, index) => {
                const item =
                    document.createElement(
                        "div"
                    );

                item.className =
                    "photo-item";

                const image =
                    document.createElement(
                        "img"
                    );

                image.src =
                    URL.createObjectURL(
                        file
                    );

                image.alt =
                    file.name;

                const remove =
                    document.createElement(
                        "button"
                    );

                remove.type =
                    "button";

                remove.textContent =
                    "Remover antes de salvar";

                remove.addEventListener(
                    "click",
                    () => {
                        pendingFiles.splice(
                            index,
                            1
                        );

                        renderPhotoPreview(
                            property
                        );
                    }
                );

                item.append(
                    image,
                    remove
                );

                photoPreview.appendChild(
                    item
                );
            }
        );
    }

    function updateHighlightCheckboxState(
        property
    ) {
        const checkbox =
            document.getElementById(
                "destaque"
            );

        if (!checkbox) {
            return;
        }

        const isEditingFeatured =
            Boolean(
                property?.id
            ) &&
            property?.destaque ===
                true;

        if (
            isEditingFeatured
        ) {
            /*
             * Um dos 6 destaques não pode simplesmente
             * ser desmarcado durante a edição.
             */
            checkbox.checked =
                true;

            checkbox.disabled =
                true;

            checkbox.title =
                "Este imóvel faz parte dos 6 destaques. Use 'Trocar imóvel' para substituí-lo.";
        } else {
            checkbox.disabled =
                false;

            checkbox.title =
                "Adicionar este imóvel aos destaques.";
        }
    }

    function fillForm(
        property
    ) {
        property =
            normalizeProperty(
                property
            );

        const id =
            document.getElementById(
                "propertyId"
            );

        if (id) {
            id.value =
                property.id ??
                "";
        }

        [
            "titulo",
            "tipo",
            "cidade",
            "estado",
            "localizacao",
            "area",
            "quartos",
            "banheiros",
            "vagas",
            "descricao"
        ].forEach(
            (field) => {
                const element =
                    document.getElementById(
                        field
                    );

                if (element) {
                    element.value =
                        property[field] ??
                        "";
                }
            }
        );

        if (priceInput) {
            setPriceDigits(
                property.preco
            );
        }

        const photosField =
            document.getElementById(
                "fotos"
            );

        if (photosField) {
            photosField.value =
                property.fotos.join(
                    "\n"
                );
        }

        const destaque =
            document.getElementById(
                "destaque"
            );

        if (destaque) {
            destaque.checked =
                Boolean(
                    property.destaque
                );
        }

        updateHighlightCheckboxState(
            property
        );

        const status =
            document.getElementById(
                "status"
            );

        if (status) {
            status.value =
                property.status ||
                (
                    property.vendido
                        ? "Vendido"
                        : "Disponível"
                );
        }

        const formTitle =
            document.getElementById(
                "formTitle"
            );

        if (formTitle) {
            formTitle.textContent =
                `Editar imóvel #${property.id}`;
        }

        pendingFiles = [];

        if (photoUpload) {
            photoUpload.value =
                "";
        }

        renderPhotoPreview(
            property
        );

        const formulario =
            document.getElementById(
                "formulario"
            );

        if (formulario) {
            formulario.scrollIntoView(
                {
                    behavior:
                        "smooth"
                }
            );
        }
    }

    function resetForm() {
        if (form) {
            form.reset();
        }

        const id =
            document.getElementById(
                "propertyId"
            );

        if (id) {
            id.value =
                "";
        }

        const title =
            document.getElementById(
                "formTitle"
            );

        if (title) {
            title.textContent =
                "Novo imóvel";
        }

        const destaque =
            document.getElementById(
                "destaque"
            );

        if (destaque) {
            destaque.disabled =
                false;

            destaque.checked =
                false;

            destaque.title =
                "Adicionar este imóvel aos destaques.";
        }

        pendingFiles = [];

        setPriceDigits(
            ""
        );

        if (photoUpload) {
            photoUpload.value =
                "";
        }

        renderPhotoPreview(
            {
                fotos: [],
                fotosGerenciadas: [],
                imagemPrincipal: ""
            }
        );

        setMessage(
            formMessage,
            ""
        );
    }

    function formPayload() {
        if (!form) {
            throw new Error(
                "Formulário de imóvel não encontrado."
            );
        }

        const formData =
            new FormData(
                form
            );

        const data =
            Object.fromEntries(
                formData.entries()
            );

        data.titulo =
            String(
                data.titulo ||
                ""
            ).trim();

        data.tipo =
            String(
                data.tipo ||
                ""
            ).trim();

        data.cidade =
            String(
                data.cidade ||
                ""
            ).trim();

        data.estado =
            String(
                data.estado ||
                ""
            )
                .trim()
                .toUpperCase();

        data.localizacao =
            String(
                data.localizacao ||
                ""
            ).trim();

        data.descricao =
            String(
                data.descricao ||
                ""
            ).trim();

        [
            "area",
            "quartos",
            "banheiros",
            "vagas"
        ].forEach(
            (field) => {
                const value =
                    String(
                        data[field] ??
                        ""
                    ).trim();

                data[field] =
                    value
                        ? Number(
                            value
                        )
                        : null;
            }
        );

        // Não converter preço aqui - usar dataset.rawDigits
        // data.preco será tratado abaixo

        const destaque =
            document.getElementById(
                "destaque"
            );

        data.destaque =
            Boolean(
                destaque?.checked
            );

        const status =
            document.getElementById(
                "status"
            );

        data.status =
            status?.value ||
            "Disponível";

        data.vendido =
            data.status ===
            "Vendido";

        const photosField =
            document.getElementById(
                "fotos"
            );

        data.fotos =
            photosField
                ? String(
                    photosField.value ||
                    ""
                )
                    .split(
                        /\r?\n/
                    )
                    .map(
                        (photo) =>
                            photo.trim()
                    )
                    .filter(
                        Boolean
                    )
                : [];

        // Não enviar o campo de preço do input formatado
        // Usar apenas os dígitos brutos do dataset
        delete data.preco;
        if (priceInput?.dataset.rawDigits) {
            data.preco = Number(priceInput.dataset.rawDigits);
        }

        delete data.fotosUpload;

        return data;
    }

    async function uploadPendingPhotos(
        id
    ) {
        if (
            !pendingFiles.length
        ) {
            return null;
        }

        if (
            pendingFiles.length >
            10
        ) {
            throw new Error(
                "Você pode enviar no máximo 10 imagens por vez."
            );
        }

        for (
            const file of
            pendingFiles
        ) {
            if (
                !ALLOWED_IMAGE_TYPES.has(
                    file.type
                )
            ) {
                throw new Error(
                    `O arquivo "${file.name}" não é JPG, PNG ou WEBP.`
                );
            }

            if (
                file.size >
                MAX_FILE_SIZE
            ) {
                throw new Error(
                    `O arquivo "${file.name}" ultrapassa o limite de 8 MB.`
                );
            }
        }

        const body =
            new FormData();

        pendingFiles.forEach(
            (file) => {
                body.append(
                    "fotos",
                    file,
                    file.name
                );
            }
        );

        const response =
            await request(
                `/api/Imoveis/${encodeURIComponent(id)}/fotos`,
                {
                    method:
                        "POST",

                    body
                }
            );

        /*
         * A API pode retornar:
         *
         * { imovel: {...} }
         *
         * ou diretamente:
         *
         * {...}
         */
        return normalizeProperty(
            response?.imovel ||
            response
        );
    }

    async function saveProperty(
        event
    ) {
        event.preventDefault();

        setMessage(
            formMessage,
            "Salvando..."
        );

        const id =
            String(
                document.getElementById(
                    "propertyId"
                )?.value ||
                ""
            ).trim();

        try {
            const payload =
                formPayload();

            const currentProperty =
                properties.find(
                    (item) =>
                        String(
                            item.id
                        ) ===
                        String(id)
                );

            if (
                !payload.titulo
            ) {
                throw new Error(
                    "Preencha o título do imóvel."
                );
            }

            if (
                !payload.tipo
            ) {
                throw new Error(
                    "Preencha o tipo do imóvel."
                );
            }

            if (
                !payload.cidade
            ) {
                throw new Error(
                    "Preencha a cidade do imóvel."
                );
            }

            if (
                !payload.estado
            ) {
                throw new Error(
                    "Preencha o estado do imóvel."
                );
            }

            if (
                !Number.isFinite(
                    payload.preco
                ) ||
                payload.preco <=
                    0
            ) {
                throw new Error(
                    "Informe um preço válido."
                );
            }

            const count =
                featuredProperties.length;

            const wasFeatured =
                currentProperty?.destaque ===
                true;

            /*
             * Se o imóvel já é um dos 6,
             * ele não pode sair do destaque pela edição.
             */
            if (
                wasFeatured &&
                payload.destaque !==
                    true
            ) {
                throw new Error(
                    "Este imóvel faz parte dos 6 destaques. Use 'Trocar imóvel' para substituí-lo."
                );
            }

            /*
             * Nunca permitir que a edição/criação
             * transforme o imóvel no 7º destaque.
             */
            if (
                payload.destaque ===
                    true &&
                !wasFeatured &&
                count !==
                    MAX_FEATURED - 1
            ) {
                throw new Error(
                    count >= MAX_FEATURED
                        ? "Já existem 6 imóveis em destaque. Use 'Trocar imóvel' para substituir um deles."
                        : "A adição só pode completar a vitrine quando houver exatamente 5 destaques."
                );
            }

            let saved;

            if (id) {
                saved =
                    await request(
                        `/api/Imoveis/${encodeURIComponent(id)}`,
                        {
                            method:
                                "PUT",

                            body:
                                JSON.stringify(
                                    payload
                                )
                        }
                    );
            } else {
                saved =
                    await request(
                        "/api/Imoveis",
                        {
                            method:
                                "POST",

                            body:
                                JSON.stringify(
                                    payload
                                )
                        }
                    );
            }

            saved =
                normalizeProperty(
                    saved
                );

            const uploaded =
                await uploadPendingPhotos(
                    saved.id
                );

            if (uploaded) {
                saved =
                    {
                        ...saved,
                        ...uploaded,
                        fotos:
                            uploaded.fotos ||
                            saved.fotos,

                        imagemPrincipal:
                            uploaded.imagemPrincipal ||
                            saved.imagemPrincipal
                    };
            }

            pendingFiles = [];

            const index =
                properties.findIndex(
                    (item) =>
                        String(
                            item.id
                        ) ===
                        String(
                            saved.id
                        )
                );

            if (
                index ===
                -1
            ) {
                properties.push(
                    saved
                );
            } else {
                properties[
                    index
                ] =
                    saved;
            }

            renderProperties();

            // Não é necessário recarregar tudo, já atualizamos o estado local
            // loadProperties();

            resetForm();

            setMessage(
                formMessage,
                "Imóvel salvo com sucesso.",
                "success"
            );
        } catch (
            error
        ) {
            console.error(
                "Erro ao salvar imóvel:",
                error
            );

            setMessage(
                formMessage,
                error.message ||
                    "Não foi possível salvar o imóvel.",
                "error"
            );
        }
    }

    async function deleteProperty(
        property
    ) {
        /*
         * Um destaque não pode ser excluído diretamente,
         * porque isso quebraria a regra de exatamente 6.
         *
         * Primeiro faça uma troca.
         */
        if (
            property.destaque ===
            true
        ) {
            setMessage(
                formMessage,
                "Não é possível excluir um dos 6 destaques diretamente. Use 'Trocar imóvel' primeiro.",
                "warning"
            );

            return;
        }

        const confirmed =
            window.confirm(
                `Excluir o imóvel "${property.titulo}"? Essa ação não pode ser desfeita.`
            );

        if (!confirmed) {
            return;
        }

        try {
            await request(
                `/api/Imoveis/${encodeURIComponent(property.id)}`,
                {
                    method:
                        "DELETE"
                }
            );

            // Atualizar estado local ao invés de recarregar tudo
            const index = properties.findIndex(
                (item) => String(item.id) === String(property.id)
            );
            if (index !== -1) {
                properties.splice(index, 1);
            }
            renderProperties();
            updateStats();
            await loadHighlights();

            setMessage(
                formMessage,
                "Imóvel excluído com sucesso.",
                "success"
            );
        } catch (
            error
        ) {
            setMessage(
                formMessage,
                error.message,
                "error"
            );
        }
    }

    function setupPriceInput() {
        if (!priceInput) {
            return;
        }

        priceInput.addEventListener(
            "keydown",
            (event) => {
                if (
                    /^\d$/.test(
                        event.key
                    )
                ) {
                    event.preventDefault();

                    const selected =
                        priceInput.selectionStart !==
                        priceInput.selectionEnd;

                    const current =
                        priceInput.dataset.rawDigits ||
                        "";

                    setPriceDigits(
                        `${
                            selected
                                ? ""
                                : current
                        }${event.key}`
                    );

                    return;
                }

                if (
                    event.key ===
                        "Backspace" ||
                    event.key ===
                        "Delete"
                ) {
                    event.preventDefault();

                    const selected =
                        priceInput.selectionStart !==
                        priceInput.selectionEnd;

                    const current =
                        priceInput.dataset.rawDigits ||
                        "";

                    setPriceDigits(
                        selected
                            ? ""
                            : current.slice(
                                0,
                                -1
                            )
                    );

                    return;
                }

                const allowedKeys = [
                    "Tab",
                    "Enter",
                    "Escape",
                    "ArrowLeft",
                    "ArrowRight",
                    "Home",
                    "End"
                ];

                if (
                    !allowedKeys.includes(
                        event.key
                    ) &&
                    !event.ctrlKey &&
                    !event.metaKey
                ) {
                    event.preventDefault();
                }
            }
        );

        priceInput.addEventListener(
            "paste",
            (event) => {
                event.preventDefault();

                setPriceDigits(
                    event.clipboardData.getData(
                        "text"
                    )
                );
            }
        );
    }

    function setupPhotos() {
        if (
            photoUpload
        ) {
            photoUpload.addEventListener(
                "change",
                () => {
                    pendingFiles =
                        Array.from(
                            photoUpload.files ||
                                []
                        );

                    renderPhotoPreview(
                        {
                            fotos: [],
                            fotosGerenciadas: [],
                            imagemPrincipal:
                                ""
                        }
                    );
                }
            );
        }

        const addPhotosButton =
            document.getElementById(
                "addPhotosButton"
            );

        if (
            addPhotosButton &&
            photoUpload
        ) {
            addPhotosButton.addEventListener(
                "click",
                () =>
                    photoUpload.click()
            );
        }
    }

    function setupHighlights() {
        const addButton =
            document.getElementById(
                "addHighlightButton"
            );

        const swapButton =
            document.getElementById(
                "swapHighlightButton"
            );

        if (
            addButton
        ) {
            addButton.addEventListener(
                "click",
                addHighlight
            );
        }

        if (
            swapButton
        ) {
            swapButton.addEventListener(
                "click",
                swapHighlight
            );
        }
    }

    function setupButtons() {
        const cancelButton =
            document.getElementById(
                "cancelButton"
            );

        if (
            cancelButton
        ) {
            cancelButton.addEventListener(
                "click",
                resetForm
            );
        }

        const newPropertyButton =
            document.getElementById(
                "newPropertyButton"
            );

        if (
            newPropertyButton
        ) {
            newPropertyButton.addEventListener(
                "click",
                () => {
                    resetForm();

                    const formulario =
                        document.getElementById(
                            "formulario"
                        );

                    if (
                        formulario
                    ) {
                        formulario.scrollIntoView(
                            {
                                behavior:
                                    "smooth"
                            }
                        );
                    }
                }
            );
        }

        const logoutButton =
            document.getElementById(
                "logoutButton"
            );

        if (
            logoutButton
        ) {
            logoutButton.addEventListener(
                "click",
                async () => {
                    const token =
                        getToken();

                    try {
                        if (
                            token
                        ) {
                            await fetch(
                                `${API_URL}/api/Auth/logout`,
                                {
                                    method:
                                        "POST",

                                    headers: {
                                        Accept:
                                            "application/json",

                                        Authorization:
                                            `Bearer ${token}`
                                    },

                                    credentials:
                                        "omit",

                                    // POST requests should not be cached
                                    cache: "no-store"
                                }
                            );
                        }
                    } catch (
                        error
                    ) {
                        console.warn(
                            "Erro ao encerrar sessão:",
                            error
                        );
                    } finally {
                        clearSession();
                    }
                }
            );
        }
    }

    function setupForm() {
        if (
            form
        ) {
            form.addEventListener(
                "submit",
                saveProperty
            );
        }
    }

    async function init() {
        const token =
            getToken();

        if (!token) {
            clearSession();
            return;
        }

        try {
            /*
             * Não chamamos /api/Auth/teste-admin,
             * porque essa rota não existe na versão
             * atual da API.
             *
             * A segurança real continua no backend:
             * todas as operações POST/PUT/DELETE
             * exigem Bearer token.
             */
            setApiStatus(
                "Carregando imóveis..."
            );

            await loadProperties();

            const adminEmail =
                document.getElementById(
                    "adminEmail"
                );

            if (
                adminEmail
            ) {
                adminEmail.textContent =
                    sessionStorage.getItem(
                        "arino_admin_email"
                    ) ||
                    "Administrador";
            }
        } catch (
            error
        ) {
            console.error(
                "Erro ao inicializar painel:",
                error
            );

            setApiStatus(
                error.message ||
                    "Não foi possível carregar o painel.",
                "error"
            );

            if (
                error.message?.includes(
                    "Sessão inválida"
                ) ||
                error.message?.includes(
                    "Sessão administrativa ausente"
                )
            ) {
                clearSession();
            }
        }
    }

    setupPriceInput();
    setupPhotos();
    setupHighlights();
    setupButtons();
    setupForm();

    init();
})();