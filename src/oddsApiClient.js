// ============================================================
// oddsApiClient.js — Cliente de The Odds API v4
// ============================================================
// Endpoints usados:
//   GET /sports                                  → lista de deportes soportados
//   GET /sports/{sport_key}/odds                 → cuotas en vivo de una liga
//   GET /sports/{sport_key}/scores               → resultados (para histórico)
//
// Maneja:
//   - Autenticación por query param (apiKey)
//   - Rate limiting (cabeceras X-Requests-*)
//   - Cache de respuestas por endpoint
//   - Reintentos con backoff exponencial en 429
//   - Cuota restante en config._quota (mutada)

import { config } from './config.js';
import { TtlCache } from './cache.js';

const cache = new TtlCache(config.cacheTtl);

// Estado mutable de cuota
export const quota = {
  used: 0,
  remaining: 500,    // se actualiza con cabeceras reales
  lastUpdated: null,
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, retry = 0) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    // Actualizar cuota desde cabeceras
    if (res.headers.get('x-requests-used')) {
      quota.used = parseInt(res.headers.get('x-requests-used'), 10);
    }
    if (res.headers.get('x-requests-remaining')) {
      quota.remaining = parseInt(res.headers.get('x-requests-remaining'), 10);
    }
    quota.lastUpdated = new Date().toISOString();

    if (res.status === 429 && retry < 3) {
      // Rate limited: backoff exponencial
      const wait = Math.pow(2, retry) * 1000;
      console.warn(`[oddsApi] 429 rate limited. Esperando ${wait}ms...`);
      await sleep(wait);
      return fetchJson(url, retry + 1);
    }
    if (res.status === 401) {
      throw new Error('ODDS_API_KEY inválida o expirada (401)');
    }
    if (res.status === 403) {
      throw new Error('Sin acceso al endpoint. Verifica tu plan de The Odds API (403)');
    }
    if (res.status === 422) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Parámetros inválidos: ${body.message || 'unknown'}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} desde The Odds API`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'FetchError' && retry < 2) {
      await sleep(500 * (retry + 1));
      return fetchJson(url, retry + 1);
    }
    throw err;
  }
}

function buildUrl(path, params = {}) {
  const url = new URL(`${config.ODDS_API_BASE}${path}`);
  url.searchParams.set('apiKey', config.oddsApiKey);
  url.searchParams.set('regions', config.oddsApiRegion);
  if (config.oddsApiMarkets.length) {
    url.searchParams.set('markets', config.oddsApiMarkets.join(','));
  }
  url.searchParams.set('oddsFormat', config.oddsApiFormat);
  if (config.bookmakers.length) {
    url.searchParams.set('bookmakers', config.bookmakers.join(','));
  }
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }
  return url.toString();
}

// GET /sports
export async function listSports() {
  const cacheKey = 'sports';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const url = buildUrl('/sports');
  const data = await fetchJson(url);
  cache.set(cacheKey, data, 24 * 3600 * 1000); // 24h cache (lista casi nunca cambia)
  return data;
}

// GET /sports/{sport_key}/odds
// params: { dateFormat: 'iso', commenceTimeFrom, commenceTimeTo }
export async function getOdds(sportKey, params = {}) {
  const cacheKey = `odds:${sportKey}:${JSON.stringify(params)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const url = buildUrl(`/sports/${sportKey}/odds`, {
    dateFormat: 'iso',
    ...params,
  });
  const data = await fetchJson(url);
  cache.set(cacheKey, data);
  return data;
}

// GET /sports/{sport_key}/scores
export async function getScores(sportKey, params = {}) {
  const cacheKey = `scores:${sportKey}:${JSON.stringify(params)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const url = buildUrl(`/sports/${sportKey}/scores`, {
    dateFormat: 'iso',
    ...params,
  });
  const data = await fetchJson(url);
  cache.set(cacheKey, data, 5 * 60 * 1000); // 5 min cache para scores
  return data;
}

export function clearCache() { cache.clear(); }
export function cacheStats() { return { entries: cache.size(), ttlMs: cache.ttl }; }
