const API_URL = window.ARINO_API_URL;
const WHATSAPP_NUMBER = "5561996973773";

const page = document.getElementById("property-page");
const statusMessage = document.getElementById("property-status");
const content = document.getElementById("property-content");
const gallery = document.getElementById("carousel-container");
const thumbnails = document.getElementById("carousel-thumbnails");

let currentSlide = 0;
let imageUrls = [];

function formatValue(value) {
    if (value === null || value === undefined || value === "") return "Não informado";
    return String(value);
}

function formatPrice(value) {
    if (typeof value === "number") {
        return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }
    return formatValue(value);
}

function resolveImageUrl(value) {
    const image = value;
    if (!image) return "";
    if (/^(https?:|data:|\/\/)/i.test(image)) return image;
    return image.startsWith("/") ? `${API_URL}${image}` : image;
}

function getImages(property) {
    return (Array.isArray(property.fotos) ? property.fotos : [])
        .map(resolveImageUrl)
        .filter((url, index, urls) => urls.indexOf(url) === index);
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = formatValue(value);
}

function showSlide(index) {
    if (!imageUrls.length) return;
    currentSlide = (index + imageUrls.length) % imageUrls.length;
    const slides = gallery.querySelectorAll(".carousel-slide");
    slides.forEach((slide, itemIndex) => slide.classList.toggle("active", itemIndex === currentSlide));
    thumbnails.querySelectorAll("button").forEach((thumbnail, itemIndex) => {
        thumbnail.classList.toggle("active", itemIndex === currentSlide);
    });
}

function renderGallery(property) {
    imageUrls = getImages(property);
    if (!imageUrls.length) {
        document.getElementById("property-gallery").hidden = true;
        return;
    }

    gallery.querySelectorAll(".carousel-slide").forEach((slide) => slide.remove());
    thumbnails.innerHTML = "";

    imageUrls.forEach((url, index) => {
        const slide = document.createElement("div");
        slide.className = `carousel-slide${index === 0 ? " active" : ""}`;
        const image = document.createElement("img");
        image.src = url;
        image.alt = `${formatValue(property.titulo)} - Foto ${index + 1}`;
        slide.appendChild(image);
        gallery.insertBefore(slide, gallery.querySelector(".carousel-nav.prev"));

        const thumbnail = document.createElement("button");
        thumbnail.type = "button";
        thumbnail.className = `carousel-thumbnail${index === 0 ? " active" : ""}`;
        thumbnail.setAttribute("aria-label", `Exibir foto ${index + 1}`);
        const thumbnailImage = document.createElement("img");
        thumbnailImage.src = url;
        thumbnailImage.alt = "";
        thumbnail.appendChild(thumbnailImage);
        thumbnail.addEventListener("click", () => showSlide(index));
        thumbnails.appendChild(thumbnail);
    });

    if (window.initLightbox) {
        window.initLightbox(gallery.querySelectorAll(".carousel-slide img"));
    }
}

function renderFeatures(property) {
    const fields = [
        ["Área", "area", "m²"],
        ["Quartos", "quartos", ""],
        ["Banheiros", "banheiros", ""],
        ["Vagas", "vagas", ""]
    ];
    const container = document.getElementById("property-features");
    container.innerHTML = "";
    fields.forEach(([label, field, suffix]) => {
        const value = property[field];
        if (value === null || value === undefined || value === "") return;
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = `${formatValue(value)}${suffix && value !== "Não informado" ? ` ${suffix}` : ""}`;
        container.append(term, description);
    });
}

function renderExtraFields(property) {
    const ignored = new Set(["id", "titulo", "tipo", "preco", "cidade", "estado", "localizacao", "descricao", "area", "quartos", "banheiros", "vagas", "destaque", "fotos"]);
    const container = document.getElementById("property-extra");
    container.innerHTML = "";
    Object.entries(property).forEach(([key, value]) => {
        if (ignored.has(key) || value === null || value === undefined || typeof value === "object") return;
        const term = document.createElement("dt");
        term.textContent = key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
        const description = document.createElement("dd");
        description.textContent = formatValue(value);
        container.append(term, description);
    });
}

function renderProperty(property) {
    const title = property.titulo;
    const location = property.localizacao || [property.cidade, property.estado].filter(Boolean).join(" - ");
    const description = property.descricao;
    const price = property.preco;
    const type = property.tipo;
    const featured = property.destaque;

    document.title = `${formatValue(title)} | ARINO IMÓVEIS`;
    setText("property-title", title);
    setText("property-type", type);
    document.getElementById("property-featured").hidden = !(featured === true || featured === 1 || featured === "true");
    setText("property-location", location);
    setText("property-price", formatPrice(price));
    setText("property-description", description);
    renderFeatures(property);
    renderExtraFields(property);
    renderGallery(property);

    const message = encodeURIComponent(`Olá, tenho interesse no imóvel ${title}${location ? ` em ${location}` : ""}.`);
    document.getElementById("contact-button").href = `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
}

async function loadProperty() {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id || !/^\d+$/.test(id)) throw new Error("Informe um ID válido na URL.");
    const response = await fetch(`${API_URL}/api/Imoveis/${encodeURIComponent(id)}`);
    if (response.status === 404) throw new Error("Imóvel não encontrado.");
    if (!response.ok) throw new Error(`A API respondeu com HTTP ${response.status}.`);
    return response.json();
}

function getLoadErrorMessage(error) {
    if (error instanceof TypeError && error.message.toLowerCase().includes("fetch")) {
        return `Não foi possível conectar à API em ${API_URL}. Inicie o backend e recarregue esta página.`;
    }
    return error.message || "Não foi possível carregar o imóvel.";
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const property = await loadProperty();
        if (!property || typeof property !== "object") throw new Error("A API não retornou um imóvel válido.");
        renderProperty(property);
        content.hidden = false;
        statusMessage.hidden = true;
    } catch (error) {
        statusMessage.textContent = `Não foi possível carregar este imóvel. ${getLoadErrorMessage(error)}`;
    }

    document.querySelector(".carousel-nav.prev").addEventListener("click", () => showSlide(currentSlide - 1));
    document.querySelector(".carousel-nav.next").addEventListener("click", () => showSlide(currentSlide + 1));
    document.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (document.querySelector(".lightbox.active")) return;
        showSlide(currentSlide + (event.key === "ArrowRight" ? 1 : -1));
    });
});