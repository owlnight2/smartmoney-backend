// ============================================================
// leagues.js — Mapeo de ligas del frontend → sport_key de The Odds API
// ============================================================
// The Odds API usa "sport_key" para identificar cada liga/deporte.
// Doc: https://the-odds-api.com/liveapi/guides/v4/#get-sports
//
// Mapeo (limpio y conservador — solo ligas con cobertura real):
export const LEAGUE_TO_SPORT_KEY = {
  // Fútbol europeo
  'LaLiga':      'soccer_spain_la_liga',
  'Premier':     'soccer_epl',
  'SerieA':      'soccer_italy_serie_a',
  'Bundesliga':  'soccer_germany_bundesliga',
  'Ligue1':      'soccer_france_ligue_one',
  // USA
  'NFL':         'americanfootball_nfl',
  'NBA':         'basketball_nba',
  'MLB':         'baseball_mlb',
  // Competiciones internacionales
  'UCL':         'soccer_uefa_champs_league',
  'UEL':         'soccer_uefa_europa_league',
};

// Inverso: sport_key → etiqueta legible en español
export const SPORT_KEY_TO_LABEL = Object.fromEntries(
  Object.entries(LEAGUE_TO_SPORT_KEY).map(([k, v]) => [v, k])
);

// Deportes soportados (todos los de The Odds API que podemos servir).
// Lista completa en /sports endpoint. Aquí solo los más relevantes.
export const SUPPORTED_SPORTS = [
  // Fútbol
  'soccer_epl', 'soccer_spain_la_liga', 'soccer_italy_serie_a',
  'soccer_germany_bundesliga', 'soccer_france_ligue_one',
  'soccer_uefa_champs_league', 'soccer_uefa_europa_league',
  'soccer_fifa_world_cup',
  // USA
  'americanfootball_nfl', 'basketball_nba', 'baseball_mlb',
  // Otros
  'mma_mixed_martial_arts', 'boxing_boxing',
  'icehockey_nhl', 'tennis_atp_aus_open_singles',
];

// Devuelve la etiqueta legible dado un sport_key o leagueCode
export function labelFor(key) {
  return SPORT_KEY_TO_LABEL[key] || key;
}

// Devuelve el sport_key de The Odds API dado un leagueCode del frontend
export function sportKeyFor(leagueCode) {
  return LEAGUE_TO_SPORT_KEY[leagueCode] || null;
}
