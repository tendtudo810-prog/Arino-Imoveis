"use strict";

/**
 * Limitador de requisições por janela fixa, em memória.
 * Adequado a uma única instância da API (ver README, seção "Limitações").
 */
class RateLimiter {
  constructor({ limit, windowMs, now = () => Date.now() }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  /** Registra uma requisição para `key`. Retorna { allowed, retryAfterSeconds }. */
  hit(key) {
    const current = this.now();
    let entry = this.hits.get(key);
    if (!entry || current - entry.start >= this.windowMs) {
      entry = { start: current, count: 0 };
      this.hits.set(key, entry);
      this.prune(current);
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.start + this.windowMs - current) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  prune(current) {
    if (this.hits.size < 10000) return;
    for (const [key, entry] of this.hits) {
      if (current - entry.start >= this.windowMs) this.hits.delete(key);
    }
  }
}

module.exports = { RateLimiter };