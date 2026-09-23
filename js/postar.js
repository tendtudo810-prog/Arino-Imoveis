const API_URL = window.ARINO_API_URL;
const token = sessionStorage.getItem("adminToken");
const form = document.getElementById("propertyForm");
const message = document.getElementById("formMessage");

function leaveArea() {
    sessionStorage.removeItem("adminToken");
    window.location.href = "login.html";
}

async function checkAccess() {
    const response = await fetch(`${API_URL}/api/Auth/teste-admin`, { credentials: "include", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        leaveArea();
        return false;
    }
    return true;
}

function setMessage(text, type = "") {
    message.textContent = text;
    message.className = `form-message ${type}`;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("Publicando...");
    const formData = new FormData(form);
    const property = Object.fromEntries(formData.entries());
    property.preco = Number(property.preco);
    ["area", "quartos", "banheiros", "vagas"].forEach((field) => {
        property[field] = property[field] ? Number(property[field]) : null;
    });
    property.destaque = formData.has("destaque");
    property.fotos = String(property.fotos || "").split(/\r?\n/).map((photo) => photo.trim()).filter(Boolean);
    delete property.destaque;
    property.destaque = formData.has("destaque");

    try {
        const response = await fetch(`${API_URL}/api/Imoveis`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            credentials: "include",
            body: JSON.stringify(property)
        });
        const result = await response.json();
        if (response.status === 401) return leaveArea();
        if (!response.ok) throw new Error(result.mensagem || "Não foi possível publicar o anúncio.");
        setMessage(`Anúncio publicado com sucesso. ID: ${result.id}`, "success");
        form.reset();
    } catch (error) {
        setMessage(error.message, "error");
    }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
    await fetch(`${API_URL}/api/Auth/logout`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${token}` } });
    leaveArea();
});
checkAccess().catch(() => leaveArea());
