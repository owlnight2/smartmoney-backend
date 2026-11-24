// ============================================================
// seed.js — Genera snapshots históricos iniciales en DEMO_MODE
// ============================================================
// Útil para probar RLM/STEAM sin esperar horas al job periódico.
// Genera N snapshots con cuotas ligeramente modificadas para
// simular movimiento de línea.
//
// Ejecutar: node src/seed.js

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { generateDemoEvents } from './demoData.js';
import { SUPPORTED_SPORTS, labelFor } from './leagues.js';
import { saveSnapshot, purgeOld } from './historicalStore.js';

const N_SNAPSHOTS = parseInt(process.argv[2] || '5', 10);

console.log(`Generando ${N_SNAPSHOTS} snapshots por liga (DEMO_MODE=${config.demoMode})...`);

// Aplica pequeñas variaciones deterministas a las cuotas para simular movimiento
function varyPrices(events, seed) {
  const out = JSON.parse(JSON.stringify(events));
  for (const ev of out) {
    for (const bm of ev.bookmakers) {
      for (const m of bm.markets) {
        for (const o of m.outcomes) {
          // Variación ±0.05 según el seed
          const variation = ((seed * 7 + o.price * 100) % 11 - 5) / 100;
          o.price = Math.max(1.01, Math.round((o.price + variation) * 100) / 100);
        }
      }
    }
  }
  return out;
}

let total = 0;
for (const sportKey of SUPPORTED_SPORTS.slice(0, 5)) {  // solo top 5 para no demorar
  for (let i = 0; i < N_SNAPSHOTS; i++) {
    // Genera el primer snapshot
    let events = generateDemoEvents(sportKey, 4);
    if (i > 0) {
      events = varyPrices(events, i);
    }
    // Sobreescribimos el timestamp del snapshot alterando el sistema (workaround para demo)
    const fakeDate = new Date(Date.now() - (N_SNAPSHOTS - i) * 60 * 1000);
    // Para forzar el nombre del fichero, escribimos directamente
    const dir = path.join(config.historicalDir, sportKey, fakeDate.toISOString().slice(0, 10));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, fakeDate.toISOString().slice(11, 16).replace(':', '-') + '.json');
    fs.writeFileSync(file, JSON.stringify({ sportKey, timestamp: fakeDate.toISOString(), events }));
    total++;
  }
  console.log(`  ${sportKey} (${labelFor(sportKey)}): ${N_SNAPSHOTS} snapshots`);
}

console.log(`\nTotal: ${total} snapshots guardados en ${config.historicalDir}`);
console.log('Ahora GET /api/smart-money/:league detectará movimientos de línea.');
