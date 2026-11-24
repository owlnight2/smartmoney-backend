// ============================================================
// providers/base.js — Clase base para proveedores de cuotas
// ============================================================
// Todos los providers implementan esta interfaz común:
//   - getOdds(sportKey, params)        → eventos normalizados
//   - listSports()                     → lista de deportes soportados
//   - getQuota()                        → estado de cuota restante
//   - getProviderName()                 → identificador del provider
//
// Formato común de evento (compatible con smartMoneyAnalyzer):
//   {
//     id, sport_key, sport_title, commence_time,
//     home_team, away_team,
//     bookmakers: [{
//       key, title, last_update,
//       markets: [{ key, outcomes: [{ name, price, point }] }]
//     }]
//   }
//
// Cada provider normaliza su formato nativo a este estándar.

import { TtlCache } from '../cache.js';
import { config } from '../config.js';

export class BaseProvider {
  constructor({ name, cacheTtl }) {
    this.name = name;
    this.cache = new TtlCache(cacheTtl || config.cacheTtl);
    this.requestCount = 0;
    this.lastRequestAt = null;
  }

  getProviderName() { return this.name; }

  getQuota() {
    return {
      provider: this.name,
      used: this.requestCount,
      remaining: null, // cada subclase puede sobrescribir si la API expone cuota
      lastUpdated: this.lastRequestAt,
    };
  }

  clearCache() { this.cache.clear(); }

  cacheStats() { return { entries: this.cache.size ? this.cache.size() : 0 }; }

  // sleep para backoff
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // fetch con reintentos, backoff exponencial y rate-limit handling genérico
  async fetchJson(url, { headers = {}, timeout = 10000, retry = 0, maxRetries = 3 } = {}) {
    this.requestCount++;
    this.lastRequestAt = new Date().toISOString();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', ...headers },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Hook para que cada provider lea sus cabeceras de cuota
      if (this.onResponseHeaders) this.onResponseHeaders(res.headers);

      if (res.status === 429 && retry < maxRetries) {
        const wait = Math.pow(2, retry) * 1000;
        console.warn(`[${this.name}] 429 rate limited. Esperando ${wait}ms...`);
        await this.sleep(wait);
        return this.fetchJson(url, { headers, timeout, retry: retry + 1, maxRetries });
      }
      if (res.status === 401) throw new Error(`[${this.name}] API key inválida (401)`);
      if (res.status === 403) throw new Error(`[${this.name}] Sin acceso al endpoint (403)`);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`[${this.name}] HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError' && retry < 1) {
        await this.sleep(500);
        return this.fetchJson(url, { headers, timeout, retry: retry + 1, maxRetries });
      }
      if (err.name === 'FetchError' && retry < maxRetries) {
        await this.sleep(500 * (retry + 1));
        return this.fetchJson(url, { headers, timeout, retry: retry + 1, maxRetries });
      }
      throw err;
    }
  }

  // Cada subclase implementa estos métodos:
  // async getOdds(sportKey, params = {}) {}
  // async listSports() {}
  // normalizeEvent(rawEvent) {}
}
