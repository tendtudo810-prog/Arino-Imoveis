const API_URL = "http://localhost:5254";
const token = sessionStorage.getItem("adminToken");
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

function clearSession() {
    sessionStorage.removeItem("adminToken");
    window.location.href = "login.html";
}

function setMessage(element, text, type = "") {
    element.textContent = text;
    element.className = `panel-message ${type}`;
}

async function request(path, options = {}) {
    if (!token) {
        console.error("Diagnóstico: painel carregado sem token administrativo.");
        clearSession();
        throw new Error("Sessão ausente.");
    }
    const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers });
    let data = {};
    try { data = await response.json(); } catch { /* resposta sem JSON */ }
    if (response.status === 401) {
        console.error(`Diagnóstico: ${path} respondeu 401.`);
        clearSession();
        throw new Error("Sessão inválida ou expirada.");
    }
    if (response.status === 403) throw new Error("Seu usuário não possui permissão administrativa.");
    if (!response.ok) throw new Error(data.mensagem || `A API respondeu com erro ${response.status}.`);
    return data;
}

function formatPrice(value) {
    return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPriceInput(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parsePriceInput(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits ? Number(digits) : NaN;
}

function setPriceDigits(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    priceInput.dataset.rawDigits = digits;
    priceInput.value = formatPriceInput(digits);
    priceInput.setSelectionRange(priceInput.value.length, priceInput.value.length);
}

function logPropertyValidation(values) {
    console.log("Diagnóstico do cadastro:", {
        titulo: values.titulo,
        tipo: values.tipo,
        cidade: values.cidade,
        estado: values.estado
    });
}

function imageUrl(value) {
    if (!value) return "";
    return value.startsWith("/") ? `${API_URL}${value}` : value;
}

function renderProperties() {
    propertyList.replaceChildren();
    listMessage.hidden = properties.length > 0;
    if (!properties.length) {
        listMessage.textContent = "Nenhum imóvel cadastrado.";
        return;
    }
    properties.forEach((property) => {
        const item = document.createElement("article");
        item.className = "property-row";
        const image = document.createElement("img");
        image.src = imageUrl(property.imagemPrincipal || property.fotos?.[0]);
        image.alt = property.titulo || "Imóvel";
        image.onerror = () => { image.hidden = true; };
        const details = document.createElement("div");
        details.className = "property-details";
        details.innerHTML = "<strong></strong><span></span><small></small>";
        details.querySelector("strong").textContent = property.titulo || "Sem título";
        details.querySelector("span").textContent = `${property.tipo || "Imóvel"} · ${property.cidade || "Localização não informada"}`;
        details.querySelector("small").textContent = `${formatPrice(property.preco)} · ${property.status || (property.vendido ? "Vendido" : "Disponível")}`;
        const actions = document.createElement("div");
        actions.className = "property-actions";
        const edit = document.createElement("button");
        edit.className = "secondary-button";
        edit.type = "button";
        edit.textContent = "Editar";
        edit.addEventListener("click", () => fillForm(property));
        const remove = document.createElement("button");
        remove.className = "danger-button";
        remove.type = "button";
        remove.textContent = "Excluir";
        remove.addEventListener("click", () => deleteProperty(property));
        actions.append(edit, remove);
        item.append(image, details, actions);
        propertyList.appendChild(item);
    });
}

function updateStats() {
    document.getElementById("totalProperties").textContent = properties.length;
    document.getElementById("featuredProperties").textContent = featuredProperties.length;
    document.getElementById("soldProperties").textContent = properties.filter((item) => item.vendido).length;
    document.getElementById("availableProperties").textContent = properties.filter((item) => !item.vendido).length;
}

function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
}

function renderHighlights(data) {
    featuredProperties = data.destaques || [];
    const candidates = data.disponiveis || [];
    document.getElementById("featuredCount").textContent = `${featuredProperties.length} de 6`;
    featuredList.replaceChildren();
    featuredProperties.forEach((property) => {
        const item = document.createElement("article");
        item.className = "feature-item";
        const image = document.createElement("img");
        image.src = imageUrl(property.imagemPrincipal || property.fotos?.[0]);
        image.alt = property.titulo || "Imóvel em destaque";
        const title = document.createElement("strong");
        title.textContent = property.titulo;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remover do destaque";
        remove.addEventListener("click", () => removeHighlight(property));
        item.append(image, title, remove);
        featuredList.appendChild(item);
    });

    const candidateSelect = document.getElementById("highlightCandidate");
    const currentSelect = document.getElementById("highlightCurrent");
    candidateSelect.replaceChildren();
    currentSelect.replaceChildren();
    addOption(candidateSelect, "", "Selecione um imóvel");
    addOption(currentSelect, "", "Destaque atual");
    candidates.forEach((property) => addOption(candidateSelect, property.id, property.titulo));
    featuredProperties.forEach((property) => addOption(currentSelect, property.id, property.titulo));
    if (featuredProperties.length < 6) {
        featuredMessage.textContent = `Ainda faltam ${6 - featuredProperties.length} imóvel(is) em destaque. Complete as vagas para publicar exatamente 6.`;
        featuredMessage.className = "panel-message warning";
    } else {
        featuredMessage.textContent = "A vitrine está completa com exatamente 6 imóveis.";
        featuredMessage.className = "panel-message success";
    }
    updateStats();
}

async function loadHighlights() {
    const data = await request("/api/Admin/destaques");
    renderHighlights(data);
}

async function addHighlight() {
    const id = document.getElementById("highlightCandidate").value;
    if (!id) return setMessage(featuredMessage, "Selecione um imóvel para adicionar ao destaque.", "error");
    try {
        await request(`/api/Imoveis/${encodeURIComponent(id)}/destaque`, { method: "POST" });
        await loadHighlights();
    } catch (error) { setMessage(featuredMessage, error.message, "error"); }
}

async function removeHighlight(property) {
    try {
        await request(`/api/Imoveis/${encodeURIComponent(property.id)}/destaque`, { method: "DELETE" });
        await loadHighlights();
    } catch (error) { setMessage(featuredMessage, error.message, "error"); }
}

async function swapHighlight() {
    const oldId = document.getElementById("highlightCurrent").value;
    const newId = document.getElementById("highlightCandidate").value;
    if (!oldId || !newId) return setMessage(featuredMessage, "Escolha o destaque atual e o novo imóvel.", "error");
    try {
        await request("/api/Imoveis/destaques/trocar", { method: "POST", body: JSON.stringify({ antigoId: oldId, novoId: newId }) });
        await loadHighlights();
    } catch (error) { setMessage(featuredMessage, error.message, "error"); }
}

function renderPhotoPreview(property = null) {
    photoPreview.replaceChildren();
    const photos = property?.fotos || [];
    photos.forEach((photo) => {
        const item = document.createElement("div");
        item.className = "photo-item";
        const image = document.createElement("img");
        image.src = imageUrl(photo);
        image.alt = "Foto do imóvel";
        const main = document.createElement("button");
        main.type = "button";
        main.textContent = property.imagemPrincipal === photo ? "Imagem principal" : "Definir como principal";
        main.disabled = property.imagemPrincipal === photo;
        main.addEventListener("click", async () => {
            try {
                const updated = await request(`/api/Imoveis/${property.id}/imagem-principal`, { method: "PUT", body: JSON.stringify({ foto: photo }) });
                Object.assign(property, updated);
                renderPhotoPreview(property);
                renderProperties();
            } catch (error) { setMessage(formMessage, error.message, "error"); }
        });
        item.append(image, main);
        if ((property.fotosGerenciadas || []).includes(photo)) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Remover foto";
            remove.addEventListener("click", async () => {
                try {
                    const updated = await request(`/api/Imoveis/${property.id}/fotos`, { method: "DELETE", body: JSON.stringify({ foto: photo }) });
                    Object.assign(property, updated);
                    renderPhotoPreview(property);
                    renderProperties();
                } catch (error) { setMessage(formMessage, error.message, "error"); }
            });
            item.appendChild(remove);
        }
        photoPreview.appendChild(item);
    });
    pendingFiles.forEach((file, index) => {
        const item = document.createElement("div");
        item.className = "photo-item";
        const image = document.createElement("img");
        image.src = URL.createObjectURL(file);
        image.alt = file.name;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remover antes de salvar";
        remove.addEventListener("click", () => { pendingFiles.splice(index, 1); renderPhotoPreview(property); });
        item.append(image, remove);
        photoPreview.appendChild(item);
    });
}

function fillForm(property) {
    document.getElementById("propertyId").value = property.id;
    ["titulo", "tipo", "preco", "cidade", "estado", "localizacao", "area", "quartos", "banheiros", "vagas", "descricao"].forEach((field) => {
        if (field === "preco") setPriceDigits(property[field]);
        else document.getElementById(field).value = property[field] ?? "";
    });
    document.getElementById("fotos").value = Array.isArray(property.fotos) ? property.fotos.join("\n") : "";
    document.getElementById("destaque").checked = Boolean(property.destaque);
    document.getElementById("status").value = property.status || (property.vendido ? "Vendido" : "Disponível");
    document.getElementById("formTitle").textContent = `Editar imóvel #${property.id}`;
    pendingFiles = [];
    renderPhotoPreview(property);
    document.getElementById("formulario").scrollIntoView({ behavior: "smooth" });
}

function resetForm() {
    form.reset();
    document.getElementById("propertyId").value = "";
    document.getElementById("formTitle").textContent = "Novo imóvel";
    formMessage.textContent = "";
    pendingFiles = [];
    setPriceDigits("");
    renderPhotoPreview({ fotos: [], imagemPrincipal: "" });
}

function formPayload() {
    const data = Object.fromEntries(new FormData(form).entries());
    data.titulo = String(data.titulo || "").trim();
    data.tipo = String(data.tipo || "").trim();
    data.cidade = String(data.cidade || "").trim();
    data.estado = String(data.estado || "").trim().toUpperCase();
    logPropertyValidation(data);
    ["area", "quartos", "banheiros", "vagas"].forEach((field) => { data[field] = data[field] ? Number(data[field]) : null; });
    data.preco = parsePriceInput(data.preco);
    data.destaque = document.getElementById("destaque").checked;
    data.status = document.getElementById("status").value;
    data.vendido = data.status === "Vendido";
    data.fotos = String(data.fotos || "").split(/\r?\n/).map((photo) => photo.trim()).filter(Boolean);
    return data;
}

async function uploadPendingPhotos(id) {
    if (!pendingFiles.length) return null;
    const body = new FormData();
    pendingFiles.forEach((file) => body.append("fotos", file, file.name));
    return request(`/api/Imoveis/${encodeURIComponent(id)}/fotos`, { method: "POST", body });
}

async function loadProperties() {
    try {
        properties = await request("/api/Imoveis");
        if (!Array.isArray(properties)) throw new Error("A API retornou uma listagem inválida.");
        renderProperties();
        document.getElementById("apiStatus").textContent = `${properties.length} imóvel(is) carregado(s).`;
        await loadHighlights();
    } catch (error) {
        setMessage(listMessage, error.message || "Não foi possível carregar os imóveis.", "error");
        document.getElementById("apiStatus").textContent = error.message || "Não foi possível conectar à API.";
    }
}

async function deleteProperty(property) {
    if (!window.confirm(`Excluir o imóvel "${property.titulo}"? Essa ação não pode ser desfeita.`)) return;
    try {
        await request(`/api/Imoveis/${encodeURIComponent(property.id)}`, { method: "DELETE" });
        properties = properties.filter((item) => item.id !== property.id);
        renderProperties();
        await loadHighlights();
        setMessage(formMessage, "Imóvel excluído com sucesso.", "success");
    } catch (error) { setMessage(formMessage, error.message, "error"); }
}

priceInput.addEventListener("keydown", (event) => {
    if (/^\d$/.test(event.key)) {
        event.preventDefault();
        const selected = priceInput.selectionStart !== priceInput.selectionEnd;
        setPriceDigits(`${selected ? "" : priceInput.dataset.rawDigits || ""}${event.key}`);
    } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        setPriceDigits(priceInput.selectionStart !== priceInput.selectionEnd ? "" : (priceInput.dataset.rawDigits || "").slice(0, -1));
    }
});
priceInput.addEventListener("paste", (event) => {
    event.preventDefault();
    setPriceDigits(event.clipboardData.getData("text").replace(/\D/g, ""));
});
priceInput.addEventListener("input", () => {
    if (priceInput.value !== formatPriceInput(priceInput.value)) setPriceDigits(priceInput.value);
});
photoUpload.addEventListener("change", () => {
    pendingFiles = [...photoUpload.files];
    renderPhotoPreview({ fotos: [], imagemPrincipal: "" });
});
document.getElementById("addPhotosButton").addEventListener("click", () => photoUpload.click());
document.getElementById("addHighlightButton").addEventListener("click", addHighlight);
document.getElementById("swapHighlightButton").addEventListener("click", swapHighlight);
form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(formMessage, "Salvando...");
    const id = document.getElementById("propertyId").value;
    try {
        const payload = formPayload();
        logPropertyValidation(payload);
        const missingField = ["titulo", "tipo", "cidade", "estado"].find((field) => !payload[field]);
        if (missingField) {
            setMessage(formMessage, "Preencha título, tipo, cidade e estado válido.", "error");
            return;
        }
        let saved = await request(id ? `/api/Imoveis/${encodeURIComponent(id)}` : "/api/Imoveis", {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(payload)
        });
        const uploaded = await uploadPendingPhotos(saved.id);
        if (uploaded) saved = uploaded;
        const index = properties.findIndex((item) => String(item.id) === String(saved.id));
        if (index === -1) properties.push(saved); else properties[index] = saved;
        renderProperties();
        await loadHighlights();
        resetForm();
        setMessage(formMessage, "Imóvel salvo com sucesso.", "success");
    } catch (error) { setMessage(formMessage, error.message, "error"); }
});

document.getElementById("cancelButton").addEventListener("click", resetForm);
document.getElementById("newPropertyButton").addEventListener("click", () => { resetForm(); document.getElementById("formulario").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("logoutButton").addEventListener("click", async () => {
    await fetch(`${API_URL}/api/Auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    clearSession();
});

(async function init() {
    try {
        const account = await request("/api/Auth/teste-admin");
        document.getElementById("adminEmail").textContent = account.email || "Administrador";
        await loadProperties();
    } catch (error) {
        document.getElementById("apiStatus").textContent = error.message;
    }
})();
