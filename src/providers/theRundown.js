// ============================================================
// providers/theRundown.js — TheRundown.io API v2
// ============================================================
// Endpoints:
//   GET /sports                          → lista de deportes
//   GET /sports/{sportId}/events         → eventos con cuotas
//   GET /sports/{sportId}/events/{id}    → detalle de un evento
//
// Autenticación: header X-TheRundown-Key
// Plan free: 200K datapoints/mes, 3 books (DraftKings/FanDuel/BetMGM), 5 min retardo
// Plan Starter ($69/mes): 25 books, 60s retardo, incluye Pinnacle/Circa/BookMaker
//
// Nota: TheRundown es US-centric. Para fútbol EU, The Odds API es mejor opción.
// Este provider se usa para NFL/NBA/MLB donde TheRundown tiene mejor cobertura.

import { BaseProvider } from './base.js';

// Mapping sport_key (formato The Odds API) → sportId interno TheRundown
const SPORT_MAPPING = {
  'americanfootball_nfl': 'nfl',
  'americanfootball_ncaaf': 'ncaaf',
  'basketball_nba': 'nba',
  'basketball_ncaab': 'ncaab',
  'baseball_mlb': 'mlb',
  'icehockey_nhl': 'nhl',
  'soccer_epl': 'epl',
  'soccer_spain_la_liga': 'la_liga',
  'mma_mixed_martial_arts': 'mma',
  'boxing_boxing': 'boxing',
};

// Mapping book_id interno TheRundown → book_key estándar (The Odds API)
// Esto permite que smartMoneyAnalyzer trate los books igual que los de The Odds API.
const BOOK_MAPPING = {
  19: 'draftkings',
  22: 'fanduel',
  23: 'betmgm',
  18: 'pointsbetus',
  17: 'betrivers',
  16: 'superbook',
  6: 'pinnacle',
  7: 'circa',
  8: 'westgate',
  9: 'bookmaker',
  10: 'betonline',
  1: 'williamhill',
  2: 'unibet',
  3: 'bet365',
};

// Reverse: nombre legible → book_id (para filtrar book_ids si hace falta)
const NAME_TO_BOOK_ID = {
  'DraftKings': 19,
  'FanDuel': 22,
  'BetMGM': 23,
  'PointsBet': 18,
  'BetRivers': 17,
  'SuperBook': 16,
  'Pinnacle': 6,
  'Circa': 7,
  'Westgate': 8,
  'BookMaker': 9,
  'BetOnline': 10,
  'William Hill': 1,
  'Unibet': 2,
  'Bet365': 3,
};

export class TheRundownProvider extends BaseProvider {
  constructor({ apiKey, baseUrl = 'https://therundown.io/api/v2', bookIds = null, cacheTtl }) {
    super({ name: 'therundown', cacheTtl });
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    // bookIds por defecto: free tier = DraftKings/FanDuel/BetMGM
    this.bookIds = bookIds || [19, 22, 23];

    // TheRundown no expone cabeceras de cuota; contamos requests
    this.quota = {
      used: 0,
      remaining: null, // desconocido
      lastUpdated: null,
    };
  }

  onResponseHeaders(_headers) {
    this.quota.used = this.requestCount;
    this.quota.lastUpdated = new Date().toISOString();
  }

  getQuota() {
    return {
      provider: this.name,
      used: this.requestCount,
      remaining: null,
      lastUpdated: this.lastRequestAt,
      note: 'TheRundown no expone cuota vía cabeceras. Plan free: 200K datapoints/mes.',
    };
  }

  // Lista de deportes soportados (mapeados)
  async listSports() {
    return Object.keys(SPORT_MAPPING).map(key => ({
      key,
      sport_id: SPORT_MAPPING[key],
      group: key.split('_')[0],
      title: key.replace(/_/g, ' '),
      active: true,
    }));
  }

  async getOdds(sportKey, params = {}) {
    const sportId = SPORT_MAPPING[sportKey];
    if (!sportId) {
      throw new Error(`TheRundown no soporta el sport_key: ${sportKey}`);
    }
    const cacheKey = `odds:${sportKey}:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const url = new URL(`${this.baseUrl}/sports/${sportId}/events`);
    if (this.bookIds.length) {
      url.searchParams.set('book_ids', this.bookIds.join(','));
    }
    // Ventana de fechas opcional
    if (params.commenceTimeFrom) {
      url.searchParams.set('start_date', params.commenceTimeFrom.slice(0, 10));
    }
    if (params.commenceTimeTo) {
      url.searchParams.set('end_date', params.commenceTimeTo.slice(0, 10));
    }

    const data = await this.fetchJson(url.toString(), {
      headers: { 'X-TheRundown-Key': this.apiKey },
    });

    // Normalizar eventos al formato estándar (compatible con smartMoneyAnalyzer)
    const events = (data.events || []).map(ev => this.normalizeEvent(ev, sportKey));
    this.cache.set(cacheKey, events);
    return events;
  }

  // Convierte un evento TheRundown al formato estándar (The Odds API compatible)
  normalizeEvent(raw, sportKey) {
    const homeTeam = raw.teams?.[0]?.name || 'Unknown';
    const awayTeam = raw.teams?.[1]?.name || 'Unknown';

    const bookmakers = (raw.lines || []).map(line => {
      const bookKey = BOOK_MAPPING[line.book_id] || `book_${line.book_id}`;
      const markets = [];

      // h2h (moneyline)
      if (line.moneyline) {
        const ml = line.moneyline;
        markets.push({
          key: 'h2h',
          outcomes: [
            { name: homeTeam, price: this.americanToDecimal(ml.moneyline_home) },
            { name: awayTeam, price: this.americanToDecimal(ml.moneyline_away) },
          ].filter(o => o.price > 0),
        });
        if (ml.moneyline_draw != null) {
          markets[0].outcomes.push({
            name: 'Draw',
            price: this.americanToDecimal(ml.moneyline_draw),
          });
        }
      }

      // spreads (point spread)
      if (line.spread) {
        markets.push({
          key: 'spreads',
          outcomes: [
            {
              name: homeTeam,
              price: this.americanToDecimal(line.spread.point_spread_home_price),
              point: line.spread.point_spread_home,
            },
            {
              name: awayTeam,
              price: this.americanToDecimal(line.spread.point_spread_away_price),
              point: line.spread.point_spread_away,
            },
          ],
        });
      }

      // totals (over/under)
      if (line.total) {
        markets.push({
          key: 'totals',
          outcomes: [
            { name: 'Over', price: this.americanToDecimal(line.total.total_over_price), point: line.total.total_over },
            { name: 'Under', price: this.americanToDecimal(line.total.total_under_price), point: line.total.total_under },
          ],
        });
      }

      return {
        key: bookKey,
        title: line.book_name || bookKey,
        last_update: raw.last_update || new Date().toISOString(),
        markets,
      };
    });

    return {
      id: String(raw.event_id || raw.event_uuid),
      sport_key: sportKey,
      sport_title: raw.sport_name || sportKey,
      commence_time: raw.event_date || new Date().toISOString(),
      home_team: homeTeam,
      away_team: awayTeam,
      bookmakers,
    };
  }

  // Convierte cuota americana (+110, -110) → decimal (2.10, 1.91)
  americanToDecimal(american) {
    if (american == null || american === 0) return 0;
    const a = parseInt(american, 10);
    if (a > 0) return +(a / 100 + 1).toFixed(2);
    return +(100 / Math.abs(a) + 1).toFixed(2);
  }
}

// Exporta mappings por si se necesitan desde el router
export { SPORT_MAPPING as THERUNDOWN_SPORT_MAPPING, BOOK_MAPPING as THERUNDOWN_BOOK_MAPPING };
