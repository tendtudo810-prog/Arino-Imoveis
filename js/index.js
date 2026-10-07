const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const bcrypt = require("bcryptjs");

// Carrega backend/.env.local (e backend/.env, se existir) automaticamente.
// Antes, NENHUM arquivo .env era lido pelo código — o README pedia pra
// definir cada variável manualmente no PowerShell a cada sessão. Isso é
// opcional e nunca quebra o boot: se "dotenv" não estiver instalado, ou
// os arquivos não existirem, o backend segue normalmente usando variáveis
// já definidas no ambiente (shell, provedor de hospedagem, etc.).
try {
  const dotenv = require("dotenv");
  dotenv.config({ path: path.join(__dirname, ".env.local") });
  dotenv.config({ path: path.join(__dirname, ".env") });
} catch {
  // "dotenv" não instalado — sem problema.
}

const ROOT = path.resolve(process.cwd());
const DATA_FILE = path.resolve(
  process.env.DATA_FILE || path.join(ROOT, "backend", "data", "imoveis.json")
);
const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR || path.join(ROOT, "backend", "uploads")
);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const AUTH_SECRET = process.env.AUTH_SECRET || "";
const AUTH_ISSUER = process.env.AUTH_ISSUER || "arino-imoveis-api";
const AUTH_AUDIENCE = process.env.AUTH_AUDIENCE || "arino-imoveis-admin";

// USE_BLOB precisa ser resolvido ANTES de decidir se carregamos @vercel/blob.
// Isso é o que permite rodar localmente sem instalar/usar esse pacote.
const USE_BLOB = String(process.env.USE_VERCEL_BLOB || "").toLowerCase() === "true";
const BLOB_DATA_PATH = process.env.BLOB_DATA_PATH || "arino/data/imoveis.json";
const MAX_DIRECT_UPLOAD = 4 * 1024 * 1024;

// CORREÇÃO: "@vercel/blob" só é exigido (require) quando USE_VERCEL_BLOB=true.
// Antes, esse require rodava sempre, no topo do arquivo — e como o pacote não
// está no package.json, QUALQUER execução local (`node backend/index.js`)
// quebrava imediatamente com "Cannot find module '@vercel/blob'", mesmo que
// ninguém pretendesse usar o Blob da Vercel agora.
let put, get, del;
if (USE_BLOB) {
  ({ put, get, del } = require("@vercel/blob"));
}

const allowedStatuses = new Set(["Disponível", "Vendido", "Rascunho"]);
const propertyFields = [
  "titulo", "tipo", "preco", "cidade", "estado", "localizacao",
  "descricao", "area", "quartos", "banheiros", "vagas", "fotos",
  "imagemPrincipal", "status", "destaque", "diretorioImagens"
];

const FRONTEND_ORIGINS = new Set(
  (process.env.FRONTEND_ORIGINS ||
    "https://arinoimoveis.com.br,https://www.arinoimoveis.com.br,http://localhost:5500,http://127.0.0.1:5500")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
);

const uploadRules = new Map([
  ["image/jpeg", {
    extensions: new Set([".jpg", ".jpeg"]),
    signature: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  }],
  ["image/png", {
    extensions: new Set([".png"]),
    signature: (b) => b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  }],
  ["image/webp", {
    extensions: new Set([".webp"]),
    signature: (b) => b.subarray(0, 4).toString() === "RIFF" &&
      b.subarray(8, 12).toString() === "WEBP"
  }]
]);

const TOKEN_MAX_AGE = 60 * 60 * 8;
const revokedTokens = new Set();

function localReadProperties() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return Array.isArray(data) ? data : [];
}

function localWriteProperties(properties) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(properties, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, DATA_FILE);
}

async function blobReadProperties() {
  try {
    const result = await get(BLOB_DATA_PATH, { access: "private" });
    if (!result || !result.stream) return null;
    const chunks = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error && (error.status === 404 || error.code === "BLOB_NOT_FOUND")) return null;
    throw error;
  }
}

async function blobWriteProperties(properties) {
  await put(
    BLOB_DATA_PATH,
    JSON.stringify(properties, null, 2),
    {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
    }
  );
}

async function readProperties() {
  if (!USE_BLOB) return localReadProperties();

  const fromBlob = await blobReadProperties();
  if (fromBlob === null) {
    throw new Error(
      "O arquivo de imóveis não existe no armazenamento persistente. Restauração automática desativada."
    );
  }

  return fromBlob;
}

async function writeProperties(properties) {
  if (USE_BLOB) {
    await blobWriteProperties(properties);
    return;
  }
  localWriteProperties(properties);
}

function getStoredImages(property) {
  return Array.isArray(property.fotos) ? property.fotos : [];
}

function withImages(property) {
  const { diretorioImagens, ...publicProperty } = property;
  const storedImages = getStoredImages(property);
  const mainImage =
    property.imagemPrincipal && storedImages.includes(property.imagemPrincipal)
      ? property.imagemPrincipal
      : storedImages[0] || "";

  const orderedImages = mainImage
    ? [mainImage, ...storedImages.filter((image) => image !== mainImage)]
    : storedImages;

  return {
    ...publicProperty,
    status: property.status || (property.vendido ? "Vendido" : "Disponível"),
    fotos: orderedImages,
    fotosGerenciadas: storedImages,
    imagemPrincipal: mainImage
  };
}

function validateProperty(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "Dados inválidos.";
  }

  const property = Object.fromEntries(
    propertyFields
      .filter((field) => Object.prototype.hasOwnProperty.call(input, field))
      .map((field) => [field, input[field]])
  );

  const titulo = typeof property.titulo === "string" ? property.titulo.trim() : "";
  const tipo = typeof property.tipo === "string" ? property.tipo.trim() : "";
  const cidade = typeof property.cidade === "string" ? property.cidade.trim() : "";
  const estado = typeof property.estado === "string" ? property.estado.trim().toUpperCase() : "";

  if (!titulo || !tipo || !cidade || !/^[A-Za-z]{2}$/.test(estado)) {
    return "Preencha título, tipo, cidade e estado válido.";
  }

  property.titulo = titulo;
  property.tipo = tipo;
  property.cidade = cidade;
  property.estado = estado;
  property.preco = Number(property.preco);

  if (!Number.isFinite(property.preco) || property.preco <= 0) {
    return "Informe um preço válido.";
  }

  for (const field of ["area", "quartos", "banheiros", "vagas"]) {
    if (property[field] === "" || property[field] === null || property[field] === undefined) {
      property[field] = null;
    } else if (!Number.isFinite(Number(property[field])) || Number(property[field]) < 0) {
      return `Informe um valor válido para ${field}.`;
    } else {
      property[field] = Number(property[field]);
    }
  }

  property.localizacao = typeof property.localizacao === "string" ? property.localizacao.trim() : "";
  property.descricao = typeof property.descricao === "string" ? property.descricao.trim() : "";
  property.fotos = Array.isArray(property.fotos)
    ? property.fotos
        .filter((photo) => typeof photo === "string" && photo.trim())
        .map((photo) => photo.trim())
        .slice(0, 30)
    : [];
  property.imagemPrincipal =
    typeof property.imagemPrincipal === "string" ? property.imagemPrincipal.trim() : "";
  property.status = allowedStatuses.has(property.status) ? property.status : "Disponível";
  property.destaque =
    property.destaque === true || property.destaque === 1 || property.destaque === "true";
  property.vendido = property.status === "Vendido";

  return property;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createToken(email) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    email,
    role: "Admin",
    iss: AUTH_ISSUER,
    aud: AUTH_AUDIENCE,
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + TOKEN_MAX_AGE
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(unsigned)
    .digest("base64url");

  return `${unsigned}.${signature}`;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function getAuthenticatedEmail(req) {
  const token = getBearerToken(req);
  if (!token || !AUTH_SECRET) return null;

  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;

  const expected = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      revokedTokens.has(data.jti) ||
      data.role !== "Admin" ||
      data.email !== ADMIN_EMAIL ||
      data.iss !== AUTH_ISSUER ||
      data.aud !== AUTH_AUDIENCE ||
      data.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return data.email;
  } catch {
    return null;
  }
}

function revokeToken(req) {
  const token = getBearerToken(req);
  if (!token) return;

  try {
    const payload = token.split(".")[1];
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.jti) revokedTokens.add(data.jti);
  } catch {}
}

function sendJson(req, res, status, payload) {
  const origin = req.headers.origin;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };

  if (origin && FRONTEND_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload));
}

async function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function routePath(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
}

function sanitizeExtension(filename, contentType) {
  const original = path.extname(filename || "").toLowerCase();
  const rule = uploadRules.get(contentType);

  if (!rule || !rule.extensions.has(original)) {
    if (contentType === "image/jpeg") return ".jpg";
    if (contentType === "image/png") return ".png";
    if (contentType === "image/webp") return ".webp";
    return "";
  }

  return original;
}

function parseMultipartImages(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers["content-type"] || "");
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) return reject(new Error("multipart/form-data inválido."));

    const busboy = require("busboy")({
      headers: { "content-type": contentType },
      limits: {
        files: 30,
        fileSize: MAX_DIRECT_UPLOAD,
        parts: 40
      }
    });

    const files = [];
    let total = 0;
    let tooLarge = false;

    busboy.on("file", (fieldname, stream, info) => {
      const { filename, mimeType } = info;
      const chunks = [];

      if (!uploadRules.has(mimeType)) {
        stream.resume();
        return;
      }

      stream.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_DIRECT_UPLOAD) {
          tooLarge = true;
          stream.resume();
          return;
        }
        chunks.push(Buffer.from(chunk));
      });

      stream.on("limit", () => {
        tooLarge = true;
      });

      stream.on("end", () => {
        if (tooLarge) return;

        const buffer = Buffer.concat(chunks);
        const rule = uploadRules.get(mimeType);
        const extension = sanitizeExtension(filename, mimeType);

        if (!extension || !rule.signature(buffer)) {
          return;
        }

        files.push({ filename, mimeType, extension, buffer });
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (tooLarge) {
        return reject(
          Object.assign(
            new Error("Upload direto excede 4 MB. Use o upload direto para Blob."),
            { statusCode: 413 }
          )
        );
      }
      resolve(files);
    });

    req.pipe(busboy);
  });
}

async function saveUploadedFile(propertyId, file) {
  const safeId = String(propertyId).replace(/[^0-9A-Za-z_-]/g, "");
  const name = `${crypto.randomUUID()}${file.extension}`;

  if (USE_BLOB) {
    const blob = await put(
      `imoveis/${safeId}/${name}`,
      file.buffer,
      {
        access: "public",
        addRandomSuffix: false,
        contentType: file.mimeType,
        cacheControlMaxAge: 31536000
      }
    );
    return blob.url;
  }

  const directory = path.resolve(UPLOADS_DIR, safeId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), file.buffer);
  return `/media/${encodeURIComponent(safeId)}/${encodeURIComponent(name)}`;
}

async function deletePhotoReference(photo) {
  if (typeof photo !== "string" || !photo) return;

  if (/^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//i.test(photo)) {
    if (USE_BLOB) {
      try { await del(photo); } catch {}
    }
    return;
  }

  if (photo.startsWith("/media/")) {
    const relative = photo
      .slice("/media/".length)
      .split("/")
      .map((part) => decodeURIComponent(part));

    const target = path.resolve(UPLOADS_DIR, ...relative);
    const root = path.resolve(UPLOADS_DIR);

    if (target.startsWith(`${root}${path.sep}`) && fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
}

async function serveLocalMedia(req, res, urlPath) {
  if (USE_BLOB) {
    return sendJson(req, res, 404, {
      mensagem: "Esta imagem usa armazenamento Blob e possui URL própria."
    });
  }

  const relativePath = urlPath
    .slice("/media/".length)
    .split("/")
    .map((part) => decodeURIComponent(part));

  const target = path.resolve(UPLOADS_DIR, ...relativePath);
  const root = path.resolve(UPLOADS_DIR);

  if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target)) {
    return sendJson(req, res, 404, { mensagem: "Imagem não encontrada." });
  }

  const extension = path.extname(target).toLowerCase();
  const contentTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp"
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypes[extension] || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  fs.createReadStream(target).pipe(res);
}

async function handler(req, res) {
  const urlPath = routePath(req);

  if (req.method === "OPTIONS") {
    return sendJson(req, res, 204, {});
  }

  if (urlPath.toLowerCase() === "/api/health" && req.method === "GET") {
    return sendJson(req, res, 200, {
      status: "ok",
      storage: USE_BLOB ? "vercel-blob" : "filesystem"
    });
  }

  if (urlPath.toLowerCase() === "/api/auth/login" && req.method === "POST") {
    try {
      const credentials = await getBody(req);
      const configured = ADMIN_EMAIL && ADMIN_PASSWORD_HASH && AUTH_SECRET;

      const validEmail =
        configured &&
        typeof credentials.email === "string" &&
        credentials.email === ADMIN_EMAIL;

      const validPassword =
        configured &&
        typeof credentials.senha === "string" &&
        await bcrypt.compare(credentials.senha, ADMIN_PASSWORD_HASH);

      if (!validEmail || !validPassword) {
        return sendJson(req, res, 401, { mensagem: "E-mail ou senha inválidos." });
      }

      return sendJson(req, res, 200, {
        autenticado: true,
        token: createToken(ADMIN_EMAIL),
        email: ADMIN_EMAIL
      });
    } catch {
      return sendJson(req, res, 400, { mensagem: "Requisição inválida." });
    }
  }

  if (urlPath.toLowerCase() === "/api/auth/logout" && req.method === "POST") {
    revokeToken(req);
    return sendJson(req, res, 200, { mensagem: "Sessão encerrada." });
  }

  if (urlPath.toLowerCase() === "/api/auth/teste-admin" && req.method === "GET") {
    const email = getAuthenticatedEmail(req);
    return email
      ? sendJson(req, res, 200, { autenticado: true, email })
      : sendJson(req, res, 401, { mensagem: "Não autenticado." });
  }

  const email = getAuthenticatedEmail(req);

  if (urlPath.toLowerCase() === "/api/imoveis/destaques" && req.method === "GET") {
    const properties = await readProperties();
    return sendJson(req, res, 200, properties.filter(p => p.destaque === true).map(withImages));
  }

  if (urlPath.toLowerCase() === "/api/admin/destaques" && req.method === "GET") {
    if (!email) return sendJson(req, res, 401, { mensagem: "Não autenticado." });

    const properties = await readProperties();
    return sendJson(req, res, 200, {
      quantidade: properties.filter(p => p.destaque === true).length,
      destaques: properties.filter(p => p.destaque === true).map(withImages),
      disponiveis: properties.filter(p => p.destaque !== true).map(withImages)
    });
  }

  if (urlPath.toLowerCase() === "/api/imoveis/destaques/trocar" && req.method === "POST") {
    if (!email) return sendJson(req, res, 401, { mensagem: "Não autenticado." });

    try {
      const { antigoId, novoId } = await getBody(req);
      const properties = await readProperties();
      const current = properties.filter(p => p.destaque === true);
      const oldProperty = properties.find(p => String(p.id) === String(antigoId));
      const newProperty = properties.find(p => String(p.id) === String(novoId));

      if (!oldProperty || !newProperty) {
        return sendJson(req, res, 404, { mensagem: "Imóvel antigo ou novo não encontrado." });
      }
      if (current.length !== 6) {
        return sendJson(req, res, 409, {
          mensagem: "A troca exige exatamente 6 destaques configurados."
        });
      }
      if (oldProperty.destaque !== true || newProperty.destaque === true) {
        return sendJson(req, res, 409, {
          mensagem: "Escolha um destaque atual e um imóvel que ainda não esteja em destaque."
        });
      }

      if (String(antigoId) === String(novoId)) {
        return sendJson(req, res, 409, {
          mensagem: "Escolha dois imóveis diferentes para fazer a troca."
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

      const nextHighlights = nextProperties.filter((property) => property.destaque === true);
      if (nextHighlights.length !== 6) {
        return sendJson(req, res, 409, {
          mensagem: "A troca não pode ser concluída sem manter exatamente 6 destaques."
        });
      }

      await writeProperties(nextProperties);

      return sendJson(req, res, 200, {
        mensagem: "Destaque trocado com sucesso.",
        quantidade: nextHighlights.length,
        destaques: nextHighlights.map(withImages)
      });
    } catch {
      return sendJson(req, res, 400, { mensagem: "Requisição inválida." });
    }
  }

  const photoUpload = urlPath.match(/^\/api\/imoveis\/([^/]+)\/fotos$/i);
  if (photoUpload && ["POST", "DELETE"].includes(req.method)) {
    if (!email) return sendJson(req, res, 401, { mensagem: "Não autenticado." });

    const id = decodeURIComponent(photoUpload[1]);
    const properties = await readProperties();
    const property = properties.find(p => String(p.id) === id);

    if (!property) return sendJson(req, res, 404, { mensagem: "Imóvel não encontrado." });

    try {
      if (req.method === "POST") {
        let newPhotos = [];

        if (String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          const body = await getBody(req);
          const incoming = Array.isArray(body.fotos)
            ? body.fotos
            : (typeof body.foto === "string" ? [body.foto] : []);

          if (!incoming.length) {
            return sendJson(req, res, 400, { mensagem: "Nenhuma URL de imagem foi enviada." });
          }

          newPhotos = incoming
            .filter((photo) => typeof photo === "string" && /^https:\/\/.+/i.test(photo))
            .slice(0, 30);
        } else {
          const files = await parseMultipartImages(req);
          if (!files.length) {
            return sendJson(req, res, 400, { mensagem: "Selecione pelo menos uma imagem válida." });
          }

          newPhotos = [];
          for (const file of files) {
            newPhotos.push(await saveUploadedFile(property.id, file));
          }
        }

        const existing = getStoredImages(property);
        property.fotos = [...existing, ...newPhotos].slice(0, 30);

        if (!property.imagemPrincipal) {
          property.imagemPrincipal = newPhotos[0] || "";
        }

        await writeProperties(properties);
        return sendJson(req, res, 201, withImages(property));
      }

      const body = await getBody(req);
      const foto = body.foto;

      if (
        typeof foto !== "string" ||
        !Array.isArray(property.fotos) ||
        !property.fotos.includes(foto)
      ) {
        return sendJson(req, res, 404, { mensagem: "Foto não encontrada." });
      }

      property.fotos = property.fotos.filter(image => image !== foto);

      if (property.imagemPrincipal === foto) {
        property.imagemPrincipal = property.fotos[0] || "";
      }

      await deletePhotoReference(foto);
      await writeProperties(properties);

      return sendJson(req, res, 200, withImages(property));
    } catch (error) {
      return sendJson(req, res, error.statusCode || 400, {
        mensagem: error.message || "Não foi possível processar as imagens."
      });
    }
  }

  const mainImage = urlPath.match(/^\/api\/imoveis\/([^/]+)\/imagem-principal$/i);
  if (mainImage && req.method === "PUT") {
    if (!email) return sendJson(req, res, 401, { mensagem: "Não autenticado." });

    try {
      const { foto } = await getBody(req);
      const properties = await readProperties();
      const property = properties.find(p => String(p.id) === decodeURIComponent(mainImage[1]));

      if (!property) {
        return sendJson(req, res, 404, { mensagem: "Imóvel não encontrado." });
      }
      if (!getStoredImages(property).includes(foto)) {
        return sendJson(req, res, 400, {
          mensagem: "A imagem principal precisa pertencer ao imóvel."
        });
      }

      property.imagemPrincipal = foto;
      await writeProperties(properties);

      return sendJson(req, res, 200, withImages(property));
    } catch {
      return sendJson(req, res, 400, { mensagem: "Requisição inválida." });
    }
  }

  const highlight = urlPath.match(/^\/api\/imoveis\/([^/]+)\/destaque$/i);
  if (highlight && ["POST", "DELETE"].includes(req.method)) {
    if (!email) return sendJson(req, res, 401, { mensagem: "Não autenticado." });

    const properties = await readProperties();
    const property = properties.find(p => String(p.id) === decodeURIComponent(highlight[1]));

    if (!property) return sendJson(req, res, 404, { mensagem: "Imóvel não encontrado." });

    const count = properties.filter(p => p.destaque === true).length;

    if (req.method === "POST") {
      if (property.destaque === true) {
        return sendJson(req, res, 409, { mensagem: "Este imóvel já está em destaque." });
      }
      if (count !== 5) {
        return sendJson(req, res, 409, {
          mensagem: count >= 6
            ? "Já existem 6 imóveis em destaque. Use 'Trocar imóvel'."
            : "A adição só pode completar a vitrine quando houver exatamente 5 destaques."
        });
      }
      property.destaque = true;
    } else {
      if (property.destaque !== true) {
        return sendJson(req, res, 409, { mensagem: "Este imóvel não está em destaque." });
      }
      if (count !== 7) {
        return sendJson(req, res, 409, {
          mensagem: "A remoção só pode corrigir uma vitrine com 7 destaques e deixá-la com exatamente 6. Use 'Trocar imóvel'."
        });
      }
      property.destaque = false;
    }

    await writeProperties(properties);

    return sendJson(req, res, 200, {
      mensagem: req.method === "POST"
        ? "Imóvel adicionado ao destaque."
        : "Imóvel removido do destaque.",
      quantidade: properties.filter(p => p.destaque === true).length
    });
  }

  const propertyMatch = urlPath.match(/^\/api\/imoveis\/([^/]+)$/i);
  if (propertyMatch) {
    const id = decodeURIComponent(propertyMatch[1]);
    const properties = await readProperties();
    const property = properties.find(p => String(p.id) === id);

    if (req.method === "GET") {
      return property
        ? sendJson(req, res, 200, withImages(property))
        : sendJson(req, res, 404, { mensagem: "Imóvel não encontrado." });
    }

    if (!email) return sendJson(req, res, 401, { mensagem: "Não autenticado." });

    if (req.method === "DELETE") {
      if (!property) return sendJson(req, res, 404, { mensagem: "Imóvel não encontrado." });

      if (
        property.destaque === true &&
        properties.filter(p => p.destaque === true).length !== 7
      ) {
        return sendJson(req, res, 409, {
          mensagem: "A exclusão não pode deixar a vitrine diferente de 6 destaques. Use 'Trocar imóvel' primeiro."
        });
      }

      const index = properties.findIndex(p => String(p.id) === id);
      const [removed] = properties.splice(index, 1);

      for (const foto of getStoredImages(removed)) {
        await deletePhotoReference(foto);
      }

      await writeProperties(properties);
      return sendJson(req, res, 200, {
        mensagem: "Imóvel excluído com sucesso.",
        id: removed.id
      });
    }

    if (req.method === "PUT") {
      try {
        if (!property) {
          return sendJson(req, res, 404, { mensagem: "Imóvel não encontrado." });
        }

        const input = await getBody(req);
        const validated = validateProperty(input);
        if (typeof validated === "string") {
          return sendJson(req, res, 400, { mensagem: validated });
        }

        if (
          validated.destaque &&
          property.destaque !== true &&
          properties.filter(p => p.destaque === true).length !== 5
        ) {
          const count = properties.filter(p => p.destaque === true).length;
          return sendJson(req, res, 409, {
            mensagem: count >= 6
              ? "Já existem 6 imóveis em destaque. Use 'Trocar imóvel'."
              : "A adição só pode completar a vitrine quando houver exatamente 5 destaques."
          });
        }
        if (property.destaque === true && validated.destaque !== true) {
          return sendJson(req, res, 409, {
            mensagem: "Não é permitido remover um dos 6 destaques por edição. Use 'Trocar imóvel'."
          });
        }

        const index = properties.findIndex(p => String(p.id) === id);
        const oldPhotos = getStoredImages(property);
        const next = { ...property, ...validated, id: property.id };

        // PUT sem "fotos" preserva as imagens existentes.
        if (!Object.prototype.hasOwnProperty.call(input, "fotos")) {
          next.fotos = oldPhotos;
          next.imagemPrincipal = property.imagemPrincipal || oldPhotos[0] || "";
        }

        properties[index] = next;
        await writeProperties(properties);

        return sendJson(req, res, 200, withImages(next));
      } catch {
        return sendJson(req, res, 400, { mensagem: "Requisição inválida." });
      }
    }
  }

  if (urlPath.toLowerCase() === "/api/imoveis" && req.method === "GET") {
    const properties = await readProperties();
    return sendJson(req, res, 200, properties.map(withImages));
  }

  if (urlPath.toLowerCase() === "/api/imoveis" && req.method === "POST") {
    if (!email) return sendJson(req, res, 401, { mensagem: "Não autenticado." });

    try {
      const input = await getBody(req);
      const property = validateProperty(input);
      if (typeof property === "string") {
        return sendJson(req, res, 400, { mensagem: property });
      }

      const properties = await readProperties();

      if (
        property.destaque &&
        properties.filter(p => p.destaque === true).length !== 5
      ) {
        const count = properties.filter(p => p.destaque === true).length;
        return sendJson(req, res, 409, {
          mensagem: count >= 6
            ? "Já existem 6 imóveis em destaque. Use 'Trocar imóvel'."
            : "A adição só pode completar a vitrine quando houver exatamente 5 destaques."
        });
      }

      const created = {
        ...property,
        id: Math.max(0, ...properties.map(p => Number(p.id) || 0)) + 1
      };

      properties.push(created);
      await writeProperties(properties);

      return sendJson(req, res, 201, withImages(created));
    } catch {
      return sendJson(req, res, 400, { mensagem: "Requisição inválida." });
    }
  }

  // Endpoint local/dev para servir imagens. No modo Blob, as imagens usam URL pública própria.
  if (req.method === "GET" && urlPath.toLowerCase().startsWith("/media/")) {
    return serveLocalMedia(req, res, urlPath);
  }

  return sendJson(req, res, 404, { mensagem: "Endpoint não encontrado." });
}

module.exports = handler;

// =====================================================
// ACRÉSCIMO: bootstrap de servidor HTTP standalone.
//
// O arquivo original só fazia `module.exports = handler`, ou seja, só
// funcionava como função serverless da Vercel — não havia como rodar
// `node backend/index.js` localmente, pois nada nunca chamava `.listen()`.
//
// O guard `require.main === module` garante que isso só roda quando o
// arquivo é executado diretamente (`node index.js` / `npm start`). Se no
// futuro esse mesmo arquivo for importado como função serverless da Vercel,
// este bloco NÃO executa, e o comportamento serverless original é mantido.
// =====================================================
if (require.main === module) {
  const http = require("node:http");
  const PORT = Number(process.env.PORT || 5254);

  http
    .createServer((req, res) => {
      handler(req, res).catch((error) => {
        console.error(error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ mensagem: "Erro interno da API." }));
        }
      });
    })
    .listen(PORT, "0.0.0.0", () => {
      console.log(`Arino Imóveis API: http://localhost:${PORT}`);
    });
}