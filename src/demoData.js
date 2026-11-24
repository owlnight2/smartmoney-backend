// ============================================================
// demoData.js — Generador de datos sintéticos para DEMO_MODE
// ============================================================
// Reproduce la estructura de respuesta de The Odds API pero con
// cuotas aleatorias deterministas (seedeadas) para poder
// desarrollar y probar sin consumir cuota real.
//
// Estructura idéntica a getOdds():
//   [{
//     id, sport_key, sport_title, commence_time, home_team, away_team,
//     bookmakers: [{ key, title, last_update, markets: [{ key, last_update, outcomes: [{ name, price, point }] }] }]
//   }]

import { SUPPORTED_SPORTS, labelFor } from './leagues.js';
import { config } from './config.js';

// PRNG mulberry32 determinista
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0;
  return h;
}

// Equipos por deporte (listas cortas para demo)
const TEAMS_BY_SPORT = {
  soccer_spain_la_liga: ['Real Madrid', 'FC Barcelona', 'Atlético Madrid', 'Sevilla', 'Real Sociedad', 'Valencia', 'Villarreal', 'Real Betis'],
  soccer_epl:           ['Manchester City', 'Arsenal', 'Liverpool', 'Manchester United', 'Tottenham', 'Chelsea', 'Newcastle', 'Aston Villa'],
  soccer_italy_serie_a:['Inter', 'AC Milan', 'Juventus', 'Napoli', 'Roma', 'Atalanta', 'Lazio', 'Fiorentina'],
  soccer_germany_bundesliga: ['Bayern Munich', 'Borussia Dortmund', 'RB Leipzig', 'Leverkusen', 'Union Berlin', 'Frankfurt', 'Wolfsburg', 'Freiburg'],
  soccer_france_ligue_one:   ['PSG', 'Marseille', 'Monaco', 'Lyon', 'Lille', 'Nice', 'Rennes', 'Lens'],
  americanfootball_nfl: ['Kansas City Chiefs', 'Buffalo Bills', 'Philadelphia Eagles', 'San Francisco 49ers', 'Dallas Cowboys', 'Cincinnati Bengals', 'Baltimore Ravens', 'Detroit Lions'],
  basketball_nba:      ['Boston Celtics', 'Denver Nuggets', 'Milwaukee Bucks', 'Phoenix Suns', 'Golden State Warriors', 'LA Lakers', 'Miami Heat', 'Philadelphia 76ers'],
  baseball_mlb:        ['Los Angeles Dodgers', 'Atlanta Braves', 'Houston Astros', 'New York Yankees', 'Philadelphia Phillies', 'Baltimore Orioles', 'Texas Rangers', 'Tampa Bay Rays'],
};

const BOOKMAKERS_EU = [
  { key: 'pinnacle',     title: 'Pinnacle' },
  { key: 'bet365',       title: 'Bet365' },
  { key: 'williamhill',  title: 'William Hill' },
  { key: 'unibet',       title: 'Unibet' },
  { key: 'betclic',      title: 'Betclic' },
  { key: 'betway',       title: 'Betway' },
];

const BOOKMAKERS_US = [
  { key: 'draftkings',   title: 'DraftKings' },
  { key: 'fanduel',      title: 'FanDuel' },
  { key: 'betmgm',       title: 'BetMGM' },
  { key: 'pointsbetus',  title: 'PointsBet' },
];

function getBookmakers() {
  return config.oddsApiRegion === 'us' ? BOOKMAKERS_US : BOOKMAKERS_EU;
}

// Genera N partidos futuros para una liga (determinista por liga+día)
export function generateDemoEvents(sportKey, count = 6) {
  const teams = TEAMS_BY_SPORT[sportKey] || TEAMS_BY_SPORT.soccer_spain_la_liga;
  const seed = hash(sportKey + new Date().toISOString().slice(0, 10));
  const r = rng(seed);
  const bookmakers = getBookmakers();
  const events = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const homeIdx = Math.floor(r() * teams.length);
    let awayIdx = Math.floor(r() * teams.length);
    while (awayIdx === homeIdx) awayIdx = Math.floor(r() * teams.length);
    const home = teams[homeIdx];
    const away = teams[awayIdx];
    // commence_time: en las próximas 48h
    const commence = new Date(now.getTime() + (i + 1) * 4 * 3600 * 1000);
    events.push({
      id: `${sportKey}-demo-${i}`,
      sport_key: sportKey,
      sport_title: labelFor(sportKey),
      commence_time: commence.toISOString(),
      home_team: home,
      away_team: away,
      bookmakers: buildBookmakers(home, away, sportKey, bookmakers, r),
    });
  }
  return events;
}

function buildBookmakers(home, away, sportKey, bookmakers, r) {
  return bookmakers.map(b => {
    const isSharp = config.BOOKIES_SHARP.includes(b.key);
    return {
      key: b.key,
      title: b.title,
      last_update: new Date().toISOString(),
      markets: buildMarkets(home, away, sportKey, isSharp, r),
    };
  });
}

function buildMarkets(home, away, sportKey, isSharp, r) {
  // Probabilidades "verdaderas" base + sesgo sharp (sharps más cerca del valor real)
  const pHomeBase = 0.4 + r() * 0.2;     // 0.40-0.60
  const pHome = isSharp
    ? Math.min(0.85, pHomeBase + 0.05)   // sharps sobrevaloran al favorito
    : Math.max(0.25, pHomeBase - 0.03);
  const pAway = 1 - pHome;

  const markets = [{
    key: 'h2h',
    last_update: new Date().toISOString(),
    outcomes: [
      { name: home, price: decimalOdds(pHome, isSharp) },
      { name: away, price: decimalOdds(pAway, isSharp) },
    ],
  }];

  // Spreads (handicap) solo en deportes USA
  if (sportKey.startsWith('americanfootball') || sportKey.startsWith('basketball') || sportKey.startsWith('baseball')) {
    const spread = (r() - 0.5) * 8;
    markets.push({
      key: 'spreads',
      last_update: new Date().toISOString(),
      outcomes: [
        { name: home, price: decimalOdds(0.5 + (isSharp ? 0.03 : -0.02), isSharp), point: -spread },
        { name: away, price: decimalOdds(0.5 - (isSharp ? 0.03 : -0.02), isSharp), point: spread },
      ],
    });
  }

  // Totals (Over/Under)
  const totalPoint = sportKey.startsWith('basketball') ? 220 :
                     sportKey.startsWith('americanfootball') ? 47 :
                     sportKey.startsWith('baseball') ? 8 : 2.5;
  const pOver = 0.5 + (r() - 0.5) * 0.2;
  markets.push({
    key: 'totals',
    last_update: new Date().toISOString(),
    outcomes: [
      { name: 'Over', price: decimalOdds(pOver, isSharp), point: totalPoint },
      { name: 'Under', price: decimalOdds(1 - pOver, isSharp), point: totalPoint },
    ],
  });

  return markets;
}

// Decimal odds from probability with bookmaker margin (overround)
function decimalOdds(p, isSharp) {
  const margin = isSharp ? 0.02 : 0.05;   // sharps cargan ~2%, públicos ~5%
  const adj = Math.max(0.02, Math.min(0.98, p * (1 - margin)));
  return Math.round((1 / adj) * 100) / 100;
}

export { SUPPORTED_SPORTS };
