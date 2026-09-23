const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Busboy = require("busboy");

const PORT = Number(process.env.PORT || 5254);

const DATA_FILE = path.resolve(
  process.env.DATA_FILE || path.join(__dirname, "data", "imoveis.json")
);

const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR || path.join(__dirname, "uploads")
);

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "")
  .trim()
  .toLowerCase();

const ADMIN_PASSWORD_HASH = String(
  process.env.ADMIN_PASSWORD_HASH || ""
);

const AUTH_SECRET = String(process.env.AUTH_SECRET || "");

const FRONTEND_ORIGINS = String(
  process.env.FRONTEND_ORIGINS ||
  "http://127.0.0.1:5500,http://localhost:5500,http://localhost:3000"
)
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

const MAX_UPLOADS = 10;
const MAX_FILE_SIZE = 8 * 1024 * 1024;


// =====================================================
// ARMAZENAMENTO
// =====================================================

function ensureStorage() {
  fs.mkdirSync(path.dirname(DATA_FILE), {
    recursive: true
  });

  fs.mkdirSync(UPLOADS_DIR, {
    recursive: true
  });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]", "utf8");
  }
}


function readProperties() {
  ensureStorage();

  const data = JSON.parse(
    fs.readFileSync(DATA_FILE, "utf8") || "[]"
  );

  return Array.isArray(data) ? data : [];
}


function writeProperties(data) {
  ensureStorage();

  const tempFile = DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(tempFile, DATA_FILE);
}


// =====================================================
// RESPOSTAS
// =====================================================

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(payload));
}


// =====================================================
// CORS
// =====================================================

function cors(req, res) {
  const origin = req.headers.origin || "";

  if (FRONTEND_ORIGINS.includes(origin)) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      origin
    );

    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Credentials",
    "true"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
}


// =====================================================
// JWT
// =====================================================

function base64url(value) {
  return Buffer
    .from(value)
    .toString("base64url");
}


function createToken(email) {
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(
    JSON.stringify({
      alg: "HS256",
      typ: "JWT"
    })
  );

  const payload = base64url(
    JSON.stringify({
      sub: email,
      email,
      role: "admin",
      iat: now,
      exp: now + TOKEN_TTL_SECONDS
    })
  );

  const unsigned = `${header}.${payload}`;

  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(unsigned)
    .digest("base64url");

  return `${unsigned}.${signature}`;
}


function verifyToken(token) {
  if (!token || !AUTH_SECRET) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const unsigned = `${parts[0]}.${parts[1]}`;

  const expected = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(unsigned)
    .digest("base64url");

  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(
      Buffer
        .from(parts[1], "base64url")
        .toString("utf8")
    );

    if (
      !data.exp ||
      data.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    if (
      data.role !== "admin" ||
      data.email !== ADMIN_EMAIL
    ) {
      return null;
    }

    return data;

  } catch {
    return null;
  }
}


function auth(req, res) {
  const value =
    req.headers.authorization || "";

  const token =
    value.startsWith("Bearer ")
      ? value.slice(7).trim()
      : "";

  if (!verifyToken(token)) {
    sendJson(res, 401, {
      erro: "Não autorizado. Faça login novamente."
    });

    return false;
  }

  return true;
}


// =====================================================
// JSON BODY
// =====================================================

function bodyJson(req) {
  return new Promise((resolve, reject) => {

    let body = "";

    req.setEncoding("utf8");

    req.on("data", chunk => {

      body += chunk;

      if (body.length > 2 * 1024 * 1024) {
        reject(
          new Error("Requisição muito grande.")
        );
      }

    });

    req.on("end", () => {

      try {

        resolve(
          body
            ? JSON.parse(body)
            : {}
        );

      } catch {

        reject(
          new Error("JSON inválido.")
        );

      }

    });

    req.on("error", reject);
  });
}


// =====================================================
// UTILIDADES DE IMÓVEIS
// =====================================================

function slugify(value) {

  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function normalizeProperty(input, old = {}) {

  const data = {
    ...old,
    ...input
  };

  const titulo = String(
    data.titulo ??
    data.title ??
    data.nome ??
    ""
  ).trim();

  const descricao = String(
    data.descricao ??
    data.description ??
    ""
  ).trim();

  const cidade = String(
    data.cidade ??
    data.city ??
    ""
  ).trim();

  const tipo = String(
    data.tipo ??
    data.type ??
    ""
  ).trim();

  const rawPrice =
    data.preco ??
    data.price ??
    0;

  const preco =
    typeof rawPrice === "number"
      ? rawPrice
      : Number(
          String(rawPrice)
            .replace(/[^\d,.-]/g, "")
            .replace(",", ".")
        ) || 0;

  return {
    ...data,

    id: old.id ?? data.id,

    titulo,

    descricao,

    cidade,

    tipo,

    preco,

    fotos:
      Array.isArray(data.fotos)
        ? data.fotos.filter(Boolean)
        : (old.fotos || []),

    destaque:
      Boolean(data.destaque),

    slug:
      String(
        data.slug ||
        slugify(titulo)
      )
  };
}


function nextId(items) {

  return items.reduce(
    (max, item) =>
      Math.max(
        max,
        Number(item.id) || 0
      ),
    0
  ) + 1;
}


function findProperty(items, id) {

  return items.find(
    item =>
      String(item.id) === String(id)
  );
}


// =====================================================
// UPLOADS
// =====================================================

function safe(value) {

  return String(value)
    .replace(/[^a-zA-Z0-9_-]/g, "");
}


function extensionForMime(mime) {

  const extensions = {

    "image/jpeg": ".jpg",

    "image/png": ".png",

    "image/webp": ".webp",

    "image/gif": ".gif",

    "image/avif": ".avif"

  };

  return extensions[mime] || "";
}


function uploadFiles(req, propertyId) {

  return new Promise((resolve, reject) => {

    const busboy = Busboy({

      headers: req.headers,

      limits: {

        files: MAX_UPLOADS,

        fileSize: MAX_FILE_SIZE

      }

    });

    const result = [];

    let tooLarge = false;

    busboy.on(
      "file",
      (field, file, info) => {

        if (
          ![
            "foto",
            "fotos",
            "images"
          ].includes(field)
        ) {

          file.resume();

          return;
        }

        const extension =
          extensionForMime(
            info.mimeType
          );

        if (!extension) {

          file.resume();

          return;
        }

        const directory =
          path.join(
            UPLOADS_DIR,
            safe(propertyId)
          );

        fs.mkdirSync(
          directory,
          {
            recursive: true
          }
        );

        const filename =
          crypto.randomUUID() +
          extension;

        const absolute =
          path.join(
            directory,
            filename
          );

        const output =
          fs.createWriteStream(
            absolute
          );

        file.on(
          "limit",
          () => {
            tooLarge = true;
          }
        );

        file.pipe(output);

        output.on(
          "finish",
          () => {

            if (!tooLarge) {

              result.push(
                `/media/${safe(propertyId)}/${filename}`
              );

            } else {

              try {
                fs.unlinkSync(absolute);
              } catch {}

            }

          }
        );

        output.on(
          "error",
          reject
        );

      }
    );

    busboy.on(
      "finish",
      () => {

        if (tooLarge) {

          reject(
            new Error(
              "Uma imagem ultrapassou 8 MB."
            )
          );

          return;
        }

        resolve(result);
      }
    );

    busboy.on(
      "error",
      reject
    );

    req.pipe(busboy);
  });
}


// =====================================================
// FOTOS
// =====================================================

function serveMedia(req, res, pathname) {

  const relative =
    decodeURIComponent(
      pathname.slice(
        "/media/".length
      )
    );

  const absolute =
    path.resolve(
      UPLOADS_DIR,
      relative
    );

  if (
    !absolute.startsWith(
      path.resolve(UPLOADS_DIR)
    )
  ) {

    return sendJson(
      res,
      403,
      {
        erro: "Acesso negado."
      }
    );

  }

  const mimeTypes = {

    ".jpg": "image/jpeg",

    ".jpeg": "image/jpeg",

    ".png": "image/png",

    ".webp": "image/webp",

    ".gif": "image/gif",

    ".avif": "image/avif"

  };

  const mime =
    mimeTypes[
      path
        .extname(absolute)
        .toLowerCase()
    ] ||
    "application/octet-stream";

  try {

    res.writeHead(
      200,
      {
        "Content-Type": mime,

        "Cache-Control":
          "public, max-age=3600"
      }
    );

    res.end(
      fs.readFileSync(
        absolute
      )
    );

  } catch {

    sendJson(
      res,
      404,
      {
        erro:
          "Imagem não encontrada."
      }
    );

  }
}


// =====================================================
// ROTAS
// =====================================================

async function handle(req, res) {

  cors(req, res);

  if (req.method === "OPTIONS") {

    res.writeHead(204);

    return res.end();

  }

  const url =
    new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

  const pathname =
    url.pathname;


  // HEALTH

  if (
    req.method === "GET" &&
    pathname === "/api/health"
  ) {

    return sendJson(
      res,
      200,
      {
        status: "ok",

        api:
          "arino-imoveis",

        time:
          new Date().toISOString()
      }
    );

  }


  // FOTOS

  if (
    pathname.startsWith("/media/")
  ) {

    return serveMedia(
      req,
      res,
      pathname
    );

  }


  // LOGIN

  if (
    req.method === "POST" &&
    pathname === "/api/auth/login"
  ) {

    try {

      const data =
        await bodyJson(req);

      const email =
        String(
          data.email ||
          data.emailAdmin ||
          ""
        )
        .trim()
        .toLowerCase();

      const senha =
        String(
          data.senha ||
          data.password ||
          data.senhaAdmin ||
          ""
        );

      if (!email || !senha) {

        return sendJson(
          res,
          400,
          {
            erro:
              "Informe e-mail e senha."
          }
        );

      }

      if (
        !ADMIN_EMAIL ||
        !ADMIN_PASSWORD_HASH ||
        !AUTH_SECRET
      ) {

        return sendJson(
          res,
          500,
          {
            erro:
              "Login da API não configurado."
          }
        );

      }

      const valid =
        email === ADMIN_EMAIL &&
        await bcrypt.compare(
          senha,
          ADMIN_PASSWORD_HASH
        );

      if (!valid) {

        return sendJson(
          res,
          401,
          {
            erro:
              "E-mail ou senha inválidos."
          }
        );

      }

      return sendJson(
        res,
        200,
        {

          sucesso: true,

          token:
            createToken(email),

          usuario: {

            email,

            role:
              "admin"

          }

        }
      );

    } catch (error) {

      return sendJson(
        res,
        400,
        {
          erro:
            error.message
        }
      );

    }

  }


  // TODOS OS IMÓVEIS

  if (
    req.method === "GET" &&
    pathname === "/api/Imoveis"
  ) {

    return sendJson(
      res,
      200,
      readProperties()
    );

  }


  // DESTAQUES

  if (
    req.method === "GET" &&
    pathname ===
      "/api/Imoveis/destaques"
  ) {

    return sendJson(
      res,
      200,
      readProperties()
        .filter(
          item =>
            item.destaque === true
        )
    );

  }


  const propertyMatch =
    pathname.match(
      /^\/api\/Imoveis\/([^/]+)$/
    );

  const photoMatch =
    pathname.match(
      /^\/api\/Imoveis\/([^/]+)\/fotos$/
    );

  const mainPhotoMatch =
    pathname.match(
      /^\/api\/Imoveis\/([^/]+)\/foto-principal$/
    );

  const highlightMatch =
    pathname.match(
      /^\/api\/Imoveis\/([^/]+)\/destaque$/
    );


  // IMÓVEL INDIVIDUAL

  if (
    req.method === "GET" &&
    propertyMatch
  ) {

    const property =
      findProperty(
        readProperties(),
        propertyMatch[1]
      );

    if (!property) {

      return sendJson(
        res,
        404,
        {
          erro:
            "Imóvel não encontrado."
        }
      );

    }

    return sendJson(
      res,
      200,
      property
    );

  }


  // PROTEÇÃO

  if (
    (
      propertyMatch ||
      photoMatch ||
      mainPhotoMatch ||
      highlightMatch
    ) &&
    [
      "POST",
      "PUT",
      "PATCH",
      "DELETE"
    ].includes(req.method)
  ) {

    if (!auth(req, res)) {
      return;
    }

  }


  // CRIAR IMÓVEL

  if (
    req.method === "POST" &&
    pathname === "/api/Imoveis"
  ) {

    try {

      const properties =
        readProperties();

      const body =
        await bodyJson(req);

      const property =
        normalizeProperty(
          {
            ...body,

            id:
              nextId(properties)
          }
        );

      if (!property.titulo) {

        return sendJson(
          res,
          400,
          {
            erro:
              "Informe o título do imóvel."
          }
        );

      }

      if (
        property.destaque &&
        properties.filter(
          item =>
            item.destaque
        ).length >= 6
      ) {

        return sendJson(
          res,
          400,
          {
            erro:
              "Já existem 6 imóveis em destaque."
          }
        );

      }

      properties.push(
        property
      );

      writeProperties(
        properties
      );

      return sendJson(
        res,
        201,
        property
      );

    } catch (error) {

      return sendJson(
        res,
        400,
        {
          erro:
            error.message
        }
      );

    }

  }


  // EDITAR IMÓVEL

  if (
    req.method === "PUT" &&
    propertyMatch
  ) {

    try {

      const properties =
        readProperties();

      const index =
        properties.findIndex(
          item =>
            String(item.id) ===
            String(propertyMatch[1])
        );

      if (index < 0) {

        return sendJson(
          res,
          404,
          {
            erro:
              "Imóvel não encontrado."
          }
        );

      }

      const body =
        await bodyJson(req);

      const property =
        normalizeProperty(
          body,
          properties[index]
        );

      if (
        property.destaque &&
        !properties[index].destaque &&
        properties.filter(
          item =>
            item.destaque
        ).length >= 6
      ) {

        return sendJson(
          res,
          400,
          {
            erro:
              "Já existem 6 imóveis em destaque."
          }
        );

      }

      properties[index] =
        property;

      writeProperties(
        properties
      );

      return sendJson(
        res,
        200,
        property
      );

    } catch (error) {

      return sendJson(
        res,
        400,
        {
          erro:
            error.message
        }
      );

    }

  }


  // EXCLUIR IMÓVEL

  if (
    req.method === "DELETE" &&
    propertyMatch
  ) {

    const properties =
      readProperties();

    const index =
      properties.findIndex(
        item =>
          String(item.id) ===
          String(propertyMatch[1])
      );

    if (index < 0) {

      return sendJson(
        res,
        404,
        {
          erro:
            "Imóvel não encontrado."
        }
      );

    }

    properties.splice(
      index,
      1
    );

    writeProperties(
      properties
    );

    return sendJson(
      res,
      200,
      {
        sucesso: true
      }
    );

  }


  // UPLOAD DE FOTOS

  if (
    req.method === "POST" &&
    photoMatch
  ) {

    try {

      const properties =
        readProperties();

      const property =
        findProperty(
          properties,
          photoMatch[1]
        );

      if (!property) {

        return sendJson(
          res,
          404,
          {
            erro:
              "Imóvel não encontrado."
          }
        );

      }

      const urls =
        await uploadFiles(
          req,
          property.id
        );

      if (!urls.length) {

        return sendJson(
          res,
          400,
          {
            erro:
              "Nenhuma imagem válida foi enviada."
          }
        );

      }

      property.fotos =
        Array.isArray(
          property.fotos
        )
          ? property.fotos
          : [];

      property.fotos.push(
        ...urls
      );

      writeProperties(
        properties
      );

      return sendJson(
        res,
        201,
        {
          sucesso: true,

          fotos:
            urls,

          imovel:
            property
        }
      );

    } catch (error) {

      return sendJson(
        res,
        400,
        {
          erro:
            error.message
        }
      );

    }

  }


  // FOTO PRINCIPAL

  if (
    req.method === "PUT" &&
    mainPhotoMatch
  ) {

    try {

      const properties =
        readProperties();

      const property =
        findProperty(
          properties,
          mainPhotoMatch[1]
        );

      if (!property) {

        return sendJson(
          res,
          404,
          {
            erro:
              "Imóvel não encontrado."
          }
        );

      }

      const body =
        await bodyJson(req);

      const photo =
        String(
          body.url ||
          body.foto ||
          ""
        );

      if (
        !photo ||
        !(
          property.fotos || []
        ).includes(photo)
      ) {

        return sendJson(
          res,
          400,
          {
            erro:
              "A foto não pertence ao imóvel."
          }
        );

      }

      property.fotos = [

        photo,

        ...(
          property.fotos || []
        ).filter(
          item =>
            item !== photo
        )

      ];

      property.fotoPrincipal =
        photo;

      writeProperties(
        properties
      );

      return sendJson(
        res,
        200,
        {
          sucesso: true,

          imovel:
            property
        }
      );

    } catch (error) {

      return sendJson(
        res,
        400,
        {
          erro:
            error.message
        }
      );

    }

  }


  // DESTAQUE

  if (
    req.method === "PUT" &&
    highlightMatch
  ) {

    try {

      const properties =
        readProperties();

      const property =
        findProperty(
          properties,
          highlightMatch[1]
        );

      if (!property) {

        return sendJson(
          res,
          404,
          {
            erro:
              "Imóvel não encontrado."
          }
        );

      }

      const body =
        await bodyJson(req);

      const enabled =
        Boolean(
          body.destaque ??
          body.highlight ??
          true
        );

      if (
        enabled &&
        !property.destaque &&
        properties.filter(
          item =>
            item.destaque
        ).length >= 6
      ) {

        return sendJson(
          res,
          400,
          {
            erro:
              "Já existem 6 imóveis em destaque."
          }
        );

      }

      property.destaque =
        enabled;

      writeProperties(
        properties
      );

      return sendJson(
        res,
        200,
        {
          sucesso: true,

          imovel:
            property
        }
      );

    } catch (error) {

      return sendJson(
        res,
        400,
        {
          erro:
            error.message
        }
      );

    }

  }


  return sendJson(
    res,
    404,
    {
      erro:
        "Rota não encontrada."
    }
  );

}


// =====================================================
// INICIAR SERVIDOR
// =====================================================

ensureStorage();

http
  .createServer(
    (req, res) => {

      handle(
        req,
        res
      ).catch(
        error => {

          console.error(
            error
          );

          if (!res.headersSent) {

            sendJson(
              res,
              500,
              {
                erro:
                  "Erro interno da API."
              }
            );

          }

        }
      );

    }
  )
  .listen(
    PORT,
    "0.0.0.0",
    () => {

      console.log(
        `Arino Imóveis API: http://localhost:${PORT}`
      );

    }
  );