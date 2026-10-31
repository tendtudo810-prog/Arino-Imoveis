"use strict";

const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function applyCors(request, response, allowedOrigins) {
  const origin = request.headers.origin || "";
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
  response.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Vary", "Origin");
}

function sendJson(response, status, payload) {
  if (response.headersSent) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readBody(request, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, "Requisição muito grande."));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks, size)));
    request.on("error", reject);
  });
}

async function readJson(request, limitBytes) {
  const raw = (await readBody(request, limitBytes)).toString("utf8");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    return parsed;
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

/**
 * Extrai as partes de um corpo multipart/form-data.
 * Retorna [{ name, filename, contentType, data }]. Sem dependências externas.
 */
function parseMultipart(buffer, contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new HttpError(400, "Envie as imagens como multipart/form-data.");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const headerEnd = Buffer.from("\r\n\r\n");

  const parts = [];
  let cursor = buffer.indexOf(boundary);
  while (cursor !== -1) {
    const start = cursor + boundary.length;
    if (buffer.slice(start, start + 2).toString() === "--") break; // fim do corpo
    const next = buffer.indexOf(boundary, start);
    if (next === -1) break;

    // Cada parte começa após o CRLF que segue a linha do boundary.
    const partStart = start + 2;
    const partEnd = next - 2; // remove o CRLF antes do próximo boundary
    const separator = buffer.indexOf(headerEnd, partStart);
    if (separator !== -1 && separator < partEnd) {
      const headerText = buffer.slice(partStart, separator).toString("utf8");
      const body = buffer.slice(separator + 4, partEnd);
      const disposition = headerText.match(/content-disposition:[^\r\n]*/i);
      const name = disposition && disposition[0].match(/name="([^"]*)"/i);
      const filename = disposition && disposition[0].match(/filename="([^"]*)"/i);
      const type = headerText.match(/content-type:\s*([^\r\n;]+)/i);
      if (name) {
        parts.push({
          name: name[1],
          filename: filename ? filename[1] : null,
          contentType: type ? type[1].trim().toLowerCase() : "",
          data: body,
        });
      }
    }
    cursor = next;
  }
  return parts;
}

const STATUS_CODES = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "UNAVAILABLE",
};

/**
 * Envelope padronizado de erro. `mensagem` é mantido para compatibilidade
 * com o painel atual; `error` é o contrato novo (código, detalhes e traceId).
 */
function sendError(response, status, message, traceId, details = null) {
  sendJson(response, status, {
    mensagem: message,
    error: {
      code: STATUS_CODES[status] || "ERROR",
      message,
      details,
      traceId,
    },
  });
}

/** Cabeçalhos de segurança aplicados a todas as respostas. */
function applySecurityHeaders(response, traceId) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("X-Request-Id", traceId);
}

/** Aceita um X-Request-Id do cliente apenas se for seguro (evita injeção em logs). */
function sanitizeRequestId(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && /^[A-Za-z0-9._-]{8,64}$/.test(text) ? text : null;
}

module.exports = {
  HttpError,
  applyCors,
  sendJson,
  sendError,
  applySecurityHeaders,
  sanitizeRequestId,
  readBody,
  readJson,
  parseMultipart,
};