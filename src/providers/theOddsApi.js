// ============================================================
// providers/theOddsApi.js — The Odds API v4
// ============================================================
// Endpoints:
//   GET /sports                         → lista de deportes
//   GET /sports/{sport_key}/odds        → cuotas en vivo
//   GET /sports/{sport_key}/scores      → resultados
//
// Autenticación: query param ?apiKey=
// Cabeceras de cuota: x-requests-used, x-requests-remaining

import { BaseProvider } from './base.js';
import { config } from '../config.js';

export class TheOddsApiProvider extends BaseProvider {
  constructor({ apiKey, baseUrl = config.ODDS_API_BASE, region, markets, oddsFormat, bookmakers, cacheTtl }) {
    super({ name: 'the-odds-api', cacheTtl });
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.region = region || config.oddsApiRegion;
    this.markets = markets || config.oddsApiMarkets;
    this.oddsFormat = oddsFormat || config.oddsApiFormat;
    this.bookmakers = bookmakers || config.bookmakers;

    // Cuota expuesta por The Odds API vía cabeceras
    this.quota = {
      used: 0,
      remaining: 500,
      lastUpdated: null,
    };
  }

  onResponseHeaders(headers) {
    if (headers.get('x-requests-used')) {
      this.quota.used = parseInt(headers.get('x-requests-used'), 10);
    }
    if (headers.get('x-requests-remaining')) {
      this.quota.remaining = parseInt(headers.get('x-requests-remaining'), 10);
    }
    this.quota.lastUpdated = new Date().toISOString();
  }

  // Sobrescribe getQuota para devolver la cuota real de The Odds API
  getQuota() {
    return {
      provider: this.name,
      used: this.quota.used,
      remaining: this.quota.remaining,
      lastUpdated: this.quota.lastUpdated,
    };
  }

  buildUrl(path, params = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('regions', this.region);
    if (this.markets.length) url.searchParams.set('markets', this.markets.join(','));
    url.searchParams.set('oddsFormat', this.oddsFormat);
    if (this.bookmakers.length) url.searchParams.set('bookmakers', this.bookmakers.join(','));
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
    return url.toString();
  }

  async listSports() {
    const cacheKey = 'sports';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const url = this.buildUrl('/sports');
    const data = await this.fetchJson(url);
    this.cache.set(cacheKey, data, 24 * 3600 * 1000);
    return data;
  }

  async getOdds(sportKey, params = {}) {
    const cacheKey = `odds:${sportKey}:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const url = this.buildUrl(`/sports/${sportKey}/odds`, {
      dateFormat: 'iso',
      ...params,
    });
    const data = await this.fetchJson(url);
    // The Odds API ya devuelve eventos en formato estándar — no hace falta normalizar
    this.cache.set(cacheKey, data);
    return data;
  }

  async getScores(sportKey, params = {}) {
    const cacheKey = `scores:${sportKey}:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const url = this.buildUrl(`/sports/${sportKey}/scores`, {
      dateFormat: 'iso',
      ...params,
    });
    const data = await this.fetchJson(url);
    this.cache.set(cacheKey, data, 5 * 60 * 1000);
    return data;
  }
}

// Compatibilidad hacia atrás: si alguien importa quota directamente desde aquí
export const quota = {
  used: 0,
  remaining: 500,
  lastUpdated: null,
};
