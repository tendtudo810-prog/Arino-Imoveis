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

if (process.env.NODE_ENV !== "production") {
    loadEnvironmentFile(path.join(__dirname, ".env"));
    loadEnvironmentFile(path.join(__dirname, ".env.local"));
}

const NODE_ENV = process.env.NODE_ENV || "development";
const configuredPort = process.env.PORT || (NODE_ENV === "production" ? "" : "5254");
const PORT = Number(configuredPort);

if (!configuredPort || !Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
    throw new Error("A variável PORT deve ser um número válido. Em produção, o provedor deve definir PORT.");
}

const APPLICATION_ROOT = path.resolve(__dirname, "..");
const PERSISTENT_STORAGE_ROOT = path.join(
    path.sep,
    "var",
    "lib",
    "arino-imoveis"
);

function resolveStoragePath(environmentVariable, fallback) {
    const configuredPath = process.env[environmentVariable];
    const storagePath = configuredPath || fallback;

    if (NODE_ENV === "production" && !path.isAbsolute(storagePath)) {
        throw new Error(
            `${environmentVariable} deve apontar para um caminho absoluto no armazenamento persistente em produção.`
        );
    }

    const resolvedPath = path.resolve(storagePath);

    if (NODE_ENV === "production") {
        const relativePath = path.relative(APPLICATION_ROOT, resolvedPath);
        if (
            relativePath === "" ||
            (!relativePath.startsWith(`..${path.sep}`) &&
                relativePath !== ".." &&
                !path.isAbsolute(relativePath))
        ) {
            throw new Error(
                `${environmentVariable} não pode apontar para dentro da pasta da aplicação em produção.`
            );
        }
    }

    return resolvedPath;
}

const DATA_FILE = resolveStoragePath(
    "DATA_FILE",
    NODE_ENV === "production"
        ? path.join(PERSISTENT_STORAGE_ROOT, "data", "imoveis.json")
        : path.join(__dirname, "data", "imoveis.json")
);

const UPLOADS_DIR = resolveStoragePath(
    "UPLOADS_DIR",
    NODE_ENV === "production"
        ? path.join(PERSISTENT_STORAGE_ROOT, "uploads")
        : path.join(__dirname, "uploads")
);

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();

const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || "");
const AUTH_SECRET = String(process.env.AUTH_SECRET || "");
const AUTH_ISSUER = String(process.env.AUTH_ISSUER || "arino-imoveis-api");
const AUTH_AUDIENCE = String(process.env.AUTH_AUDIENCE || "arino-imoveis-admin");
const API_BUILD = "abasthan-fixed-cors-v3";

const DEFAULT_FRONTEND_ORIGINS = [
    "https://www.arinoimoveis.com.br",
    "https://arinoimoveis.com.br",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5501",
    "http://localhost:5502",
    "http://127.0.0.1:5502",
    "http://localhost:3000"
];

const configuredOrigins = String(
    process.env.FRONTEND_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    ""
)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const FRONTEND_ORIGINS = new Set([
    ...DEFAULT_FRONTEND_ORIGINS,
    ...configuredOrigins
]);

const TOKEN_MAX_AGE = 8 * 60 * 60;
const revokedTokens = new Set();
const MAX_UPLOADS = 10;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_JSON_SIZE = 2 * 1024 * 1024;

const allowedStatuses = new Set([
    "Disponível",
    "Vendido",
    "Rascunho"
]);

const uploadRules = new Map([
    [
        "image/jpeg",
        {
            extensions: new Set([".jpg", ".jpeg"]),
            signature: (buffer) =>
                buffer.length >= 3 &&
                buffer[0] === 0xff &&
                buffer[1] === 0xd8 &&
                buffer[2] === 0xff
        }
    ],
    [
        "image/png",
        {
            extensions: new Set([".png"]),
            signature: (buffer) =>
                buffer.subarray(0, 8).equals(
                    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
                )
        }
    ],
    [
        "image/webp",
        {
            extensions: new Set([".webp"]),
            signature: (buffer) =>
                buffer.length >= 12 &&
                buffer.subarray(0, 4).toString() === "RIFF" &&
                buffer.subarray(8, 12).toString() === "WEBP"
        }
    ]
]);

function ensureStorage() {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    if (!fs.existsSync(DATA_FILE)) {
        if (NODE_ENV === "production") {
            throw new Error(
                "DATA_FILE não existe no armazenamento persistente. Restaure o backup do estado atual antes de iniciar a API."
            );
        }

        fs.writeFileSync(DATA_FILE, "[]\n", "utf8");
    }
}

function readProperties() {
    ensureStorage();

    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "[]");
        return Array.isArray(data) ? data : [];
    } catch (error) {
        throw new Error(`Banco JSON inválido: ${error.message}`);
    }
}

function writeProperties(properties) {
    ensureStorage();

    const temporaryFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(
        temporaryFile,
        `${JSON.stringify(properties, null, 2)}\n`,
        "utf8"
    );
    fs.renameSync(temporaryFile, DATA_FILE);
}

function getStoredImages(property) {
    return Array.isArray(property.fotos) ? property.fotos : [];
}

function withImages(property) {
    const storedImages = getStoredImages(property);
    const mainImage =
        property.imagemPrincipal && storedImages.includes(property.imagemPrincipal)
            ? property.imagemPrincipal
            : storedImages[0] || "";

    const orderedImages = mainImage
        ? [mainImage, ...storedImages.filter((image) => image !== mainImage)]
        : storedImages;

    const publicProperty = { ...property };
    delete publicProperty.diretorioImagens;

    return {
        ...publicProperty,
        status: property.status || (property.vendido ? "Vendido" : "Disponível"),
        fotos: orderedImages,
        fotosGerenciadas: storedImages,
        imagemPrincipal: mainImage
    };
}

function encodeBase64Url(value) {
    return Buffer.from(value).toString("base64url");
}

function createToken(email) {
    const now = Math.floor(Date.now() / 1000);

    const header = encodeBase64Url(
        JSON.stringify({ alg: "HS256", typ: "JWT" })
    );

    const payload = encodeBase64Url(
        JSON.stringify({
            email,
            role: "Admin",
            iss: AUTH_ISSUER,
            aud: AUTH_AUDIENCE,
            jti: crypto.randomUUID(),
            iat: now,
            exp: now + TOKEN_MAX_AGE
        })
    );

    const unsignedToken = `${header}.${payload}`;

    const signature = crypto
        .createHmac("sha256", AUTH_SECRET)
        .update(unsignedToken)
        .digest("base64url");

    return `${unsignedToken}.${signature}`;
}

function getBearerToken(request) {
    const authorization = request.headers.authorization || "";
    return authorization.startsWith("Bearer ")
        ? authorization.slice(7).trim()
        : "";
}

function getAuthenticatedEmail(request) {
    const token = getBearerToken(request);

    if (!token || !AUTH_SECRET) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;

    const expected = crypto
        .createHmac("sha256", AUTH_SECRET)
        .update(`${header}.${payload}`)
        .digest("base64url");

    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
        actualBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
        return null;
    }

    try {
        const data = JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8")
        );

        if (
            revokedTokens.has(data.jti) ||
            data.role !== "Admin" ||
            data.email !== ADMIN_EMAIL ||
            data.iss !== AUTH_ISSUER ||
            data.aud !== AUTH_AUDIENCE ||
            !data.exp ||
            data.exp <= Math.floor(Date.now() / 1000)
        ) {
            return null;
        }

        return data.email;
    } catch {
        return null;
    }
}

function revokeToken(request) {
    const token = getBearerToken(request);
    if (!token) return;

    const payload = token.split(".")[1];
    if (!payload) return;

    try {
        const data = JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8")
        );

        if (data.jti) {
            revokedTokens.add(data.jti);
        }
    } catch {
        // Token inválido já não representa uma sessão válida.
    }
}

function setCorsHeaders(request, response) {
    const origin = request.headers.origin || "";

    if (FRONTEND_ORIGINS.has(origin)) {
        response.setHeader(
            "Access-Control-Allow-Origin",
            origin
        );
    }

    response.setHeader(
        "Access-Control-Allow-Credentials",
        "true"
    );

    response.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );

    response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    response.setHeader(
        "Vary",
        "Origin"
    );
}

function sendJson(request, response, status, payload, extraHeaders = {}) {
    if (response.writableEnded || response.destroyed || response.headersSent) {
        return false;
    }

    setCorsHeaders(request, response);

    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...extraHeaders
    });

    if (status === 204) {
        response.end();
        return true;
    }

    response.end(JSON.stringify(payload));
    return true;
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        let rejected = false;

        request.setEncoding("utf8");

        request.on("data", (chunk) => {
            if (rejected) return;

            body += chunk;

            if (Buffer.byteLength(body, "utf8") > MAX_JSON_SIZE) {
                rejected = true;
                reject(new Error("Requisição muito grande."));
                request.resume();
            }
        });

        request.on("end", () => {
            if (!rejected) resolve(body);
        });

        request.on("error", reject);
    });
}

function parseJsonBody(body) {
    try {
        return body ? JSON.parse(body) : {};
    } catch {
        throw new Error("JSON inválido.");
    }
}

async function requireJson(request) {
    return parseJsonBody(await readRequestBody(request));
}

function requireAuth(request, response) {
    const email = getAuthenticatedEmail(request);

    if (!email) {
        sendJson(request, response, 401, {
            mensagem: "Não autenticado. Faça login novamente."
        });
        return null;
    }

    return email;
}

function nextId(properties) {
    return Math.max(
        0,
        ...properties.map((property) => Number(property.id) || 0)
    ) + 1;
}

function normalizeBoolean(value) {
    return value === true || value === 1 || value === "1" || value === "true";
}

function validateProperty(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return "Dados inválidos.";
    }

    const property = { ...input };

    property.titulo = String(property.titulo || "").trim();
    property.tipo = String(property.tipo || "").trim();
    property.cidade = String(property.cidade || "").trim();
    property.estado = String(property.estado || "").trim().toUpperCase();
    property.localizacao = String(property.localizacao || "").trim();
    property.descricao = String(property.descricao || "").trim();

    if (!property.titulo) return "Informe o título do imóvel.";
    if (!property.tipo) return "Informe o tipo do imóvel.";
    if (!property.cidade) return "Informe a cidade do imóvel.";
    if (!/^[A-Z]{2}$/.test(property.estado)) return "Informe um estado válido.";

    // Converter preço para número se for string, mas não multiplicar
    if (typeof property.preco === "string") {
        // Remover formatação brasileira antes de converter
        const digits = property.preco.replace(/\D/g, "");
        property.preco = Number(digits);
    } else {
        property.preco = Number(property.preco);
    }
    
    if (!Number.isFinite(property.preco) || property.preco <= 0) {
        return "Informe um preço válido.";
    }

    for (const field of ["area", "quartos", "banheiros", "vagas"]) {
        if (property[field] === "" || property[field] === null || property[field] === undefined) {
            property[field] = null;
            continue;
        }

        const value = Number(property[field]);

        if (!Number.isFinite(value) || value < 0) {
            return `Informe um valor válido para ${field}.`;
        }

        property[field] = value;
    }

    property.fotos = Array.isArray(property.fotos)
        ? property.fotos
            .filter((photo) => typeof photo === "string" && photo.trim())
            .map((photo) => photo.trim())
            .slice(0, 30)
        : [];

    property.imagemPrincipal =
        typeof property.imagemPrincipal === "string"
            ? property.imagemPrincipal.trim()
            : "";

    property.status = allowedStatuses.has(property.status)
        ? property.status
        : "Disponível";

    property.destaque = normalizeBoolean(property.destaque);
    property.vendido = property.status === "Vendido";

    return property;
}

function validateStoredImage(property, photo) {
    return Array.isArray(property.fotos) && property.fotos.includes(photo);
}

function writeUploadedFile(propertyId, file) {
    const rule = uploadRules.get(file.mimeType);
    const extension = path.extname(file.originalName).toLowerCase();

    if (
        !rule ||
        !rule.extensions.has(extension) ||
        file.buffer.length === 0 ||
        file.buffer.length > MAX_IMAGE_SIZE ||
        !rule.signature(file.buffer)
    ) {
        throw new Error(
            "Arquivo de imagem inválido. Use JPG, JPEG, PNG ou WEBP com até 8 MB."
        );
    }

    const directory = path.join(UPLOADS_DIR, String(propertyId));
    fs.mkdirSync(directory, { recursive: true });

    const fileName = `${crypto.randomUUID()}${extension}`;
    const absolutePath = path.join(directory, fileName);

    fs.writeFileSync(absolutePath, file.buffer, { flag: "wx" });

    return `/media/${encodeURIComponent(propertyId)}/${encodeURIComponent(fileName)}`;
}

function readMultipartImages(request) {
    return new Promise((resolve, reject) => {
        const contentType = request.headers["content-type"] || "";

        if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
            reject(new Error("Envie as imagens como multipart/form-data."));
            return;
        }

        const files = [];
        let parser;

        try {
            parser = Busboy({
                headers: request.headers,
                limits: {
                    files: MAX_UPLOADS,
                    fileSize: MAX_IMAGE_SIZE
                }
            });
        } catch (error) {
            reject(error);
            return;
        }

        parser.on("file", (fieldName, stream, info) => {
            if (!["foto", "fotos", "images", "images[]"].includes(fieldName)) {
                stream.resume();
                return;
            }

            const chunks = [];
            let size = 0;
            let tooLarge = false;

            stream.on("data", (chunk) => {
                size += chunk.length;
                chunks.push(chunk);
            });

            stream.on("limit", () => {
                tooLarge = true;
            });

            stream.on("end", () => {
                if (tooLarge) {
                    reject(new Error("Cada imagem deve ter no máximo 8 MB."));
                    return;
                }

                files.push({
                    fieldName,
                    originalName: info.filename,
                    mimeType: info.mimeType,
                    buffer: Buffer.concat(chunks, size)
                });
            });
        });

        parser.on("finish", () => resolve(files));
        parser.on("error", reject);
        request.on("error", reject);

        request.pipe(parser);
    });
}

function safeMediaPart(value) {
    try {
        return decodeURIComponent(String(value))
            .replace(/[^A-Za-z0-9._-]/g, "");
    } catch {
        return "";
    }
}

function serveMedia(request, response, pathname) {
    if (response.writableEnded || response.destroyed) {
        return;
    }

    setCorsHeaders(request, response);

    const rawRelative = pathname.slice("/media/".length);
    const parts = rawRelative
        .split("/")
        .filter(Boolean)
        .map(safeMediaPart);

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        response.writeHead(404);
        response.end();
        return;
    }

    const uploadsRoot = path.resolve(UPLOADS_DIR);
    const filePath = path.resolve(uploadsRoot, parts[0], parts[1]);
    const relativePath = path.relative(uploadsRoot, filePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        response.writeHead(403);
        response.end();
        return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp"
    };
    const contentType = mimeTypes[extension];

    if (!contentType) {
        response.writeHead(404);
        response.end();
        return;
    }

    let stats;
    try {
        stats = fs.statSync(filePath);
    } catch {
        response.writeHead(404);
        response.end();
        return;
    }

    if (!stats.isFile()) {
        response.writeHead(404);
        response.end();
        return;
    }

    response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stats.size,
        "Cache-Control": "public, max-age=31536000, immutable"
    });

    const stream = fs.createReadStream(filePath);

    stream.on("error", (error) => {
        console.error("Erro ao ler imagem:", error);
        if (!response.writableEnded) {
            response.destroy();
        }
    });

    stream.pipe(response);
}

function getFeatured(properties) {
    return properties.filter((property) => property.destaque === true);
}

function getFeaturedCount(properties) {
    return getFeatured(properties).length;
}

async function routeApi(request, response, url) {
    const pathname = url.pathname.replace(/\/+$/, "").toLowerCase() || "/";

    if (request.method === "GET" && pathname === "/api/health") {
        return sendJson(request, response, 200, {
            status: "ok",
            api: "arino-imoveis",
            build: API_BUILD,
            time: new Date().toISOString()
        });
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
        try {
            const data = await requireJson(request);
            const email = String(data.email || data.emailAdmin || "").trim().toLowerCase();
            const senha = String(data.senha || data.password || data.senhaAdmin || "");

            if (!email || !senha) {
                return sendJson(request, response, 400, {
                    mensagem: "Informe e-mail e senha."
                });
            }

            if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH || !AUTH_SECRET) {
                console.error("Login da API não configurado: faltam secrets de produção.");
                return sendJson(request, response, 500, {
                    mensagem: "Login da API não configurado."
                });
            }

            const validEmail = email === ADMIN_EMAIL;
            const validPassword = await bcrypt.compare(senha, ADMIN_PASSWORD_HASH);

            if (!validEmail || !validPassword) {
                console.warn("Login recusado: credenciais inválidas.");
                return sendJson(request, response, 401, {
                    mensagem: "E-mail ou senha inválidos."
                });
            }

            const token = createToken(ADMIN_EMAIL);

            console.log("Login aprovado para o administrador.");

            return sendJson(request, response, 200, {
                autenticado: true,
                sucesso: true,
                token,
                email: ADMIN_EMAIL,
                usuario: {
                    email: ADMIN_EMAIL,
                    role: "Admin"
                }
            });
        } catch (error) {
            console.error("Erro no login:", error);
            return sendJson(request, response, 400, {
                mensagem: error.message || "Requisição inválida."
            });
        }
    }

    if (request.method === "POST" && pathname === "/api/auth/logout") {
        revokeToken(request);
        return sendJson(request, response, 200, {
            mensagem: "Sessão encerrada."
        });
    }

    if (request.method === "GET" && pathname === "/api/auth/teste-admin") {
        const email = getAuthenticatedEmail(request);

        if (!email) {
            return sendJson(request, response, 401, {
                mensagem: "Não autenticado."
            });
        }

        return sendJson(request, response, 200, {
            autenticado: true,
            email
        });
    }

    if (request.method === "GET" && pathname === "/api/imoveis/destaques") {
        return sendJson(
            request,
            response,
            200,
            getFeatured(readProperties()).map(withImages)
        );
    }

    if (request.method === "GET" && pathname === "/api/admin/destaques") {
        const email = requireAuth(request, response);
        if (!email) return;

        const properties = readProperties();
        const destaques = getFeatured(properties);
        const disponiveis = properties.filter((property) => property.destaque !== true);

        return sendJson(request, response, 200, {
            quantidade: destaques.length,
            destaques: destaques.map(withImages),
            disponiveis: disponiveis.map(withImages)
        });
    }

    if (request.method === "POST" && pathname === "/api/imoveis/destaques/trocar") {
        const email = requireAuth(request, response);
        if (!email) return;

        try {
            const { antigoId, novoId } = await requireJson(request);
            const properties = readProperties();
            const currentHighlights = getFeatured(properties);
            const oldProperty = properties.find((property) => String(property.id) === String(antigoId));
            const newProperty = properties.find((property) => String(property.id) === String(novoId));

            if (!oldProperty || !newProperty) {
                return sendJson(request, response, 404, {
                    mensagem: "Imóvel antigo ou novo não encontrado."
                });
            }

            if (currentHighlights.length !== 6) {
                return sendJson(request, response, 409, {
                    mensagem: "A troca exige exatamente 6 destaques configurados."
                });
            }

            if (String(antigoId) === String(novoId)) {
                return sendJson(request, response, 409, {
                    mensagem: "Escolha dois imóveis diferentes para fazer a troca."
                });
            }

            if (oldProperty.destaque !== true || newProperty.destaque === true) {
                return sendJson(request, response, 409, {
                    mensagem: "Escolha um destaque atual e um imóvel fora do destaque."
                });
            }

            const nextProperties = properties.map((property) => {
                if (String(property.id) === String(antigoId)) {
                    return { ...property, destaque: false };
                }

                if (String(property.id) === String(novoId)) {
                    return { ...property, destaque: true };
                }

                return property;
            });

            if (getFeaturedCount(nextProperties) !== 6) {
                return sendJson(request, response, 409, {
                    mensagem: "A troca não pode ser concluída sem manter exatamente 6 destaques."
                });
            }

            writeProperties(nextProperties);

            return sendJson(request, response, 200, {
                mensagem: "Destaque trocado com sucesso.",
                quantidade: getFeaturedCount(nextProperties),
                destaques: getFeatured(nextProperties).map(withImages)
            });
        } catch (error) {
            return sendJson(request, response, 400, {
                mensagem: error.message || "Requisição inválida."
            });
        }
    }

    if (request.method === "GET" && pathname === "/api/imoveis") {
        return sendJson(
            request,
            response,
            200,
            readProperties().map(withImages)
        );
    }

    const photoMatch = pathname.match(/^\/api\/imoveis\/([^/]+)\/fotos$/i);
    if (photoMatch && ["POST", "DELETE"].includes(request.method)) {
        const email = requireAuth(request, response);
        if (!email) return;

        const properties = readProperties();
        const property = properties.find(
            (item) => String(item.id) === decodeURIComponent(photoMatch[1])
        );

        if (!property) {
            return sendJson(request, response, 404, {
                mensagem: "Imóvel não encontrado."
            });
        }

        try {
            if (request.method === "POST") {
                const files = await readMultipartImages(request);

                if (!files.length) {
                    return sendJson(request, response, 400, {
                        mensagem: "Selecione pelo menos uma imagem."
                    });
                }

                if (files.length > MAX_UPLOADS) {
                    return sendJson(request, response, 400, {
                        mensagem: `Você pode enviar no máximo ${MAX_UPLOADS} imagens por vez.`
                    });
                }

                const newPhotos = files.map((file) => writeUploadedFile(property.id, file));

                property.fotos = [
                    ...(Array.isArray(property.fotos) ? property.fotos : []),
                    ...newPhotos
                ];

                if (!property.imagemPrincipal) {
                    property.imagemPrincipal = newPhotos[0];
                }

                writeProperties(properties);

                return sendJson(request, response, 201, withImages(property));
            }

            const { foto } = await requireJson(request);

            if (!validateStoredImage(property, foto)) {
                return sendJson(request, response, 404, {
                    mensagem: "Foto não encontrada."
                });
            }

            property.fotos = property.fotos.filter((image) => image !== foto);

            if (property.imagemPrincipal === foto) {
                property.imagemPrincipal = property.fotos[0] || "";
            }

            if (typeof foto === "string" && foto.startsWith("/media/")) {
                const mediaPath = path.resolve(
                    UPLOADS_DIR,
                    ...foto.replace(/^\/media\//i, "").split("/").map(safeMediaPart)
                );

                const uploadsRoot = path.resolve(UPLOADS_DIR);
                const relativePath = path.relative(uploadsRoot, mediaPath);

                if (
                    !relativePath.startsWith("..") &&
                    !path.isAbsolute(relativePath) &&
                    fs.existsSync(mediaPath)
                ) {
                    fs.unlinkSync(mediaPath);
                }
            }

            writeProperties(properties);

            return sendJson(request, response, 200, withImages(property));
        } catch (error) {
            return sendJson(request, response, 400, {
                mensagem: error.message || "Não foi possível processar as imagens."
            });
        }
    }

    const mainImageMatch = pathname.match(/^\/api\/imoveis\/([^/]+)\/(?:imagem-principal|foto-principal)$/i);
    if (mainImageMatch && request.method === "PUT") {
        const email = requireAuth(request, response);
        if (!email) return;

        try {
            const { foto, url } = await requireJson(request);
            const selectedPhoto = typeof foto === "string" ? foto : url;
            const properties = readProperties();
            const property = properties.find(
                (item) => String(item.id) === decodeURIComponent(mainImageMatch[1])
            );

            if (!property) {
                return sendJson(request, response, 404, {
                    mensagem: "Imóvel não encontrado."
                });
            }

            if (!validateStoredImage(property, selectedPhoto)) {
                return sendJson(request, response, 400, {
                    mensagem: "A imagem principal precisa pertencer ao imóvel."
                });
            }

            property.imagemPrincipal = selectedPhoto;
            writeProperties(properties);

            return sendJson(request, response, 200, withImages(property));
        } catch (error) {
            return sendJson(request, response, 400, {
                mensagem: error.message || "Requisição inválida."
            });
        }
    }

    const highlightMatch = pathname.match(/^\/api\/imoveis\/([^/]+)\/destaque$/i);
    if (highlightMatch && ["POST", "PUT", "DELETE"].includes(request.method)) {
        const email = requireAuth(request, response);
        if (!email) return;

        const properties = readProperties();
        const property = properties.find(
            (item) => String(item.id) === decodeURIComponent(highlightMatch[1])
        );

        if (!property) {
            return sendJson(request, response, 404, {
                mensagem: "Imóvel não encontrado."
            });
        }

        const count = getFeaturedCount(properties);

        if (request.method === "POST") {
            if (property.destaque === true) {
                return sendJson(request, response, 409, {
                    mensagem: "Este imóvel já está em destaque."
                });
            }

            if (count !== 5) {
                return sendJson(request, response, 409, {
                    mensagem: count >= 6
                        ? "Já existem 6 imóveis em destaque. Use a troca de destaque."
                        : "A adição só pode completar a vitrine quando houver exatamente 5 destaques."
                });
            }

            property.destaque = true;
            writeProperties(properties);

            return sendJson(request, response, 200, {
                mensagem: "Imóvel adicionado ao destaque.",
                quantidade: getFeaturedCount(properties),
                imovel: withImages(property)
            });
        }

        if (request.method === "DELETE") {
            if (property.destaque !== true) {
                return sendJson(request, response, 409, {
                    mensagem: "Este imóvel não está em destaque."
                });
            }

            if (count !== 7) {
                return sendJson(request, response, 409, {
                    mensagem: "A remoção só pode corrigir uma vitrine com 7 destaques e deixá-la com exatamente 6. Use 'Trocar imóvel' para substituir anúncios."
                });
            }

            property.destaque = false;
            writeProperties(properties);

            return sendJson(request, response, 200, {
                mensagem: "Imóvel removido do destaque.",
                quantidade: getFeaturedCount(properties),
                imovel: withImages(property)
            });
        }

        try {
            const data = await requireJson(request);
            const enabled = normalizeBoolean(
                data.destaque ?? data.highlight ?? true
            );

            if (!enabled) {
                return sendJson(request, response, 409, {
                    mensagem: "Não é permitido remover um dos 6 destaques por edição. Use 'Trocar imóvel'."
                });
            }

            if (property.destaque === true) {
                return sendJson(request, response, 409, {
                    mensagem: "Este imóvel já está em destaque."
                });
            }

            if (count !== 5) {
                return sendJson(request, response, 409, {
                    mensagem: count >= 6
                        ? "Já existem 6 imóveis em destaque. Use 'Trocar imóvel'."
                        : "A adição só pode completar a vitrine quando houver exatamente 5 destaques."
                });
            }

            property.destaque = true;
            writeProperties(properties);

            return sendJson(request, response, 200, {
                mensagem: "Imóvel adicionado ao destaque.",
                quantidade: getFeaturedCount(properties),
                imovel: withImages(property)
            });
        } catch (error) {
            return sendJson(request, response, 400, {
                mensagem: error.message || "Requisição inválida."
            });
        }
    }

    const propertyMatch = pathname.match(/^\/api\/(?:imoveis|imovel)\/([^/]+)$/i);
    if (propertyMatch && ["GET", "PUT", "DELETE"].includes(request.method)) {
        const id = decodeURIComponent(propertyMatch[1]);
        const properties = readProperties();
        const index = properties.findIndex((item) => String(item.id) === id);

        if (request.method === "GET") {
            if (index === -1) {
                return sendJson(request, response, 404, {
                    mensagem: "Imóvel não encontrado."
                });
            }

            return sendJson(request, response, 200, withImages(properties[index]));
        }

        const email = requireAuth(request, response);
        if (!email) return;

        if (index === -1) {
            return sendJson(request, response, 404, {
                mensagem: "Imóvel não encontrado."
            });
        }

        if (request.method === "DELETE") {
            if (
                properties[index].destaque === true &&
                getFeaturedCount(properties) !== 7
            ) {
                return sendJson(request, response, 409, {
                    mensagem: "A exclusão não pode deixar a vitrine diferente de 6 destaques. Use 'Trocar imóvel' primeiro."
                });
            }

            const [removed] = properties.splice(index, 1);
            writeProperties(properties);

            return sendJson(request, response, 200, {
                mensagem: "Imóvel excluído com sucesso.",
                id: removed.id
            });
        }

        try {
            const input = await requireJson(request);
            const validation = validateProperty(input);

            if (typeof validation === "string") {
                return sendJson(request, response, 400, {
                    mensagem: validation
                });
            }

            const wasFeatured = properties[index].destaque === true;

            if (wasFeatured && validation.destaque !== true) {
                return sendJson(request, response, 409, {
                    mensagem: "Este imóvel faz parte dos 6 destaques. Use 'Trocar imóvel' para substituí-lo."
                });
            }

            if (
                validation.destaque === true &&
                !wasFeatured &&
                getFeaturedCount(properties) !== 5
            ) {
                return sendJson(request, response, 409, {
                    mensagem: getFeaturedCount(properties) >= 6
                        ? "Já existem 6 imóveis em destaque. Use 'Trocar imóvel' para substituir um anúncio."
                        : "A adição só pode completar a vitrine quando houver exatamente 5 destaques."
                });
            }

            const updated = {
                ...properties[index],
                ...validation,
                id: properties[index].id
            };

            if (!Object.prototype.hasOwnProperty.call(input, "diretorioImagens")) {
                updated.diretorioImagens = properties[index].diretorioImagens;
            }

            properties[index] = updated;
            writeProperties(properties);

            return sendJson(request, response, 200, withImages(updated));
        } catch (error) {
            return sendJson(request, response, 400, {
                mensagem: error.message || "Requisição inválida."
            });
        }
    }

    if (request.method === "POST" && pathname === "/api/imoveis") {
        const email = requireAuth(request, response);
        if (!email) return;

        try {
            const input = await requireJson(request);
            const validation = validateProperty(input);

            if (typeof validation === "string") {
                return sendJson(request, response, 400, {
                    mensagem: validation
                });
            }

            const properties = readProperties();
            const highlightCount = getFeaturedCount(properties);

            if (validation.destaque && highlightCount !== 5) {
                return sendJson(request, response, 409, {
                    mensagem: highlightCount >= 6
                        ? "Já existem 6 imóveis em destaque. Use a troca de destaque para substituir um anúncio."
                        : "A adição só pode completar a vitrine quando houver exatamente 5 destaques."
                });
            }

            const created = {
                ...validation,
                id: nextId(properties)
            };

            properties.push(created);
            writeProperties(properties);

            return sendJson(request, response, 201, withImages(created));
        } catch (error) {
            return sendJson(request, response, 400, {
                mensagem: error.message || "Requisição inválida."
            });
        }
    }

    return sendJson(request, response, 404, {
        mensagem: "Endpoint não encontrado."
    });
}

const server = http.createServer(async (request, response) => {
    setCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
        return sendJson(request, response, 204, {});
    }

    const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`
    );

    if (
        request.method === "GET" &&
        url.pathname.toLowerCase().startsWith("/media/")
    ) {
        try {
            serveMedia(request, response, url.pathname);
        } catch (error) {
            console.error("Erro ao servir mídia:", error);
            if (!response.headersSent) {
                response.writeHead(500);
                response.end();
            } else if (!response.writableEnded) {
                response.destroy();
            }
        }

        return;
    }

    if (!url.pathname.toLowerCase().startsWith("/api/")) {
        return sendJson(request, response, 404, {
            mensagem: "Use um endpoint /api."
        });
    }

    try {
        await routeApi(request, response, url);
    } catch (error) {
        console.error("Erro interno da API:", error);

        if (!response.headersSent) {
            sendJson(
                request,
                response,
                500,
                NODE_ENV === "production"
                    ? { mensagem: "Erro interno do servidor." }
                    : {
                        mensagem: "Erro interno do servidor.",
                        detalhe: error.message
                    }
            );
        }
    }
});

ensureStorage();

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `API Arino Imóveis disponível na porta ${PORT} (${NODE_ENV}). Build: ${API_BUILD}`
    );
});

function shutdown(signal) {
    console.log(`Recebido ${signal}; encerrando servidor.`);

    server.close((error) => {
        if (error) {
            console.error("Erro ao encerrar servidor:", error);
            process.exitCode = 1;
        }

        process.exit();
    });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));