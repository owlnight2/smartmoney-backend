// ============================================================
// historicalStore.js — Persistencia de snapshots de cuotas
// ============================================================
// Para detectar RLM/STEAM necesitamos comparar la cuota actual con
// una cuota anterior. Este módulo guarda snapshots en disco
// (./data/historical/{sportKey}/{YYYY-MM-DD}/{HH-mm}.json) y los
// recupera para comparación.
//
// Snapshot = respuesta cruda de The Odds API en un instante T.
// Para no ocupar demasiado disco, solo guardamos los últimos 7 días
// (se purga automáticamente al cargar).

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const HIST_DIR = config.historicalDir;

// Asegura que el directorio existe
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Devuelve la ruta del snapshot actual
function snapshotPath(sportKey, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const time = date.toISOString().slice(11, 16).replace(':', '-');
  return path.join(HIST_DIR, sportKey, day, `${time}.json`);
}

// Guarda un snapshot
export function saveSnapshot(sportKey, events) {
  try {
    const p = snapshotPath(sportKey);
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify({
      sportKey,
      timestamp: new Date().toISOString(),
      events,
    }));
    return p;
  } catch (err) {
    console.warn(`[historical] No se pudo guardar snapshot de ${sportKey}:`, err.message);
    return null;
  }
}

// Devuelve el snapshot más reciente anterior a `beforeTime` (o null si no hay)
export function getPreviousSnapshot(sportKey, beforeTime = new Date()) {
  try {
    const sportDir = path.join(HIST_DIR, sportKey);
    if (!fs.existsSync(sportDir)) return null;
    const days = fs.readdirSync(sportDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
    for (const day of days) {
      const dayDir = path.join(sportDir, day);
      const files = fs.readdirSync(dayDir).filter(f => /^\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
      for (const f of files) {
        const p = path.join(dayDir, f);
        const stat = fs.statSync(p);
        if (stat.mtime < beforeTime) {
          return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
      }
    }
    return null;
  } catch (err) {
    console.warn(`[historical] No se pudo leer snapshot previo de ${sportKey}:`, err.message);
    return null;
  }
}

// Purga snapshots antiguos (más de N días)
export function purgeOld(days = 7) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  let removed = 0;
  try {
    if (!fs.existsSync(HIST_DIR)) return removed;
    for (const sportDir of fs.readdirSync(HIST_DIR)) {
      const sp = path.join(HIST_DIR, sportDir);
      if (!fs.statSync(sp).isDirectory()) continue;
      for (const day of fs.readdirSync(sp)) {
        const dayDir = path.join(sp, day);
        if (!fs.statSync(dayDir).isDirectory()) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const dayDate = new Date(day + 'T00:00:00Z').getTime();
        if (dayDate < cutoff) {
          fs.rmSync(dayDir, { recursive: true, force: true });
          removed++;
        }
      }
    }
  } catch (err) {
    console.warn('[historical] purgeOld:', err.message);
  }
  return removed;
}

// Compara dos snapshots y detecta movimientos de línea.
// Devuelve { eventId: { marketKey: { selectionName: { oldPrice, newPrice, delta } } } }
export function diffSnapshots(prev, curr) {
  const diff = {};
  if (!prev || !curr) return diff;
  const prevByEvent = {};
  for (const ev of (prev.events || [])) prevByEvent[ev.id] = ev;
  for (const ev of (curr.events || [])) {
    const pe = prevByEvent[ev.id];
    if (!pe) continue;
    const prevByBmMarket = {};
    for (const bm of (pe.bookmakers || [])) {
      for (const m of (bm.markets || [])) {
        const key = `${bm.key}:${m.key}`;
        prevByBmMarket[key] = m.outcomes;
      }
    }
    for (const bm of (ev.bookmakers || [])) {
      for (const m of (bm.markets || [])) {
        const key = `${bm.key}:${m.key}`;
        const prevOutcomes = prevByBmMarket[key];
        if (!prevOutcomes) continue;
        for (const o of (m.outcomes || [])) {
          const prevO = prevOutcomes.find(x => x.name === o.name);
          if (!prevO || prevO.price === o.price) continue;
          if (!diff[ev.id]) diff[ev.id] = {};
          if (!diff[ev.id][m.key]) diff[ev.id][m.key] = {};
          if (!diff[ev.id][m.key][o.name]) diff[ev.id][m.key][o.name] = {};
          diff[ev.id][m.key][o.name][bm.key] = {
            oldPrice: prevO.price,
            newPrice: o.price,
            delta: +(o.price - prevO.price).toFixed(3),
          };
        }
      }
    }
  }
  return diff;
}
