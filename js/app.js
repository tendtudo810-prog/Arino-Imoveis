"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { hashPassword, verifyPassword, signToken, verifyToken } = require("./auth");
const { transaction } = require("./db");
const media = require("./media");
const props = require("./properties");
const { validateProperty, ALLOWED_STATUS } = require("./validation");
const {
  HttpError,
  applyCors,
  sendJson,
  sendError,
  applySecurityHeaders,
  sanitizeRequestId,
  readBody,
  readJson,
  parseMultipart,
} = require("./http");
const { RateLimiter } = require("./ratelimit");

const FILE_FIELDS = new Set(["foto", "fotos", "images", "images[]"]);
const MAX_FEATURED = 6;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

// Hash usado quando o e-mail não existe, para o tempo de resposta não revelar contas.
const DUMMY_HASH = hashPassword("senha-inexistente-para-tempo-constante");

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "Identificador inválido.");
  }
}

function createApp({ db, config, now = () => Date.now() }) {
  const tokenOptions = {
    secret: config.authSecret,
    issuer: config.authIssuer,
    audience: config.authAudience,
  };
  const loginFailures = new Map(); // ip -> { count, since }
  const publicLimiter = new RateLimiter({ limit: config.rateLimits.publicPerMinute, windowMs: 60000, now });
  const adminLimiter = new RateLimiter({ limit: config.rateLimits.adminPerMinute, windowMs: 60000, now });
  const uploadLimiter = new RateLimiter({ limit: config.rateLimits.uploadPer10Min, windowMs: 10 * 60000, now });

  function clientKey(request) {
    return request.socket.remoteAddress || "unknown";
  }

  function checkLoginAllowed(request) {
    const entry = loginFailures.get(clientKey(request));
    if (!entry) return;
    if (now() - entry.since > LOGIN_WINDOW_MS) {
      loginFailures.delete(clientKey(request));
    } else if (entry.count >= LOGIN_MAX_FAILURES) {
      throw new HttpError(429, "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.");
    }
  }

  function registerLoginFailure(request) {
    const key = clientKey(request);
    const entry = loginFailures.get(key);
    if (!entry || now() - entry.since > LOGIN_WINDOW_MS) {
      loginFailures.set(key, { count: 1, since: now() });
    } else {
      entry.count += 1;
    }
  }

  function currentClaims(request) {
    const header = request.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return null;
    const claims = verifyToken(header.slice(7).trim(), tokenOptions, now());
    if (!claims) return null;
    const revoked = db.prepare("SELECT 1 FROM revoked_tokens WHERE jti = ?").get(claims.jti);
    return revoked ? null : claims;
  }

  function requireAdmin(request) {
    const claims = currentClaims(request);
    if (!claims) throw new HttpError(401, "Não autenticado.");
    return claims;
  }

  function purgeExpiredRevocations() {
    db.prepare("DELETE FROM revoked_tokens WHERE expires_at <= ?").run(Math.floor(now() / 1000));
  }

  function enforceRate(request, limiter) {
    const result = limiter.hit(clientKey(request));
    if (!result.allowed) {
      const error = new HttpError(429, "Muitas requisições. Aguarde um pouco e tente novamente.");
      error.retryAfter = result.retryAfterSeconds;
      throw error;
    }
  }

  function parseId(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, "Identificador inválido.");
    return number;
  }

  function filtersFrom(url) {
    return {
      tipo: url.searchParams.get("tipo") || "",
      cidade: url.searchParams.get("cidade") || "",
      q: url.searchParams.get("q") || "",
    };
  }

  function featuredPayload(publicOnly = true) {
    return props.listFeatured(db, { publicOnly });
  }

  function readiness(response) {
    let databaseOk = false;
    let storageOk = false;
    try {
      db.prepare("SELECT 1 AS ok").get();
      databaseOk = true;
    } catch {
      databaseOk = false;
    }
    try {
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      fs.accessSync(config.uploadsDir, fs.constants.W_OK);
      storageOk = true;
    } catch {
      storageOk = false;
    }
    const ready = databaseOk && storageOk;
    // Sem detalhes internos: só o estado geral.
    return sendJson(response, ready ? 200 : 503, { status: ready ? "ready" : "unavailable" });
  }

  // ---------- autenticação ----------

  async function login(request, response) {
    checkLoginAllowed(request);
    const body = await readJson(request, config.limits.maxJsonBytes);
    const email = String(body.email || body.emailAdmin || "").trim().toLowerCase();
    const senha = String(body.senha || body.password || body.senhaAdmin || "");
    if (!email || !senha) throw new HttpError(400, "Informe e-mail e senha.");

    const admin = db.prepare("SELECT email, password_hash FROM admins WHERE email = ?").get(email);
    const passwordOk = verifyPassword(senha, admin ? admin.password_hash : DUMMY_HASH);
    if (!admin || !passwordOk) {
      registerLoginFailure(request);
      throw new HttpError(401, "E-mail ou senha inválidos.");
    }

    loginFailures.delete(clientKey(request));
    const token = signToken({
      secret: config.authSecret,
      issuer: config.authIssuer,
      audience: config.authAudience,
      email: admin.email,
      ttlSeconds: config.tokenTtlSeconds,
      now: now(),
    });
    return sendJson(response, 200, {
      autenticado: true,
      sucesso: true,
      token,
      email: admin.email,
      usuario: { email: admin.email, role: "Admin" },
    });
  }

  function logout(request, response) {
    const header = request.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
      const claims = verifyToken(header.slice(7).trim(), tokenOptions, now());
      if (claims) {
        db.prepare("INSERT OR REPLACE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)").run(
          claims.jti,
          claims.exp
        );
        purgeExpiredRevocations();
      }
    }
    return sendJson(response, 200, { mensagem: "Sessão encerrada." });
  }

  // ---------- imóveis ----------

  function listImoveis(url, response, publicOnly = true) {
    return sendJson(response, 200, props.listProperties(db, filtersFrom(url), { publicOnly }));
  }

  function getImovel(id, response, publicOnly = true) {
    const property = props.getProperty(db, id, { publicOnly });
    if (!property) throw new HttpError(404, "Imóvel não encontrado.");
    return sendJson(response, 200, property);
  }

  function listImagens(id, response, publicOnly) {
    const property = props.getProperty(db, id, { publicOnly });
    if (!property) throw new HttpError(404, "Imóvel não encontrado.");
    return sendJson(response, 200, property.imagens);
  }

  async function createImovel(request, response) {
    requireAdmin(request);
    const input = await readJson(request, config.limits.maxJsonBytes);
    const { value, error } = validateProperty(input);
    if (error) throw new HttpError(400, error);

    if (value.destaque && value.status === "Rascunho") {
      throw new HttpError(409, "Rascunhos não podem ser destacados. Publique o imóvel antes.");
    }
    const count = props.featuredCount(db);
    if (value.destaque && count !== MAX_FEATURED - 1) {
      throw new HttpError(409, featuredAddMessage(count));
    }
    const id = transaction(db, () => props.insertProperty(db, value));
    return sendJson(response, 201, props.getProperty(db, id));
  }

  async function updateImovel(id, request, response) {
    requireAdmin(request);
    const current = props.getPropertyRow(db, id);
    if (!current) throw new HttpError(404, "Imóvel não encontrado.");

    const input = await readJson(request, config.limits.maxJsonBytes);
    const { value, error } = validateProperty(input);
    if (error) throw new HttpError(400, error);

    const wasFeatured = current.destaque === 1;
    if (value.destaque && value.status === "Rascunho") {
      throw new HttpError(409, "Rascunhos não podem ser destacados. Publique o imóvel antes.");
    }
    if (wasFeatured && value.status === "Rascunho") {
      throw new HttpError(409, "Imóvel em destaque não pode virar rascunho. Troque o destaque antes.");
    }
    if (wasFeatured && !value.destaque) {
      throw new HttpError(409, "Este imóvel faz parte dos 6 destaques. Use 'Trocar imóvel' para substituí-lo.");
    }
    if (value.destaque && !wasFeatured) {
      const count = props.featuredCount(db);
      if (count !== MAX_FEATURED - 1) throw new HttpError(409, featuredAddMessage(count));
    }
    transaction(db, () => props.updatePropertyRow(db, id, value));
    return sendJson(response, 200, props.getProperty(db, id));
  }

  function deleteImovel(id, request, response) {
    requireAdmin(request);
    const current = props.getPropertyRow(db, id);
    if (!current) throw new HttpError(404, "Imóvel não encontrado.");

    if (current.destaque === 1 && props.featuredCount(db) - 1 !== MAX_FEATURED) {
      throw new HttpError(
        409,
        "A exclusão não pode deixar a vitrine diferente de 6 destaques. Use 'Trocar imóvel' primeiro."
      );
    }
    const files = transaction(db, () => props.deleteProperty(db, current.id));
    for (const storageName of files) media.removeImage(config.uploadsDir, current.id, storageName);
    media.removePropertyDirectory(config.uploadsDir, current.id);
    return sendJson(response, 200, { mensagem: "Imóvel excluído com sucesso.", id: current.id });
  }

  // ---------- destaques ----------

  function featuredAddMessage(count) {
    return count >= MAX_FEATURED
      ? "Já existem 6 imóveis em destaque. Use 'Trocar imóvel' para substituir um anúncio."
      : "A adição só pode completar a vitrine quando houver exatamente 5 destaques.";
  }

  function adminDestaques(request, response) {
    requireAdmin(request);
    return sendJson(response, 200, adminDestaquesPayload());
  }

  async function swapFeatured(request, response) {
    requireAdmin(request);
    const { antigoId, novoId } = await readJson(request, config.limits.maxJsonBytes);
    const oldRow = props.getPropertyRow(db, antigoId);
    const newRow = props.getPropertyRow(db, novoId);
    if (!oldRow || !newRow) throw new HttpError(404, "Imóvel antigo ou novo não encontrado.");
    if (props.featuredCount(db) !== MAX_FEATURED) {
      throw new HttpError(409, "A troca exige exatamente 6 destaques configurados.");
    }
    if (oldRow.id === newRow.id) {
      throw new HttpError(409, "Escolha dois imóveis diferentes para fazer a troca.");
    }
    if (oldRow.destaque !== 1 || newRow.destaque === 1) {
      throw new HttpError(409, "Escolha um destaque atual e um imóvel fora do destaque.");
    }
    transaction(db, () => {
      props.setFeatured(db, oldRow.id, false); // libera a vaga antes de ocupá-la
      props.setFeatured(db, newRow.id, true);
      if (props.featuredCount(db) !== MAX_FEATURED) {
        throw new HttpError(409, "A troca não pode ser concluída sem manter exatamente 6 destaques.");
      }
    });
    return sendJson(response, 200, {
      mensagem: "Destaque trocado com sucesso.",
      quantidade: props.featuredCount(db),
      destaques: featuredPayload(),
    });
  }

  function addHighlight(id, response) {
    const row = props.getPropertyRow(db, id);
    if (!row) throw new HttpError(404, "Imóvel não encontrado.");
    if (row.status === "Rascunho") throw new HttpError(409, "Rascunhos não podem ser destacados. Publique o imóvel antes.");
    if (row.destaque === 1) throw new HttpError(409, "Este imóvel já está em destaque.");
    const count = props.featuredCount(db);
    if (count !== MAX_FEATURED - 1) throw new HttpError(409, featuredAddMessage(count));
    transaction(db, () => props.setFeatured(db, row.id, true));
    return sendJson(response, 200, {
      mensagem: "Imóvel adicionado ao destaque.",
      quantidade: props.featuredCount(db),
      imovel: props.getProperty(db, row.id),
    });
  }

  function removeHighlight(id, response) {
    const row = props.getPropertyRow(db, id);
    if (!row) throw new HttpError(404, "Imóvel não encontrado.");
    if (row.destaque !== 1) throw new HttpError(409, "Este imóvel não está em destaque.");
    const count = props.featuredCount(db);
    if (count - 1 !== MAX_FEATURED) {
      throw new HttpError(
        409,
        "A remoção só pode corrigir uma vitrine com 7 destaques e deixá-la com exatamente 6. Use 'Trocar imóvel' para substituir um destaque."
      );
    }
    transaction(db, () => props.setFeatured(db, row.id, false));
    return sendJson(response, 200, {
      mensagem: "Imóvel removido do destaque.",
      quantidade: props.featuredCount(db),
      imovel: props.getProperty(db, row.id),
    });
  }

  // ---------- fotos ----------

  async function uploadPhotos(id, request, response) {
    requireAdmin(request);
    enforceRate(request, uploadLimiter);
    const property = props.getPropertyRow(db, id);
    if (!property) throw new HttpError(404, "Imóvel não encontrado.");

    const contentType = request.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new HttpError(400, "Envie as imagens como multipart/form-data.");
    }
    const raw = await readBody(request, config.limits.maxMultipartBytes);
    const files = parseMultipart(raw, contentType).filter(
      (part) => FILE_FIELDS.has(part.name) && part.filename !== null
    );
    if (!files.length) throw new HttpError(400, "Selecione pelo menos uma imagem.");
    if (files.length > config.limits.maxImagesPerRequest) {
      throw new HttpError(400, `Você pode enviar no máximo ${config.limits.maxImagesPerRequest} imagens por vez.`);
    }
    const existing = props.photoRowsFor(db, property.id).length;
    if (existing + files.length > config.limits.maxPhotosPerProperty) {
      throw new HttpError(409, `Cada imóvel pode ter no máximo ${config.limits.maxPhotosPerProperty} fotos.`);
    }

    const prepared = files.map((file) => {
      if (file.data.length === 0 || file.data.length > config.limits.maxImageBytes) {
        throw new HttpError(400, "Cada imagem deve ter no máximo 8 MB.");
      }
      const rule = media.detectImage(file.data, file.filename, file.contentType);
      if (!rule) {
        throw new HttpError(400, "Arquivo de imagem inválido. Use JPG, JPEG, PNG ou WEBP com até 8 MB.");
      }
      return { file, rule };
    });

    const written = [];
    try {
      for (const { file, rule } of prepared) {
        written.push({
          propertyId: property.id,
          ...media.saveImage(config.uploadsDir, property.id, file.data, rule, file.filename),
        });
      }
      transaction(db, () => {
        let position = existing;
        for (const photo of written) {
          const photoId = props.insertPhoto(db, property.id, photo, position);
          position += 1;
          if (!props.getPropertyRow(db, property.id).imagem_principal_id) {
            props.setMainPhoto(db, property.id, photoId);
          }
        }
      });
    } catch (error) {
      for (const photo of written) media.removeImage(config.uploadsDir, property.id, photo.storageName);
      throw error;
    }
    return sendJson(response, 201, props.getProperty(db, property.id));
  }

  async function deletePhoto(id, request, response) {
    requireAdmin(request);
    const property = props.getPropertyRow(db, id);
    if (!property) throw new HttpError(404, "Imóvel não encontrado.");
    const body = await readJson(request, config.limits.maxJsonBytes);
    const photo = props.findPhotoByUrl(db, property.id, body.foto || body.url);
    if (!photo) throw new HttpError(404, "Foto não encontrada.");

    transaction(db, () => props.deletePhoto(db, property.id, photo.id));
    media.removeImage(config.uploadsDir, property.id, photo.storage_name);
    return sendJson(response, 200, props.getProperty(db, property.id));
  }

  async function setMainPhoto(id, request, response) {
    requireAdmin(request);
    const property = props.getPropertyRow(db, id);
    if (!property) throw new HttpError(404, "Imóvel não encontrado.");
    const body = await readJson(request, config.limits.maxJsonBytes);
    const photo = props.findPhotoByUrl(db, property.id, body.foto || body.url);
    if (!photo) throw new HttpError(400, "A imagem principal precisa pertencer ao imóvel.");
    transaction(db, () => props.setMainPhoto(db, property.id, photo.id));
    return sendJson(response, 200, props.getProperty(db, property.id));
  }

  // ---------- mídia ----------

  function serveMedia(pathname, response) {
    const match = pathname.match(/^\/media\/(\d+)\/([A-Za-z0-9-]+\.(?:jpg|jpeg|png|webp))$/i);
    if (!match) throw new HttpError(404, "Arquivo não encontrado.");
    const propertyId = Number(match[1]);
    const storageName = match[2];
    const row = db
      .prepare("SELECT 1 FROM property_photos WHERE property_id = ? AND storage_name = ?")
      .get(propertyId, storageName);
    const file = row ? media.imageFilePath(config.uploadsDir, propertyId, storageName) : null;
    if (!file) throw new HttpError(404, "Arquivo não encontrado.");

    response.writeHead(200, {
      "Content-Type": media.mimeFromStorageName(storageName),
      "Content-Length": fs.statSync(file).size,
      "Cache-Control": "public, max-age=86400",
    });
    fs.createReadStream(file).pipe(response);
  }

  // ---------- administração: status e imagens por id ----------

  async function setStatus(id, request, response) {
    requireAdmin(request);
    const row = props.getPropertyRow(db, id);
    if (!row) throw new HttpError(404, "Imóvel não encontrado.");
    const body = await readJson(request, config.limits.maxJsonBytes);
    if (!ALLOWED_STATUS.has(body.status)) {
      throw new HttpError(400, `Status inválido. Use: ${[...ALLOWED_STATUS].join(", ")}.`);
    }
    if (body.status === "Rascunho" && row.destaque === 1) {
      throw new HttpError(409, "Imóvel em destaque não pode virar rascunho. Troque o destaque antes.");
    }
    transaction(db, () => props.setStatus(db, row.id, body.status));
    return sendJson(response, 200, props.getProperty(db, row.id));
  }

  function photoOfProperty(propertyId, imagemId) {
    const photo = db
      .prepare("SELECT id, storage_name FROM property_photos WHERE id = ? AND property_id = ?")
      .get(imagemId, Number(propertyId));
    if (!photo) throw new HttpError(404, "Imagem não encontrada.");
    return photo;
  }

  function deletePhotoById(id, imagemId, request, response) {
    requireAdmin(request);
    const property = props.getPropertyRow(db, id);
    if (!property) throw new HttpError(404, "Imóvel não encontrado.");
    const photo = photoOfProperty(property.id, parseId(imagemId));
    transaction(db, () => props.deletePhoto(db, property.id, photo.id));
    media.removeImage(config.uploadsDir, property.id, photo.storage_name);
    return sendJson(response, 200, props.getProperty(db, property.id));
  }

  function setMainPhotoById(id, imagemId, request, response) {
    requireAdmin(request);
    const property = props.getPropertyRow(db, id);
    if (!property) throw new HttpError(404, "Imóvel não encontrado.");
    const photo = photoOfProperty(property.id, parseId(imagemId));
    transaction(db, () => props.setMainPhoto(db, property.id, photo.id));
    return sendJson(response, 200, props.getProperty(db, property.id));
  }

  /** Rotas de /api/admin/imoveis (contrato novo). Reaproveita as funções existentes. */
  async function routeAdminImoveis(request, response, url, rawParts, method) {
    const rest = rawParts.slice(2).map(decodeSegment);
    const word = (index) => (rest[index] || "").toLowerCase();

    if (rest.length === 0) {
      if (method === "GET") {
        requireAdmin(request);
        return sendJson(response, 200, props.listProperties(db, filtersFrom(url), { publicOnly: false }));
      }
      if (method === "POST") return createImovel(request, response);
      throw new HttpError(404, "Rota não encontrada.");
    }

    if (word(0) === "destaques") {
      if (rest.length === 1 && method === "GET") {
        requireAdmin(request);
        return sendJson(response, 200, adminDestaquesPayload());
      }
      if (rest.length === 1 && method === "POST") {
        requireAdmin(request);
        const body = await readJson(request, config.limits.maxJsonBytes);
        return addHighlight(parseId(body.imovelId), response);
      }
      if (rest.length === 2 && word(1) === "trocar" && (method === "PUT" || method === "POST")) {
        return swapFeatured(request, response);
      }
      if (rest.length === 2 && method === "DELETE") {
        requireAdmin(request);
        return removeHighlight(parseId(rest[1]), response);
      }
      throw new HttpError(404, "Rota não encontrada.");
    }

    const id = rest[0];
    if (rest.length === 1) {
      if (method === "GET") {
        requireAdmin(request);
        return getImovel(id, response, false);
      }
      if (method === "PUT") return updateImovel(id, request, response);
      if (method === "DELETE") return deleteImovel(id, request, response);
    }
    if (rest.length === 2 && word(1) === "status" && method === "PATCH") {
      return setStatus(id, request, response);
    }
    if (word(1) === "imagens") {
      if (rest.length === 2 && method === "POST") return uploadPhotos(id, request, response);
      if (rest.length === 2 && method === "GET") {
        requireAdmin(request);
        return listImagens(id, response, false);
      }
      if (rest.length === 3 && method === "DELETE") return deletePhotoById(id, rest[2], request, response);
      if (rest.length === 4 && word(3) === "principal" && method === "PATCH") {
        return setMainPhotoById(id, rest[2], request, response);
      }
    }
    throw new HttpError(404, "Rota não encontrada.");
  }

  function adminDestaquesPayload() {
    const destaques = featuredPayload(false);
    return {
      quantidade: destaques.length,
      destaques,
      disponiveis: props.listNotFeatured(db),
    };
  }

  // ---------- roteamento ----------

  async function routeApi(request, response, url) {
    const method = request.method;
    const parts = url.pathname.replace(/\/+$/, "").split("/").slice(2).map((p) => p.toLowerCase());
    // parts: ["health"] | ["auth", "login"] | ["imoveis", ":id", "fotos"] ...
    const rawParts = url.pathname.replace(/\/+$/, "").split("/").slice(2);
    const [head, second, third] = parts;
    const idRaw = rawParts[1];

    if (method === "GET" && head === "health" && second === "ready") {
      return readiness(response);
    }
    if (method === "GET" && head === "health") {
      return sendJson(response, 200, {
        status: "ok",
        api: "arino-imoveis",
        time: new Date().toISOString(),
      });
    }

    if (head === "auth" && second === "me" && method === "GET") {
      const claims = requireAdmin(request);
      return sendJson(response, 200, { email: claims.email, role: "Admin" });
    }

    if (head === "admin" && second === "imoveis") {
      return routeAdminImoveis(request, response, url, rawParts, method);
    }

    if (head === "auth") {
      if (method === "POST" && second === "login") return login(request, response);
      if (method === "POST" && second === "logout") return logout(request, response);
      if (method === "GET" && second === "teste-admin") {
        const claims = requireAdmin(request);
        return sendJson(response, 200, { autenticado: true, email: claims.email });
      }
      throw new HttpError(404, "Rota não encontrada.");
    }

    if (head === "admin" && second === "destaques" && method === "GET") {
      return adminDestaques(request, response);
    }

    if (head === "imovel" && idRaw && method === "GET") {
      return getImovel(decodeSegment(idRaw), response, true);
    }

    if (head !== "imoveis") throw new HttpError(404, "Rota não encontrada.");

    if (!second) {
      if (method === "GET") return listImoveis(url, response, true);
      if (method === "POST") return createImovel(request, response);
    }
    if (second === "destaques" && !third) {
      if (method === "GET") return sendJson(response, 200, featuredPayload(true));
    }
    if (second === "destaques" && third === "trocar" && method === "POST") {
      return swapFeatured(request, response);
    }

    const id = decodeSegment(idRaw || "");
    if (third === "imagens" && method === "GET") return listImagens(id, response, true);
    if (second && third === undefined) {
      if (method === "GET") return getImovel(id, response, true);
      if (method === "PUT") return updateImovel(id, request, response);
      if (method === "DELETE") return deleteImovel(id, request, response);
    }
    if (third === "fotos") {
      if (method === "POST") return uploadPhotos(id, request, response);
      if (method === "DELETE") return deletePhoto(id, request, response);
    }
    if (third === "imagem-principal" || third === "foto-principal") {
      if (method === "PUT") return setMainPhoto(id, request, response);
    }
    if (third === "destaque") {
      requireAdmin(request);
      if (method === "POST") return addHighlight(id, response);
      if (method === "DELETE") return removeHighlight(id, response);
      if (method === "PUT") {
        const body = await readJson(request, config.limits.maxJsonBytes);
        if (body.destaque === false || body.highlight === false) return removeHighlight(id, response);
        return addHighlight(id, response);
      }
    }
    throw new HttpError(404, "Rota não encontrada.");
  }

  return async function handle(request, response) {
    const traceId = sanitizeRequestId(request.headers["x-request-id"]) || crypto.randomUUID();
    applySecurityHeaders(response, traceId);
    try {
      applyCors(request, response, config.frontendOrigins);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        return response.end();
      }
      const url = new URL(request.url, "http://localhost");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const lower = pathname.toLowerCase();

      if (request.method === "GET" && lower.startsWith("/media/")) {
        enforceRate(request, publicLimiter);
        return serveMedia(pathname, response);
      }
      if (lower === "/api" || lower.startsWith("/api/")) {
        const isHealth = lower.startsWith("/api/health");
        if (!isHealth) {
          enforceRate(request, request.method === "GET" ? publicLimiter : adminLimiter);
        }
        return await routeApi(request, response, url);
      }
      throw new HttpError(404, "Rota não encontrada.");
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 429) response.setHeader("Retry-After", String(error.retryAfter || 60));
        return sendError(response, error.status, error.message, traceId);
      }
      // Log estruturado sem dados pessoais, senhas, tokens ou corpo da requisição.
      console.error(JSON.stringify({ level: "error", traceId, message: error && error.message }));
      return sendError(response, 500, "Erro interno do servidor.", traceId);
    }
  };
}

module.exports = { createApp };