// ============================================================
// server.js — Servidor Express para Smart Money Tracker en vivo
// ============================================================
// Endpoints:
//   GET  /health                    → estado del servidor + cuota restante
//   GET  /api/sports                → deportes soportados
//   GET  /api/leagues               → mapeo liga_frontend → sport_key
//   GET  /api/odds/:sportKey        → cuotas en vivo (raw) de una liga
//   GET  /api/odds/:sportKey/sm     → cuotas + análisis smart money
//   GET  /api/smart-money           → análisis agregado de TODAS las ligas
//   GET  /api/smart-money/:league   → análisis de una liga concreta
//   GET  /api/historical/:sportKey  → último snapshot histórico
//   POST /api/cache/clear           → vacía cache (admin)
//   GET  /api/quota                 → cuota restante de The Odds API
//
// Job periódico (cada SNAPSHOT_INTERVAL):
//   - Para cada liga soportada, descarga cuotas y guarda snapshot en disco
//   - Esto permite que RLM/STEAM funcionen con datos reales de movimiento

import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config.js';
import { listSports, getOdds, clearCache, cacheStats, quota, listActiveProviders } from './oddsApiClient.js';
import { LEAGUE_TO_SPORT_KEY, SUPPORTED_SPORTS, labelFor, sportKeyFor } from './leagues.js';
import { generateDemoEvents } from './demoData.js';
import { analyzeEvents } from './smartMoneyAnalyzer.js';
import { analyzeParlay, findBestParlay } from './parlayOptimizer.js';
import { saveSnapshot, getPreviousSnapshot, diffSnapshots, purgeOld } from './historicalStore.js';

const app = express();
const PORT = config.port;

// --- Middleware ---
const corsOptions = {
  origin: (origin, cb) => {
    if (config.corsOrigins.includes('*') || !origin) return cb(null, true);
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS no permitido para ' + origin));
  },
};
app.use(cors(corsOptions));
app.use(express.json());

// Logger simple
app.use((req, _res, next) => {
  if (!req.url.startsWith('/health')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

// --- Helpers ---
// The Odds API exige formato ISO sin milisegundos: YYYY-MM-DDTHH:MM:SSZ
function toOddsApiDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function fetchOddsForSport(sportKey) {
  if (config.demoMode) {
    return generateDemoEvents(sportKey, 6);
  }
  // Ventana de 7 días hacia adelante
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  return getOdds(sportKey, {
    commenceTimeFrom: toOddsApiDate(now),
    commenceTimeTo: toOddsApiDate(inSevenDays),
  });
}

// --- Endpoints ---

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    demoMode: config.demoMode,
    uptime: process.uptime(),
    cache: cacheStats(),
    quota,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/sports', async (_req, res) => {
  try {
    if (config.demoMode) {
      return res.json(SUPPORTED_SPORTS.map(key => ({ key, group: key.split('_')[0], title: labelFor(key), active: true })));
    }
    const sports = await listSports();
    res.json(sports);
  } catch (err) {
    console.error('[/api/sports]', err.message);
    res.status(502).json({ error: 'No se pudo obtener lista de deportes', detail: err.message });
  }
});

app.get('/api/leagues', (_req, res) => {
  res.json({
    mapping: LEAGUE_TO_SPORT_KEY,
    bookmakers: {
      sharp: config.BOOKIES_SHARP,
      public: config.BOOKIES_PUBLIC,
      configured: config.bookmakers,
    },
    region: config.oddsApiRegion,
  });
});

app.get('/api/odds/:sportKey', async (req, res) => {
  const { sportKey } = req.params;
  try {
    const events = await fetchOddsForSport(sportKey);
    res.json({ sportKey, count: events.length, events });
  } catch (err) {
    console.error('[/api/odds]', err.message);
    res.status(502).json({ error: 'No se pudo obtener cuotas', detail: err.message });
  }
});

app.get('/api/odds/:sportKey/sm', async (req, res) => {
  const { sportKey } = req.params;
  try {
    const events = await fetchOddsForSport(sportKey);
    const rows = analyzeEvents(events);
    res.json({ sportKey, count: rows.length, rows });
  } catch (err) {
    console.error('[/api/odds/sm]', err.message);
    res.status(502).json({ error: 'No se pudo analizar smart money', detail: err.message });
  }
});

// Liga concreta (por leagueCode del frontend: LaLiga, Premier, etc.)
app.get('/api/smart-money/:league', async (req, res) => {
  const { league } = req.params;
  const sportKey = sportKeyFor(league);
  if (!sportKey) {
    return res.status(404).json({ error: `Liga no soportada: ${league}`, supported: Object.keys(LEAGUE_TO_SPORT_KEY) });
  }
  try {
    const events = await fetchOddsForSport(sportKey);
    const rows = analyzeEvents(events);

    // Comparar con snapshot histórico para detectar RLM/STEAM basados en movimiento
    const prevSnapshot = getPreviousSnapshot(sportKey);
    if (prevSnapshot) {
      const diff = diffSnapshots(prevSnapshot, { events, timestamp: new Date().toISOString() });
      // Marcar filas con movimiento detectado
      rows.forEach(r => {
        const evDiff = diff[r.eventId];
        if (!evDiff) return;
        const mktDiff = evDiff[r.market];
        if (!mktDiff) return;
        const selDiff = mktDiff[r.selection];
        if (!selDiff) return;
        // Movimiento en cualquier bookie
        const deltas = Object.values(selDiff).map(x => x.delta);
        const totalDelta = deltas.reduce((a, b) => a + b, 0);
        if (totalDelta !== 0) {
          r.lineMovement = { totalDelta, books: selDiff };
          // STEAM: la cuota baja (price < oldPrice) en varios sharps → dinero sharp cargando
          // Sharp = BOOKIES_SHARP + BOOKIES_EXCHANGE (referencias más eficientes)
          const sharpBookSet = new Set([...config.BOOKIES_SHARP, ...(config.BOOKIES_EXCHANGE || [])]);
          const sharpMoves = Object.entries(selDiff)
            .filter(([bk]) => sharpBookSet.has(bk));
          if (sharpMoves.length >= 2 && sharpMoves.every(([, m]) => m.delta < 0)) {
            r.steam = true;
          }
          // RLM: si la cuota del lado público sube (price > oldPrice) en bookies públicos
          // mientras los sharps la bajan → movimiento contrario
          const publicMoves = Object.entries(selDiff)
            .filter(([bk]) => config.BOOKIES_PUBLIC.includes(bk));
          if (sharpMoves.some(([, m]) => m.delta < 0) &&
              publicMoves.some(([, m]) => m.delta > 0) &&
              r.ticketPct > 55) {
            r.rlm = true;
          }
        }
      });
    }

    res.json({ league, sportKey, count: rows.length, rows });
  } catch (err) {
    console.error('[/api/smart-money/:league]', err.message);
    res.status(502).json({ error: 'No se pudo analizar', detail: err.message });
  }
});

// TODAS las ligas agregadas
app.get('/api/smart-money', async (_req, res) => {
  try {
    const allRows = [];
    const perLeague = {};
    for (const sportKey of SUPPORTED_SPORTS) {
      try {
        const events = await fetchOddsForSport(sportKey);
        const rows = analyzeEvents(events);
        perLeague[labelFor(sportKey)] = rows.length;
        allRows.push(...rows);
      } catch (err) {
        console.warn(`[smart-money] ${sportKey}: ${err.message}`);
        perLeague[labelFor(sportKey)] = 0;
      }
    }
    allRows.sort((a, b) => b.edgePct - a.edgePct);
    res.json({
      count: allRows.length,
      perLeague,
      rows: allRows,
      demoMode: config.demoMode,
      quota,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[/api/smart-money]', err.message);
    res.status(500).json({ error: 'Error interno', detail: err.message });
  }
});

app.get('/api/historical/:sportKey', (req, res) => {
  const prev = getPreviousSnapshot(req.params.sportKey);
  if (!prev) return res.status(404).json({ error: 'Sin snapshot histórico disponible' });
  res.json(prev);
});

// ============================================================
// Endpoints de parlay optimizer (2026-11-17)
// ============================================================

// POST /api/parlay/analyze
// Body: { picks: [{ eventId, homeTeam, awayTeam, market, selection, publicOdds, sharpPct, confidence, verdict, commenceTime, sportKey }] }
// Devuelve análisis del parlay: cuota total, EV, Kelly, correlación, recomendación
app.post('/api/parlay/analyze', (req, res) => {
  try {
    const { picks } = req.body || {};
    if (!Array.isArray(picks) || picks.length < 2) {
      return res.status(400).json({ error: 'Se requieren al menos 2 picks en el parlay' });
    }
    const analysis = analyzeParlay(picks);
    res.json({ analysis });
  } catch (err) {
    console.error('[/api/parlay/analyze]', err.message);
    res.status(500).json({ error: 'No se pudo analizar el parlay', detail: err.message });
  }
});

// GET /api/parlay/optimize?league=LaLiga&maxLegs=4&minConfidence=60&minEv=1
// Busca el mejor parlay posible entre todos los picks actuales de una liga (o todas si no se especifica)
app.get('/api/parlay/optimize', async (req, res) => {
  try {
    const { league, maxLegs = 4, minConfidence = 60, minEv = 1 } = req.query;
    const opts = {
      maxLegs: parseInt(maxLegs, 10),
      minConfidence: parseInt(minConfidence, 10),
      minEv: parseFloat(minEv),
    };

    let allRows = [];
    if (league) {
      const sportKey = sportKeyFor(league);
      if (!sportKey) {
        return res.status(404).json({ error: `Liga no soportada: ${league}` });
      }
      const events = await fetchOddsForSport(sportKey);
      allRows = analyzeEvents(events);
    } else {
      // Agregar todas las ligas
      for (const sportKey of SUPPORTED_SPORTS) {
        try {
          const events = await fetchOddsForSport(sportKey);
          allRows.push(...analyzeEvents(events));
        } catch (err) {
          console.warn(`[parlay/optimize] ${sportKey}: ${err.message}`);
        }
      }
    }

    const result = findBestParlay(allRows, opts);
    res.json({
      league: league || 'ALL',
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[/api/parlay/optimize]', err.message);
    res.status(500).json({ error: 'No se pudo optimizar parlay', detail: err.message });
  }
});

// GET /api/providers → estado de todos los providers activos
app.get('/api/providers', (_req, res) => {
  res.json({
    active: listActiveProviders ? listActiveProviders() : [],
    preference: config.providerPreference,
    therundownConfigured: !!config.therundownApiKey,
  });
});

app.post('/api/cache/clear', (_req, res) => {
  clearCache();
  res.json({ ok: true, message: 'Cache vaciada' });
});

app.get('/api/quota', (_req, res) => {
  res.json({ quota, demoMode: config.demoMode });
});

// --- Job periódico de snapshot ---
async function snapshotJob() {
  console.log(`[snapshotJob] Iniciando para ${SUPPORTED_SPORTS.length} ligas...`);
  for (const sportKey of SUPPORTED_SPORTS) {
    try {
      const events = await fetchOddsForSport(sportKey);
      if (events.length) {
        saveSnapshot(sportKey, events);
        console.log(`  ${sportKey}: ${events.length} eventos → snapshot guardado`);
      }
    } catch (err) {
      console.warn(`  ${sportKey}: ERROR ${err.message}`);
    }
  }
  const purged = purgeOld(7);
  if (purged) console.log(`[snapshotJob] Purgados ${purged} directorios antiguos.`);
}

// --- Arranque ---
const errors = validateConfig();
if (errors.length) {
  console.error('❌ Errores de configuración:');
  errors.forEach(e => console.error('   - ' + e));
  console.error('\nConsulta backend/.env.example para más información.');
  if (!config.demoMode) {
    console.error('Para desarrollo sin API key, usa DEMO_MODE=true');
    process.exit(1);
  }
}

app.listen(PORT, () => {
  console.log('═'.repeat(60));
  console.log(`  Smart Money Backend escuchando en http://localhost:${PORT}`);
  console.log(`  Modo: ${config.demoMode ? 'DEMO (datos sintéticos)' : 'LIVE (The Odds API)'}`);
  console.log(`  Región: ${config.oddsApiRegion} · Cuota restante: ${quota.remaining}`);
  console.log(`  Cache TTL: ${config.cacheTtl}s · Snapshot interval: ${config.snapshotInterval}s`);
  console.log(`  Bookmakers sharp: ${config.BOOKIES_SHARP.join(', ')}`);
  console.log(`  Bookmakers público: ${config.BOOKIES_PUBLIC.join(', ')}`);
  console.log('═'.repeat(60));
  console.log('Endpoints principales:');
  console.log(`  GET  /health`);
  console.log(`  GET  /api/sports`);
  console.log(`  GET  /api/leagues`);
  console.log(`  GET  /api/smart-money               (todas las ligas)`);
  console.log(`  GET  /api/smart-money/:league        (liga concreta)`);
  console.log(`  GET  /api/odds/:sportKey             (cuotas raw)`);
  console.log(`  GET  /api/odds/:sportKey/sm          (cuotas + smart money)`);
  console.log(`  GET  /api/historical/:sportKey       (snapshot previo)`);
  console.log(`  POST /api/cache/clear                (admin)`);
  console.log(`  GET  /api/quota                      (cuota The Odds API)`);
  console.log('═'.repeat(60));

  // Disparar snapshot inicial (si no demo)
  if (!config.demoMode) {
    console.log('[startup] Disparando snapshot inicial...');
    snapshotJob().catch(err => console.error('Snapshot inicial fallido:', err.message));
    // Programar siguientes
    setInterval(() => {
      snapshotJob().catch(err => console.error('Snapshot periódico fallido:', err.message));
    }, config.snapshotInterval * 1000);
  } else {
    console.log('[startup] DEMO_MODE: no se disparan snapshots periódicos.');
    console.log('         En producción con API key real, se guardaría un snapshot');
    console.log('         cada ' + config.snapshotInterval + 's para detectar RLM/STEAM reales.');
  }
});

export { app };
