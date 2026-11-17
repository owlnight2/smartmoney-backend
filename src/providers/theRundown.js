// ============================================================
// providers/theRundown.js — TheRundown.io API v2
// ============================================================
// Endpoints confirmados (docs + pruebas reales):
//   GET /sports                              → lista de deportes (sin key)
//   GET /affiliates                          → lista de books (sin key)
//   GET /markets                             → catálogo de mercados (sin key)
//   GET /sports/{sport_id}/events/{date}     → eventos con cuotas de un día
//   GET /events/{event_id}                   → detalle de un evento
//   GET /events/{event_id}/markets            → mercados de un evento
//   GET /markets/delta                       → deltas (solo Ultra/zero-delay)
//
// Autenticación: header X-TheRundown-Key
// Plan free: 200K datapoints/mes, 3 books (Pinnacle/DraftKings/FanDuel), 5 min retardo
//
// Sport IDs reales (verificados vía /sports):
//   2=NFL, 3=MLB, 4=NBA, 5=NCAAB, 6=NHL, 7=UFC/MMA,
//   11=EPL, 12=Ligue1, 13=Bundesliga, 14=LaLiga, 15=SerieA,
//   16=UCL, 17=UEL, 18=FIFA, 34=Liga MX, 38=ATP, 39=WTA
//
// Affiliate IDs reales (verificados vía /affiliates):
//   3=Pinnacle, 19=DraftKings, 23=FanDuel, 22=BetMGM, 32=Circa, 35=Caesars
//
// Market IDs (de la doc):
//   1=moneyline, 2=spread, 3=total (prematch core)
//   41,42,43 = versiones live

import { BaseProvider } from './base.js';

// Mapping sport_key (formato The Odds API) → sport_id numérico TheRundown
const SPORT_MAPPING = {
  'americanfootball_nfl': 2,
  'americanfootball_ncaaf': 1,
  'basketball_nba': 4,
  'basketball_ncaab': 5,
  'baseball_mlb': 3,
  'icehockey_nhl': 6,
  'mma_mixed_martial_arts': 7,
  'soccer_epl': 11,
  'soccer_france_ligue_one': 12,
  'soccer_germany_bundesliga': 13,
  'soccer_spain_la_liga': 14,
  'soccer_italy_serie_a': 15,
  'soccer_uefa_champs_league': 16,
  'soccer_uefa_europa_league': 17,
  'soccer_fifa_world_cup': 18,
  'soccer_mexico_ligamx': 34,
  'tennis_atp_singles': 38,
  'tennis_wta_singles': 39,
};

// Mapping affiliate_id TheRundown → book_key estándar (The Odds API compatible)
// Verificado vía /affiliates
const AFFILIATE_TO_BOOK = {
  3: 'pinnacle',
  19: 'draftkings',
  23: 'fanduel',
  22: 'betmgm',
  32: 'circa',
  35: 'caesars',
  30: 'novig',
};

// Reverse mapping por si hace falta
const BOOK_TO_AFFILIATE = Object.fromEntries(
  Object.entries(AFFILIATE_TO_BOOK).map(([id, key]) => [key, parseInt(id, 10)])
);

export class TheRundownProvider extends BaseProvider {
  constructor({ apiKey, baseUrl = 'https://therundown.io/api/v2', bookIds = null, cacheTtl }) {
    super({ name: 'therundown', cacheTtl });
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;

    // Free tier por defecto: Pinnacle + DraftKings + FanDuel
    // (Pinnacle es el "smart money" de referencia; DK/FD dan volumen US)
    this.bookIds = bookIds && bookIds.length ? bookIds : [3, 19, 23];

    // TheRundown NO expone cuota vía cabeceras estándar (requiere Ultra plan).
    // Contamos requests nosotros mismos.
    this.quota = {
      used: 0,
      remaining: null,
      lastUpdated: null,
    };
  }

  onResponseHeaders(headers) {
    // Si la API devuelve X-Datapoints-Remaining (Ultra), lo usamos
    const remaining = headers.get('x-datapoints-remaining');
    const used = headers.get('x-datapoints-used');
    if (remaining != null) this.quota.remaining = parseInt(remaining, 10);
    if (used != null) this.quota.used = parseInt(used, 10);
    else this.quota.used = this.requestCount;
    this.quota.lastUpdated = new Date().toISOString();
  }

  getQuota() {
    return {
      provider: this.name,
      used: this.quota.used ?? this.requestCount,
      remaining: this.quota.remaining,
      lastUpdated: this.quota.lastUpdated ?? this.lastRequestAt,
      note: 'TheRundown no expone cuota vía cabeceras en Free. Plan: 200K datapoints/mes, 20K/día.',
    };
  }

  // Lista de deportes soportados por este provider
  async listSports() {
    return Object.keys(SPORT_MAPPING).map(key => ({
      key,
      sport_id: SPORT_MAPPING[key],
      group: key.split('_')[0],
      title: key.replace(/_/g, ' '),
      active: true,
    }));
  }

  // Resuelve el sport_id numérico de TheRundown a partir del sport_key
  resolveSportId(sportKey) {
    const id = SPORT_MAPPING[sportKey];
    if (!id) {
      throw new Error(`TheRundown no soporta el sport_key: ${sportKey}`);
    }
    return id;
  }

  // Obtiene cuotas para un deporte en una fecha concreta (YYYY-MM-DD).
  // Si no se pasa fecha, usa hoy en UTC.
  async getOdds(sportKey, params = {}) {
    const sportId = this.resolveSportId(sportKey);
    const cacheKey = `odds:${sportKey}:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Fecha: por defecto hoy en UTC
    const date = (params.date ||
      (params.commenceTimeFrom ? params.commenceTimeFrom.slice(0, 10) : null) ||
      new Date().toISOString().slice(0, 10));

    const url = new URL(`${this.baseUrl}/sports/${sportId}/events/${date}`);

    // Parámetros obligatorios
    url.searchParams.set('market_ids', '1,2,3');        // moneyline, spread, total
    url.searchParams.set('affiliate_ids', this.bookIds.join(','));
    url.searchParams.set('main_line', 'true');          // solo línea principal
    url.searchParams.set('hide_closed', 'true');       // oculta cerrados
    url.searchParams.set('offset', '360');              // 6h hacia adelante

    const data = await this.fetchJson(url.toString(), {
      headers: { 'X-TheRundown-Key': this.apiKey },
    });

    // TheRundown devuelve { events: [...] }  (array de eventos con sus markets embebidos)
    const events = (data.events || []).map(ev => this.normalizeEvent(ev, sportKey));
    this.cache.set(cacheKey, events);
    return events;
  }

  // Convierte un evento TheRundown al formato estándar (The Odds API compatible)
  normalizeEvent(raw, sportKey) {
    // TheRundown: teams[0] = away, teams[1] = home (¡cuidado con el orden!)
    const awayTeam = raw.teams?.[0]?.name || 'Unknown';
    const homeTeam = raw.teams?.[1]?.name || 'Unknown';
    const isHomeFirst = raw.teams?.[0]?.is_home === true;

    const finalHome = isHomeFirst
      ? (raw.teams?.[0]?.name || 'Unknown')
      : (raw.teams?.[1]?.name || 'Unknown');
    const finalAway = isHomeFirst
      ? (raw.teams?.[1]?.name || 'Unknown')
      : (raw.teams?.[0]?.name || 'Unknown');

    // markets viene como objeto: { "1": [outcomes], "2": [...], "3": [...] }
    // Cada market_id: 1=moneyline, 2=spread, 3=total
    // Estructura típica por book (affiliate):
    //   { affiliate_id, markets: { "1": {...}, "2": {...}, "3": {...} } }
    const bookmakers = (raw.lines || raw.books || raw.affiliates || []).map(line => {
      const bookKey = AFFILIATE_TO_BOOK[line.affiliate_id || line.book_id] || `book_${line.affiliate_id || line.book_id}`;
      const markets = this.normalizeMarkets(line.markets || line, finalHome, finalAway);
      return {
        key: bookKey,
        title: line.affiliate_name || line.book_name || bookKey,
        last_update: line.last_update || raw.last_update || new Date().toISOString(),
        markets,
      };
    });

    return {
      id: String(raw.event_id || raw.event_uuid || ''),
      sport_key: sportKey,
      sport_title: raw.sport_name || sportKey,
      commence_time: raw.event_date || raw.commence_time || new Date().toISOString(),
      home_team: finalHome,
      away_team: finalAway,
      bookmakers,
    };
  }

  // Normaliza los mercados de un book
  normalizeMarkets(marketsObj, homeTeam, awayTeam) {
    const markets = [];

    // Market ID 1 = moneyline (h2h)
    const ml = marketsObj['1'] || marketsObj.moneyline;
    if (ml && (ml.moneyline_home != null || ml.moneyline_away != null)) {
      const outcomes = [
        { name: homeTeam, price: this.americanToDecimal(ml.moneyline_home) },
        { name: awayTeam, price: this.americanToDecimal(ml.moneyline_away) },
      ].filter(o => o.price > 0);
      if (ml.moneyline_draw != null) {
        outcomes.push({ name: 'Draw', price: this.americanToDecimal(ml.moneyline_draw) });
      }
      markets.push({ key: 'h2h', outcomes });
    }

    // Market ID 2 = point spread
    const sp = marketsObj['2'] || marketsObj.spread;
    if (sp && (sp.point_spread_home != null || sp.spread_home != null)) {
      markets.push({
        key: 'spreads',
        outcomes: [
          {
            name: homeTeam,
            price: this.americanToDecimal(sp.point_spread_home_price || sp.spread_home_price),
            point: sp.point_spread_home != null ? sp.point_spread_home : sp.spread_home,
          },
          {
            name: awayTeam,
            price: this.americanToDecimal(sp.point_spread_away_price || sp.spread_away_price),
            point: sp.point_spread_away != null ? sp.point_spread_away : sp.spread_away,
          },
        ],
      });
    }

    // Market ID 3 = total (over/under)
    const tt = marketsObj['3'] || marketsObj.total;
    if (tt && (tt.total_over != null || tt.total_over_price != null)) {
      markets.push({
        key: 'totals',
        outcomes: [
          {
            name: 'Over',
            price: this.americanToDecimal(tt.total_over_price),
            point: tt.total_over,
          },
          {
            name: 'Under',
            price: this.americanToDecimal(tt.total_under_price),
            point: tt.total_under,
          },
        ],
      });
    }

    return markets;
  }

  // Convierte cuota americana (+110, -110) → decimal (2.10, 1.91)
  americanToDecimal(american) {
    if (american == null || american === 0) return 0;
    const a = parseInt(american, 10);
    if (Number.isNaN(a)) return 0;
    if (a > 0) return +(a / 100 + 1).toFixed(2);
    return +(100 / Math.abs(a) + 1).toFixed(2);
  }
}

export { SPORT_MAPPING as THERUNDOWN_SPORT_MAPPING, AFFILIATE_TO_BOOK as THERUNDOWN_BOOK_MAPPING };
