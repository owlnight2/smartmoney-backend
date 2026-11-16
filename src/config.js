// ============================================================
// config.js — Carga y valida variables de entorno
// ============================================================
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '..');

export const config = {
  port: parseInt(process.env.PORT || '8787', 10),

  // The Odds API
  oddsApiKey: process.env.ODDS_API_KEY || '',
  oddsApiRegion: process.env.ODDS_API_REGION || 'eu',
  oddsApiMarkets: (process.env.ODDS_API_MARKETS || 'h2h,spreads,totals').split(',').map(s => s.trim()).filter(Boolean),
  oddsApiFormat: process.env.ODDS_API_ODDS_FORMAT || 'decimal',
  bookmakers: (process.env.BOOKMAKERS || '').split(',').map(s => s.trim()).filter(Boolean),

  // Cache
  cacheTtl: parseInt(process.env.CACHE_TTL || '60', 10),

  // Histórico
  historicalDir: path.resolve(BACKEND_DIR, process.env.HISTORICAL_DIR || './data/historical'),
  snapshotInterval: parseInt(process.env.SNAPSHOT_INTERVAL || '600', 10),

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean),

  // Demo mode (sin API key)
  demoMode: process.env.DEMO_MODE === 'true',

  // Constantes
  ODDS_API_BASE: 'https://api.the-odds-api.com/v4',
  // Sharps tradicionales (líneas de referencia más eficientes / menos margen)
  // En región eu, Pinnacle es el principal sharp. BetOnline (betonlineag) también lo es.
  BOOKIES_SHARP: ['pinnacle', 'betonlineag', 'circa', 'westgate', 'betonline'],
  // Públicos masivos (cargan al favorito, mayor margen, más volumen de aficionados)
  // Para eu: williamhill, unibet, bet365, betsson, marathonbet, tipico, etc.
  BOOKIES_PUBLIC: [
    'williamhill', 'unibet_fr', 'unibet_nl', 'unibet_se', 'nordicbet',
    'betsson', 'marathonbet', 'tipico_de', 'leovegas_se', 'coolbet',
    'everygame', 'pmu_fr', 'codere_it', 'winamax_fr', 'winamax_de',
    // US (cuando la región sea us)
    'draftkings', 'fanduel', 'betmgm', 'pointsbetus', 'superbook',
    'betrivers', 'twinspires', 'foxbet',
  ],
  // Bookmakers de intercambio (betfair, matchbook, smarkets):
  // sus cuotas reflejan el mercado real sin margen, pero no son "sharp" ni
  // "público" en el sentido tradicional. Los tratamos como referencia extra.
  BOOKIES_EXCHANGE: ['betfair_ex_eu', 'matchbook'],
};

export function validateConfig() {
  const errors = [];
  if (!config.demoMode && !config.oddsApiKey) {
    errors.push('ODDS_API_KEY es obligatorio salvo en DEMO_MODE=true');
  }
  if (!['us', 'eu', 'uk', 'au'].includes(config.oddsApiRegion)) {
    errors.push(`ODDS_API_REGION inválido: ${config.oddsApiRegion} (us|eu|uk|au)`);
  }
  if (!['decimal', 'american'].includes(config.oddsApiFormat)) {
    errors.push(`ODDS_API_ODDS_FORMAT inválido: ${config.oddsApiFormat} (decimal|american)`);
  }
  if (config.cacheTtl < 5) {
    console.warn('[config] CACHE_TTL < 5s puede agotar la cuota de The Odds API');
  }
  return errors;
}
