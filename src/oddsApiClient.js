// ============================================================
// oddsApiClient.js — Router unificado de proveedores de cuotas
// ============================================================
// Patrón adaptador: despacha cada petición al provider adecuado.
// Por defecto, todo va a The Odds API. Si THERUNDOWN_API_KEY está
// configurada, los deportes US (NFL/NBA/MLB/NHL/NCAAF/NCAAB) se
// sirven desde TheRundown (200K datapoints/mes gratis).
//
// Si en el futuro se añaden más providers (OddsJam, Sportradar),
// basta con crear su archivo en providers/ y añadirlo al routing.
//
// API pública (compatible hacia atrás con server.js):
//   - listSports()
//   - getOdds(sportKey, params)
//   - getScores(sportKey, params)         (solo The Odds API)
//   - clearCache()
//   - cacheStats()
//   - quota                                (objeto mutable con cuota agregada)
//   - providers                            (mapa de providers activos)

import { config } from './config.js';
import { TtlCache } from './cache.js';
import { TheOddsApiProvider } from './providers/theOddsApi.js';
import { TheRundownProvider, THERUNDOWN_SPORT_MAPPING } from './providers/theRundown.js';

// --- Instancia de The Odds API (siempre activo) ---
const theOddsApi = new TheOddsApiProvider({
  apiKey: config.oddsApiKey,
  region: config.oddsApiRegion,
  markets: config.oddsApiMarkets,
  oddsFormat: config.oddsApiFormat,
  bookmakers: config.bookmakers,
  cacheTtl: config.cacheTtl,
});

// --- Instancia de TheRundown (opcional, si hay API key) ---
const theRundown = config.therundownApiKey
  ? new TheRundownProvider({
      apiKey: config.therundownApiKey,
      bookIds: config.therundownBookIds,
      cacheTtl: config.cacheTtl,
    })
  : null;

// --- Mapa de providers activos ---
export const providers = {
  'the-odds-api': theOddsApi,
  ...(theRundown ? { 'therundown': theRundown } : {}),
};

// --- Routing: qué provider atiende cada sport_key ---
// Por defecto TheRundown si está disponible para deportes US.
const ROUTING = {};
if (theRundown) {
  for (const sportKey of Object.keys(THERUNDOWN_SPORT_MAPPING)) {
    ROUTING[sportKey] = 'therundown';
  }
}
// Si PROVIDER_PREFERENCE=the-odds-api en .env, todo va a The Odds API
if (config.providerPreference === 'the-odds-api') {
  for (const k of Object.keys(ROUTING)) delete ROUTING[k];
}

function providerFor(sportKey) {
  const name = ROUTING[sportKey];
  if (name && providers[name]) return providers[name];
  return theOddsApi; // default
}

// --- Objeto quota agregado (compatible hacia atrás con server.js) ---
// Expone la cuota del provider principal (The Odds API).
export const quota = {
  used: 0,
  remaining: 500,
  lastUpdated: null,
  providers: {},
};

function refreshQuota() {
  const theOddsApiQuota = theOddsApi.getQuota();
  quota.used = theOddsApiQuota.used;
  quota.remaining = theOddsApiQuota.remaining;
  quota.lastUpdated = theOddsApiQuota.lastUpdated;
  quota.providers = {};
  for (const [name, p] of Object.entries(providers)) {
    quota.providers[name] = p.getQuota();
  }
}

// --- API pública ---

export async function listSports() {
  // Unión de deportes de todos los providers activos
  const all = [];
  if (theRundown && config.providerPreference !== 'the-odds-api') {
    all.push(...await theRundown.listSports());
  }
  if (!config.demoMode) {
    try {
      const sports = await theOddsApi.listSports();
      all.push(...sports);
    } catch (err) {
      console.warn('[oddsApiClient] The Odds API listSports falló:', err.message);
    }
  }
  // Dedupe por key
  const seen = new Set();
  const unique = all.filter(s => {
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
  refreshQuota();
  return unique;
}

export async function getOdds(sportKey, params = {}) {
  const provider = providerFor(sportKey);
  const data = await provider.getOdds(sportKey, params);
  refreshQuota();
  return data;
}

export async function getScores(sportKey, params = {}) {
  // Scores solo lo expone The Odds API
  if (providerFor(sportKey) !== theOddsApi) {
    throw new Error(`Scores no disponible para ${sportKey} vía TheRundown`);
  }
  const data = await theOddsApi.getScores(sportKey, params);
  refreshQuota();
  return data;
}

export function clearCache() {
  for (const p of Object.values(providers)) p.clearCache();
}

export function cacheStats() {
  const stats = {};
  for (const [name, p] of Object.entries(providers)) {
    stats[name] = p.cacheStats();
  }
  return stats;
}

// Devuelve info de routing (para /api/leagues o depuración)
export function getProviderForSport(sportKey) {
  const p = providerFor(sportKey);
  return p.getProviderName();
}

export function listActiveProviders() {
  return Object.entries(providers).map(([name, p]) => ({
    name,
    quota: p.getQuota(),
  }));
}
