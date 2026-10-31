"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BACKEND_ROOT = path.resolve(__dirname, "..");

/**
 * Lê backend/.env (se existir) sem sobrescrever variáveis já definidas
 * no ambiente. Não há dependências externas para isso.
 */
function loadEnvFile(filePath = path.join(BACKEND_ROOT, ".env")) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function resolveFromBackend(value, fallback) {
  const target = value || fallback;
  return path.isAbsolute(target) ? target : path.resolve(BACKEND_ROOT, target);
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Monta a configuração a partir de um objeto de ambiente.
 * Em produção, AUTH_SECRET é obrigatório e precisa ter pelo menos 32 caracteres.
 */
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const authSecret = String(env.AUTH_SECRET || "");

  if (!authSecret) {
    throw new Error("AUTH_SECRET é obrigatório. Defina uma chave longa e aleatória em backend/.env.");
  }
  if (nodeEnv === "production" && authSecret.length < 32) {
    throw new Error("AUTH_SECRET precisa ter pelo menos 32 caracteres em produção.");
  }

  return {
    nodeEnv,
    port: Number(env.PORT || 5254),
    dbFile: resolveFromBackend(env.DB_FILE, "data/arino.sqlite"),
    uploadsDir: resolveFromBackend(env.UPLOADS_DIR, "uploads"),
    authSecret,
    authIssuer: env.AUTH_ISSUER || "arino-imoveis-api",
    authAudience: env.AUTH_AUDIENCE || "arino-imoveis-admin",
    tokenTtlSeconds: 8 * 60 * 60,
    rateLimits: {
      publicPerMinute: Number(env.RATE_PUBLIC_PER_MINUTE || 300),
      adminPerMinute: Number(env.RATE_ADMIN_PER_MINUTE || 120),
      uploadPer10Min: Number(env.RATE_UPLOAD_PER_10_MIN || 30),
    },
    frontendOrigins: splitList(
      env.FRONTEND_ORIGINS ||
        "http://localhost:5500,http://127.0.0.1:5500,http://localhost:5502,http://127.0.0.1:5502,http://localhost:8080,http://127.0.0.1:8080"
    ),
    limits: {
      maxJsonBytes: 2 * 1024 * 1024,
      maxImageBytes: 8 * 1024 * 1024,
      maxImagesPerRequest: 10,
      maxPhotosPerProperty: 30,
      maxMultipartBytes: 10 * 8 * 1024 * 1024 + 256 * 1024,
    },
  };
}

module.exports = { loadConfig, loadEnvFile, BACKEND_ROOT };