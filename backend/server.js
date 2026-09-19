const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const bcrypt = require("bcryptjs");
const Busboy = require("busboy");

function loadEnvironmentFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
}

loadEnvironmentFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5254);
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(__dirname, "data", "imoveis.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const AUTH_SECRET = process.env.AUTH_SECRET || "";
const AUTH_ISSUER = process.env.AUTH_ISSUER || "arino-imoveis-api";
const AUTH_AUDIENCE = process.env.AUTH_AUDIENCE || "arino-imoveis-admin";
const FRONTEND_ORIGINS = new Set((process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || "null").split(",").map((origin) => origin.trim()).filter(Boolean));
const TOKEN_MAX_AGE = 60 * 60 * 8;
const revokedTokens = new Set();
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const uploadRules = new Map([
    ["image/jpeg", { extensions: new Set([".jpg", ".jpeg"]), signature: (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
    ["image/png", { extensions: new Set([".png"]), signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
    ["image/webp", { extensions: new Set([".webp"]), signature: (buffer) => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" }]
]);
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const allowedStatuses = new Set(["Disponível", "Vendido", "Rascunho"]);
const propertyFields = ["titulo", "tipo", "preco", "cidade", "estado", "localizacao", "descricao", "area", "quartos", "banheiros", "vagas", "fotos", "imagemPrincipal", "status", "destaque"];

function readProperties() {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
}

function writeProperties(properties) {
    const temporaryFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(properties, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryFile, DATA_FILE);
}

function getStoredImages(property) {
    const directory = property.diretorioImagens ? path.join(ROOT, property.diretorioImagens) : null;
    const files = directory && fs.existsSync(directory)
        ? fs.readdirSync(directory).filter((file) => imageExtensions.has(path.extname(file).toLowerCase())).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        : [];
    const legacyImages = files.map((file) => `${encodeURIComponent(property.diretorioImagens)}/${file.split("/").map(encodeURIComponent).join("/")}`);
    return [...legacyImages, ...(Array.isArray(property.fotos) ? property.fotos : [])].filter((image, index, images) => images.indexOf(image) === index);
}

function withImages(property) {
    const { diretorioImagens, ...publicProperty } = property;
    const storedImages = getStoredImages(property);
    const managedImages = Array.isArray(property.fotos) ? property.fotos : [];
    const mainImage = property.imagemPrincipal && storedImages.includes(property.imagemPrincipal) ? property.imagemPrincipal : storedImages[0] || "";
    const orderedImages = mainImage ? [mainImage, ...storedImages.filter((image) => image !== mainImage)] : storedImages;
    return {
        ...publicProperty,
        status: property.status || (property.vendido ? "Vendido" : "Disponível"),
        fotos: orderedImages,
        fotosGerenciadas: managedImages,
        imagemPrincipal: mainImage
    };
}

function writeUploadedFile(propertyId, file) {
    const rule = uploadRules.get(file.mimeType);
    const extension = path.extname(file.originalName).toLowerCase();
    if (!rule || !rule.extensions.has(extension) || file.buffer.length === 0 || file.buffer.length > MAX_IMAGE_SIZE || !rule.signature(file.buffer)) {
        throw new Error("Arquivo de imagem inválido. Use JPG, JPEG, PNG ou WEBP com até 8 MB.");
    }
    const directory = path.join(UPLOADS_DIR, String(propertyId));
    fs.mkdirSync(directory, { recursive: true });
    const fileName = `${crypto.randomUUID()}${extension}`;
    fs.writeFileSync(path.join(directory, fileName), file.buffer, { flag: "wx" });
    return `/media/${encodeURIComponent(propertyId)}/${encodeURIComponent(fileName)}`;
}

function readMultipartImages(request) {
    return new Promise((resolve, reject) => {
        const contentType = request.headers["content-type"] || "";
        if (!contentType.startsWith("multipart/form-data")) return reject(new Error("Envie as imagens como multipart/form-data."));
        const files = [];
        let totalSize = 0;
        let parser;
        try { parser = Busboy({ headers: request.headers, limits: { files: 10, fileSize: MAX_IMAGE_SIZE } }); } catch (error) { return reject(error); }
        parser.on("file", (fieldName, stream, info) => {
            const chunks = [];
            let size = 0;
            stream.on("data", (chunk) => { size += chunk.length; totalSize += chunk.length; chunks.push(chunk); });
            stream.on("limit", () => reject(new Error("Cada imagem deve ter no máximo 8 MB.")));
            stream.on("end", () => files.push({ fieldName, originalName: info.filename, mimeType: info.mimeType, buffer: Buffer.concat(chunks, size) }));
        });
        parser.on("finish", () => resolve(files));
        parser.on("error", reject);
        request.on("error", reject);
        request.pipe(parser);
    });
}

function encodeBase64Url(value) {
    return Buffer.from(value).toString("base64url");
}

function createToken(email) {
    const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = encodeBase64Url(JSON.stringify({ email, role: "Admin", iss: AUTH_ISSUER, aud: AUTH_AUDIENCE, jti: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + TOKEN_MAX_AGE }));
    const unsignedToken = `${header}.${payload}`;
    const signature = crypto.createHmac("sha256", AUTH_SECRET).update(unsignedToken).digest("base64url");
    return `${unsignedToken}.${signature}`;
}

function getBearerToken(request) {
    const header = request.headers.authorization || "";
    return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function getAuthenticatedEmail(request) {
    const token = getBearerToken(request);
    if (!token || !AUTH_SECRET) return null;
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) return null;
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(`${header}.${payload}`).digest("base64url");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (revokedTokens.has(data.jti) || data.role !== "Admin" || data.email !== ADMIN_EMAIL || data.iss !== AUTH_ISSUER || data.aud !== AUTH_AUDIENCE || data.exp <= Math.floor(Date.now() / 1000)) return null;
        return data.email;
    } catch {
        return null;
    }
}

function revokeToken(request) {
    const token = getBearerToken(request);
    if (!token) return;
    const payload = token.split(".")[1];
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (data.jti) revokedTokens.add(data.jti);
    } catch {
        // Token inválido já não é uma sessão válida.
    }
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) request.destroy(new Error("Payload muito grande."));
        });
        request.on("end", () => resolve(body));
        request.on("error", reject);
    });
}

function sendJson(request, response, status, payload, extraHeaders = {}) {
    const origin = request.headers.origin;
    const allowedOrigin = origin && (FRONTEND_ORIGINS.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ? origin : FRONTEND_ORIGINS.values().next().value || "null";
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin",
        ...extraHeaders
    };
    response.writeHead(status, headers);
    response.end(JSON.stringify(payload));
}

function validateProperty(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return "Dados inválidos.";
    const property = Object.fromEntries(propertyFields.filter((field) => Object.prototype.hasOwnProperty.call(input, field)).map((field) => [field, input[field]]));
    const requiredValues = {
        titulo: typeof property.titulo === "string" ? property.titulo.trim() : property.titulo,
        tipo: typeof property.tipo === "string" ? property.tipo.trim() : property.tipo,
        cidade: typeof property.cidade === "string" ? property.cidade.trim() : property.cidade,
        estado: typeof property.estado === "string" ? property.estado.trim() : property.estado
    };
    console.log("Diagnóstico de validação recebido:", requiredValues);
    if (typeof requiredValues.titulo !== "string" || !requiredValues.titulo || typeof requiredValues.tipo !== "string" || !requiredValues.tipo || typeof requiredValues.cidade !== "string" || !requiredValues.cidade || typeof requiredValues.estado !== "string" || !/^[A-Za-z]{2}$/.test(requiredValues.estado)) return "Preencha título, tipo, cidade e estado válido.";
    property.titulo = property.titulo.trim();
    property.tipo = property.tipo.trim();
    property.cidade = property.cidade.trim();
    property.estado = property.estado.trim().toUpperCase();
    property.preco = Number(property.preco);
    if (!Number.isFinite(property.preco) || property.preco <= 0) return "Informe um preço válido.";
    for (const field of ["area", "quartos", "banheiros", "vagas"]) {
        if (property[field] === "" || property[field] === null || property[field] === undefined) property[field] = null;
        else if (!Number.isFinite(Number(property[field])) || Number(property[field]) < 0) return `Informe um valor válido para ${field}.`;
        else property[field] = Number(property[field]);
    }
    property.localizacao = typeof property.localizacao === "string" ? property.localizacao.trim() : "";
    property.descricao = typeof property.descricao === "string" ? property.descricao.trim() : "";
    property.fotos = Array.isArray(property.fotos) ? property.fotos.filter((photo) => typeof photo === "string" && photo.trim()).map((photo) => photo.trim()).slice(0, 30) : [];
    property.imagemPrincipal = typeof property.imagemPrincipal === "string" ? property.imagemPrincipal.trim() : "";
    property.status = allowedStatuses.has(property.status) ? property.status : "Disponível";
    property.destaque = property.destaque === true || property.destaque === 1 || property.destaque === "true";
    property.vendido = property.status === "Vendido";
    return property;
}

async function routeApi(request, response, url) {
    if (url.pathname.toLowerCase() === "/api/auth/login" && request.method === "POST") {
        try {
            const credentials = JSON.parse(await readRequestBody(request));
            const validConfiguration = ADMIN_EMAIL && ADMIN_PASSWORD_HASH && AUTH_SECRET;
            const validEmail = validConfiguration && typeof credentials.email === "string" && credentials.email === ADMIN_EMAIL;
            const validPassword = validConfiguration && typeof credentials.senha === "string" && await bcrypt.compare(credentials.senha, ADMIN_PASSWORD_HASH);
            if (!validEmail || !validPassword) {
                console.warn("Login recusado: credenciais inválidas.");
                return sendJson(request, response, 401, { mensagem: "E-mail ou senha inválidos." });
            }
            console.log("Login aprovado para o administrador; JWT emitido.");
            return sendJson(request, response, 200, { autenticado: true, token: createToken(ADMIN_EMAIL), email: ADMIN_EMAIL });
        } catch {
            return sendJson(request, response, 400, { mensagem: "Requisição inválida." });
        }
    }

    if (url.pathname.toLowerCase() === "/api/auth/logout" && request.method === "POST") {
        revokeToken(request);
        return sendJson(request, response, 200, { mensagem: "Sessão encerrada." });
    }

    if (url.pathname.toLowerCase() === "/api/auth/teste-admin" && request.method === "GET") {
        const email = getAuthenticatedEmail(request);
        if (email) return sendJson(request, response, 200, { autenticado: true, email });
        console.warn("Validação de sessão recusada: Bearer ausente, inválido, expirado ou revogado.");
        return sendJson(request, response, 401, { mensagem: "Não autenticado." });
    }

    const email = getAuthenticatedEmail(request);
    const highlights = url.pathname.match(/^\/api\/imoveis\/destaques(?:\/([^/]+))?$/i);
    if (highlights && request.method === "GET") {
        return sendJson(request, response, 200, readProperties().filter((property) => property.destaque === true).map(withImages));
    }

    if (url.pathname.toLowerCase() === "/api/admin/destaques" && request.method === "GET") {
        if (!email) return sendJson(request, response, 401, { mensagem: "Não autenticado." });
        const properties = readProperties();
        return sendJson(request, response, 200, {
            quantidade: properties.filter((property) => property.destaque === true).length,
            destaques: properties.filter((property) => property.destaque === true).map(withImages),
            disponiveis: properties.filter((property) => property.destaque !== true).map(withImages)
        });
    }

    const swapHighlights = url.pathname.toLowerCase() === "/api/imoveis/destaques/trocar";
    if (swapHighlights && request.method === "POST") {
        if (!email) return sendJson(request, response, 401, { mensagem: "Não autenticado." });
        try {
            const { antigoId, novoId } = JSON.parse(await readRequestBody(request));
            const properties = readProperties();
            const currentHighlights = properties.filter((property) => property.destaque === true);
            const oldProperty = properties.find((property) => String(property.id) === String(antigoId));
            const newProperty = properties.find((property) => String(property.id) === String(novoId));
            if (!oldProperty || !newProperty) return sendJson(request, response, 404, { mensagem: "Imóvel antigo ou novo não encontrado." });
            if (currentHighlights.length !== 6) return sendJson(request, response, 409, { mensagem: "A troca exige exatamente 6 destaques configurados." });
            if (oldProperty.destaque !== true || newProperty.destaque === true) return sendJson(request, response, 409, { mensagem: "Escolha um destaque atual e um imóvel que ainda não esteja em destaque." });
            oldProperty.destaque = false;
            newProperty.destaque = true;
            writeProperties(properties);
            return sendJson(request, response, 200, { mensagem: "Destaque trocado com sucesso.", destaques: properties.filter((property) => property.destaque === true).map(withImages) });
        } catch {
            return sendJson(request, response, 400, { mensagem: "Requisição inválida." });
        }
    }

    const protectedProperty = url.pathname.match(/^\/api\/imoveis\/([^/]+)$/i);
    const propertyPhoto = url.pathname.match(/^\/api\/imoveis\/([^/]+)\/fotos$/i);
    const propertyMainImage = url.pathname.match(/^\/api\/imoveis\/([^/]+)\/imagem-principal$/i);
    const propertyHighlight = url.pathname.match(/^\/api\/imoveis\/([^/]+)\/destaque$/i);
    if (propertyPhoto && ["POST", "DELETE"].includes(request.method)) {
        if (!email) return sendJson(request, response, 401, { mensagem: "Não autenticado." });
        const properties = readProperties();
        const property = properties.find((item) => String(item.id) === decodeURIComponent(propertyPhoto[1]));
        if (!property) return sendJson(request, response, 404, { mensagem: "Imóvel não encontrado." });
        try {
            if (request.method === "POST") {
                const files = await readMultipartImages(request);
                if (!files.length) return sendJson(request, response, 400, { mensagem: "Selecione pelo menos uma imagem." });
                const newPhotos = files.map((file) => writeUploadedFile(property.id, file));
                property.fotos = [...(Array.isArray(property.fotos) ? property.fotos : []), ...newPhotos];
                if (!property.imagemPrincipal) property.imagemPrincipal = newPhotos[0];
                writeProperties(properties);
                return sendJson(request, response, 201, withImages(property));
            }
            const { foto } = JSON.parse(await readRequestBody(request));
            if (typeof foto !== "string" || !Array.isArray(property.fotos) || !property.fotos.includes(foto)) return sendJson(request, response, 404, { mensagem: "Foto não encontrada." });
            property.fotos = property.fotos.filter((image) => image !== foto);
            if (property.imagemPrincipal === foto) property.imagemPrincipal = property.fotos[0] || "";
            if (foto.startsWith("/media/")) {
                const relative = foto.replace(/^\/media\//, "").split("/").map(decodeURIComponent);
                const target = path.resolve(UPLOADS_DIR, ...relative);
                if (target.startsWith(path.resolve(UPLOADS_DIR)) && fs.existsSync(target)) fs.unlinkSync(target);
            }
            writeProperties(properties);
            return sendJson(request, response, 200, withImages(property));
        } catch (error) {
            return sendJson(request, response, 400, { mensagem: error.message || "Não foi possível processar as imagens." });
        }
    }
    if (propertyMainImage && request.method === "PUT") {
        if (!email) return sendJson(request, response, 401, { mensagem: "Não autenticado." });
        try {
            const { foto } = JSON.parse(await readRequestBody(request));
            const properties = readProperties();
            const property = properties.find((item) => String(item.id) === decodeURIComponent(propertyMainImage[1]));
            if (!property) return sendJson(request, response, 404, { mensagem: "Imóvel não encontrado." });
            if (!getStoredImages(property).includes(foto)) return sendJson(request, response, 400, { mensagem: "A imagem principal precisa pertencer ao imóvel." });
            property.imagemPrincipal = foto;
            writeProperties(properties);
            return sendJson(request, response, 200, withImages(property));
        } catch {
            return sendJson(request, response, 400, { mensagem: "Requisição inválida." });
        }
    }
    if (propertyHighlight && ["POST", "DELETE"].includes(request.method)) {
        if (!email) return sendJson(request, response, 401, { mensagem: "Não autenticado." });
        const properties = readProperties();
        const property = properties.find((item) => String(item.id) === decodeURIComponent(propertyHighlight[1]));
        if (!property) return sendJson(request, response, 404, { mensagem: "Imóvel não encontrado." });
        const count = properties.filter((item) => item.destaque === true).length;
        if (request.method === "POST") {
            if (property.destaque === true) return sendJson(request, response, 409, { mensagem: "Este imóvel já está em destaque." });
            if (count >= 6) return sendJson(request, response, 409, { mensagem: "Já existem 6 imóveis em destaque. Remova um imóvel antes de adicionar outro." });
            property.destaque = true;
        } else {
            if (property.destaque !== true) return sendJson(request, response, 409, { mensagem: "Este imóvel não está em destaque." });
            property.destaque = false;
        }
        writeProperties(properties);
        return sendJson(request, response, 200, { mensagem: request.method === "POST" ? "Imóvel adicionado ao destaque." : "Imóvel removido do destaque.", quantidade: properties.filter((item) => item.destaque === true).length });
    }
    if ((request.method === "POST" && url.pathname.toLowerCase() === "/api/imoveis") || (protectedProperty && ["PUT", "DELETE"].includes(request.method))) {
        if (!email) return sendJson(request, response, 401, { mensagem: "Não autenticado." });
        if (request.method === "DELETE") {
            const properties = readProperties();
            const index = properties.findIndex((item) => String(item.id) === decodeURIComponent(protectedProperty[1]));
            if (index === -1) return sendJson(request, response, 404, { mensagem: "Imóvel não encontrado." });
            if (properties[index].destaque === true && properties.filter((item) => item.destaque === true).length <= 6) return sendJson(request, response, 409, { mensagem: "Remova ou troque o destaque antes de excluir este imóvel." });
            const [removed] = properties.splice(index, 1);
            writeProperties(properties);
            return sendJson(request, response, 200, { mensagem: "Imóvel excluído com sucesso.", id: removed.id });
        }
        try {
            const input = JSON.parse(await readRequestBody(request));
            const property = validateProperty(input);
            if (typeof property === "string") return sendJson(request, response, 400, { mensagem: property });
            const properties = readProperties();
            if (request.method === "POST") {
                if (property.destaque && properties.filter((item) => item.destaque === true).length >= 6) return sendJson(request, response, 409, { mensagem: "Já existem 6 imóveis em destaque. Remova um imóvel antes de adicionar outro." });
                const created = { ...property, id: Math.max(0, ...properties.map((item) => Number(item.id) || 0)) + 1 };
                properties.push(created);
                writeProperties(properties);
                return sendJson(request, response, 201, withImages(created));
            }
            const index = properties.findIndex((item) => String(item.id) === decodeURIComponent(protectedProperty[1]));
            if (index === -1) return sendJson(request, response, 404, { mensagem: "Imóvel não encontrado." });
            if (property.destaque && properties[index].destaque !== true && properties.filter((item) => item.destaque === true).length >= 6) return sendJson(request, response, 409, { mensagem: "Já existem 6 imóveis em destaque. Remova um imóvel antes de adicionar outro." });
            const updated = { ...properties[index], ...property, id: properties[index].id };
            if (!Object.prototype.hasOwnProperty.call(input, "diretorioImagens")) updated.diretorioImagens = properties[index].diretorioImagens;
            properties[index] = updated;
            writeProperties(properties);
            return sendJson(request, response, 200, withImages(updated));
        } catch {
            return sendJson(request, response, 400, { mensagem: "Requisição inválida." });
        }
    }

    const match = url.pathname.match(/^\/api\/(?:imoveis|imovel)\/?([^/]*)$/i);
    if (match && request.method === "GET") {
        const properties = readProperties();
        if (!match[1]) return sendJson(request, response, 200, properties.map(withImages));
        const property = properties.find((item) => String(item.id) === decodeURIComponent(match[1]));
        return property ? sendJson(request, response, 200, withImages(property)) : sendJson(request, response, 404, { mensagem: "Imóvel não encontrado." });
    }

    return sendJson(request, response, 404, { mensagem: "Endpoint não encontrado." });
}

const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return sendJson(request, response, 204, {});
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname.toLowerCase().startsWith("/media/")) {
        const relativePath = url.pathname.slice("/media/".length).split("/").map((part) => decodeURIComponent(part));
        const mediaPath = path.resolve(UPLOADS_DIR, ...relativePath);
        if (!mediaPath.startsWith(path.resolve(UPLOADS_DIR)) || !fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
            response.writeHead(404);
            return response.end();
        }
        const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
        response.writeHead(200, { "Content-Type": mimeTypes[path.extname(mediaPath).toLowerCase()] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
        return fs.createReadStream(mediaPath).pipe(response);
    }
    if (!url.pathname.toLowerCase().startsWith("/api/")) return sendJson(request, response, 404, { mensagem: "Use um endpoint /api." });
    try {
        await routeApi(request, response, url);
    } catch (error) {
        console.error("Erro interno da API:", error.message);
        if (!response.headersSent) sendJson(request, response, 500, { mensagem: "Erro interno do servidor." });
    }
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`API Arino Imóveis disponível em http://localhost:${PORT}`);
});
