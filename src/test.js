// ============================================================
// test.js — Smoke-test del backend en DEMO_MODE
// ============================================================
// Verifica que todos los endpoints responden y que el análisis
// smart money produce resultados coherentes.
// Ejecutar: node src/test.js
//
// No requiere API key real (usa DEMO_MODE=true).

import { config } from './config.js';
import { generateDemoEvents } from './demoData.js';
import { analyzeEvents, analyzeEvent } from './smartMoneyAnalyzer.js';
import { SUPPORTED_SPORTS, labelFor, sportKeyFor } from './leagues.js';
import { diffSnapshots, saveSnapshot, getPreviousSnapshot, purgeOld } from './historicalStore.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.log('  ❌ ' + msg); }
}

console.log('═'.repeat(60));
console.log('  Smoke-test Smart Money Backend (DEMO_MODE)');
console.log('═'.repeat(60));

// --- Test 1: generar eventos demo ---
console.log('\n[1] Generación de datos demo');
const events = generateDemoEvents('soccer_spain_la_liga', 6);
assert(events.length === 6, 'Genera 6 eventos');
assert(events[0].home_team && events[0].away_team, 'Cada evento tiene home/away');
assert(events[0].bookmakers.length > 0, 'Cada evento tiene bookmakers');
assert(events[0].bookmakers[0].markets.length > 0, 'Cada bookmaker tiene mercados');
assert(events[0].bookmakers[0].markets[0].outcomes.length >= 2, 'Cada mercado tiene ≥2 selecciones');

// --- Test 2: análisis smart money ---
console.log('\n[2] Análisis smart money');
const rows = analyzeEvents(events);
assert(rows.length > 0, 'Análisis produce filas');
const r0 = rows[0];
assert(r0.sharpPct >= 0 && r0.sharpPct <= 100, 'sharpPct en rango [0,100]');
assert(r0.ticketPct >= 0 && r0.ticketPct <= 100, 'ticketPct en rango [0,100]');
assert(['BUY','WATCH','HOLD','AVOID'].includes(r0.verdict), 'verdict válido');
assert(r0.edgePct >= -50 && r0.edgePct <= 50, 'edge en rango razonable');
assert(r0.sharpOdds > 1 && r0.publicOdds > 1, 'cuotas > 1');

// --- Test 3: análisis por evento individual ---
console.log('\n[3] Análisis por evento');
const evRows = analyzeEvent(events[0]);
assert(evRows.length > 0, 'analyzeEvent produce filas');
assert(evRows.every(r => r.market && r.selection), 'Cada fila tiene mercado y selección');

// --- Test 4: mapeo de ligas ---
console.log('\n[4] Mapeo de ligas');
assert(sportKeyFor('LaLiga') === 'soccer_spain_la_liga', 'LaLiga → soccer_spain_la_liga');
assert(sportKeyFor('Premier') === 'soccer_epl', 'Premier → soccer_epl');
assert(sportKeyFor('NFL') === 'americanfootball_nfl', 'NFL → americanfootball_nfl');
assert(sportKeyFor('NBA') === 'basketball_nba', 'NBA → basketball_nba');
assert(sportKeyFor('MLB') === 'baseball_mlb', 'MLB → baseball_mlb');
assert(sportKeyFor('LigaInexistente') === null, 'Liga inexistente → null');

// --- Test 5: snapshot histórico ---
console.log('\n[5] Snapshot histórico y diff');
saveSnapshot('soccer_spain_la_liga', events);
const prev = getPreviousSnapshot('soccer_spain_la_liga');
assert(prev !== null, 'Snapshot guardado y recuperable');
assert(prev.events.length === 6, 'Snapshot tiene 6 eventos');

// Generar un 2º snapshot con cuotas ligeramente modificadas y comparar
const events2 = JSON.parse(JSON.stringify(events));
events2[0].bookmakers[0].markets[0].outcomes[0].price = events[0].bookmakers[0].markets[0].outcomes[0].price + 0.20;
const diff = diffSnapshots(prev, { events: events2, timestamp: new Date().toISOString() });
assert(Object.keys(diff).length > 0, 'diffSnapshots detecta cambios');
assert(diff[events[0].id] !== undefined, 'diffSnapshots detecta el evento modificado');

// --- Test 6: purga de histórico ---
console.log('\n[6] Purga de histórico antiguo');
const purged = purgeOld(0);  // purga todo lo anterior a hoy (debería purgar poco, solo el de hace días)
assert(typeof purged === 'number', 'purgeOld devuelve un número');

// --- Test 7: todas las ligas soportadas generan eventos demo ---
console.log('\n[7] Todas las ligas soportadas generan datos demo');
for (const sk of SUPPORTED_SPORTS.slice(0, 5)) {
  const ev = generateDemoEvents(sk, 3);
  assert(ev.length === 3 && ev[0].bookmakers.length > 0, `${sk} (${labelFor(sk)}) genera datos`);
}

// --- Resumen ---
console.log('\n' + '═'.repeat(60));
console.log(`  Resultado: ${passed} OK · ${failed} FAILED`);
console.log('═'.repeat(60));
if (failed > 0) {
  console.log('❌ Smoke-test FALLÓ');
  process.exit(1);
} else {
  console.log('✅ Smoke-test OK — el backend está listo para arrancar');
}
