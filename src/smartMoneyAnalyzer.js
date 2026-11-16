// ============================================================
// smartMoneyAnalyzer.js — Agregador de indicadores Smart Money
// ============================================================
// A partir de cuotas reales de múltiples casas de apuestas,
// calcula los mismos indicadores que muestran Pinnacle / Circa /
// Sports Insights:
//
//   - sharpPct:  % del dinero (en $) en cada lado desde bookies sharp
//   - ticketPct: % de boletas (en cantidad) en cada lado desde todos los bookies
//   - edge:      prob_modelo − prob_implícita (vs cuota pública media)
//   - rlm:       bandera Reverse Line Movement
//   - steam:     bandera movimiento coordinado
//
// Diferencia clave vs el módulo frontend `SmartMoney` (determinista):
// aquí usamos cuotas REALES de casas reales, así que:
//   - El "modelo" es la cuota media de los bookies sharp (pinnacle/circa)
//   - El "mercado" es la cuota media de los bookies públicos (draftkings/fanduel/...)
//   - Edge = p_sharp − p_public (cuándo los sharps ven más valor que el público)
//   - RLM = la línea pública se movió en contra del lado público
//   - STEAM = varios bookies sharps movieron la cuota en la misma dirección

import { config } from './config.js';

const SHARP_BOOKS = new Set(config.BOOKIES_SHARP);
const PUBLIC_BOOKS = new Set(config.BOOKIES_PUBLIC);
const EXCHANGE_BOOKS = new Set(config.BOOKIES_EXCHANGE || []);

// Implied probability sin vig normalizada dentro de un mercado
function impliedProbNoVig(outcomes) {
  const inv = outcomes.map(o => o.price > 1 ? 1 / o.price : 0);
  const sum = inv.reduce((a, b) => a + b, 0);
  if (sum <= 0) return outcomes.map(() => 0);
  return inv.map(v => v / sum);
}

// Promedia cuotas de un conjunto de bookmakers para un mercado dado.
// Devuelve { outcomes: [{name, price, point}], sources: [bookKeys] }
function averageMarket(events, bookKeys, marketKey) {
  const collected = {}; // name → [{ price, point }]
  let sources = [];
  for (const ev of events) {
    for (const bm of (ev.bookmakers || [])) {
      if (bookKeys.length && !bookKeys.includes(bm.key)) continue;
      sources.push(bm.key);
      for (const m of (bm.markets || [])) {
        if (m.key !== marketKey) continue;
        for (const o of (m.outcomes || [])) {
          if (!collected[o.name]) collected[o.name] = [];
          collected[o.name].push({ price: o.price, point: o.point });
        }
      }
    }
  }
  sources = [...new Set(sources)];
  const outcomes = Object.keys(collected).map(name => {
    const arr = collected[name];
    const avgPrice = arr.reduce((s, x) => s + x.price, 0) / arr.length;
    const points = arr.map(x => x.point).filter(p => p != null);
    const avgPoint = points.length ? points.reduce((s, x) => s + x, 0) / points.length : null;
    return { name, price: Math.round(avgPrice * 100) / 100, point: avgPoint };
  });
  return { outcomes, sources };
}

// Para un evento individual, calcula el smart money por mercado.
// Devuelve array de { market, selection, sharpPct, ticketPct, edge, rlm, steam, verdict }
export function analyzeEvent(event) {
  const bookmakers = event.bookmakers || [];
  // Sharp = sharps tradicionales (Pinnacle/BetOnline) + exchanges (Betfair/Matchbook)
  // Los exchanges tienen cuotas sin margen, así que son la referencia más eficiente.
  const sharpKeys = bookmakers.filter(b => SHARP_BOOKS.has(b.key) || EXCHANGE_BOOKS.has(b.key)).map(b => b.key);
  const publicKeys = bookmakers.filter(b => PUBLIC_BOOKS.has(b.key)).map(b => b.key);
  const allKeys = bookmakers.map(b => b.key);

  // Si no hay bookmakers sharp identificados, usamos todos (con disclaimer)
  const effectiveSharpKeys = sharpKeys.length ? sharpKeys : allKeys.slice(0, 1);
  const effectivePublicKeys = publicKeys.length ? publicKeys : allKeys;

  const markets = new Set();
  bookmakers.forEach(bm => (bm.markets || []).forEach(m => markets.add(m.key)));

  const rows = [];
  for (const marketKey of markets) {
    const sharpMkt = averageMarket([event], effectiveSharpKeys, marketKey);
    const publicMkt = averageMarket([event], effectivePublicKeys, marketKey);
    if (!sharpMkt.outcomes.length || !publicMkt.outcomes.length) continue;

    const sharpProbs = impliedProbNoVig(sharpMkt.outcomes);
    const publicProbs = impliedProbNoVig(publicMkt.outcomes);

    // Ticket %: cuántas casas tienen cada selección como la de menor cuota
    // (proxy de dónde carga el público): para cada selección, contamos
    // cuántos bookies la tienen con la cuota más baja del mercado.
    const ticketCounts = {};
    sharpMkt.outcomes.forEach(o => { ticketCounts[o.name] = 0; });
    for (const bm of bookmakers) {
      const m = (bm.markets || []).find(x => x.key === marketKey);
      if (!m || !m.outcomes.length) continue;
      const minPrice = Math.min(...m.outcomes.map(o => o.price));
      for (const o of m.outcomes) {
        if (o.price === minPrice) ticketCounts[o.name] = (ticketCounts[o.name] || 0) + 1;
      }
    }
    const totalTickets = Object.values(ticketCounts).reduce((a, b) => a + b, 0) || 1;

    sharpMkt.outcomes.forEach((sel, i) => {
      const pSharp = sharpProbs[i] || 0;
      const pPublic = publicProbs[i] || 0;
      const edge = pSharp - pPublic;
      const sharpPct = Math.round(pSharp * 100);
      const ticketPct = Math.round((ticketCounts[sel.name] / totalTickets) * 100);

      // RLM: el público carga la selección (ticket% alto) pero los sharps
      // le dan probabilidad más baja que el público → línea se mueve en contra
      const rlm = ticketPct > 55 && pSharp < pPublic - 0.02;
      // STEAM: los sharps concentran dinero (sharp% alto y varias casas)
      const steam = sharpPct > 60 && effectiveSharpKeys.length >= 2;

      let verdict, verdictClass;
      if (edge > 0.02 && (steam || rlm)) {
        verdict = 'BUY'; verdictClass = 'green';
      } else if (edge > 0.01 && sharpPct > 55) {
        verdict = 'WATCH'; verdictClass = 'amber';
      } else if (edge < -0.05 || sharpPct < 25) {
        verdict = 'AVOID'; verdictClass = 'red';
      } else {
        verdict = 'HOLD'; verdictClass = 'muted';
      }

      rows.push({
        market: marketKey,
        selection: sel.name,
        point: sel.point,
        sharpOdds: sharpMkt.outcomes[i].price,
        publicOdds: publicMkt.outcomes[i].price,
        sharpPct,
        ticketPct,
        edgePct: +(edge * 100).toFixed(1),
        rlm,
        steam,
        verdict,
        verdictClass,
        sharpSources: effectiveSharpKeys,
        publicSources: effectivePublicKeys,
      });
    });
  }
  return rows;
}

// Procesa un array de eventos y devuelve un array aplanado de selecciones
// con todos los indicadores + metadatos del evento.
export function analyzeEvents(events) {
  const allRows = [];
  for (const ev of events) {
    const rows = analyzeEvent(ev);
    for (const r of rows) {
      allRows.push({
        eventId: ev.id,
        sportKey: ev.sport_key,
        sportTitle: ev.sport_title,
        homeTeam: ev.home_team,
        awayTeam: ev.away_team,
        commenceTime: ev.commence_time,
        ...r,
      });
    }
  }
  // Ordenar por edge descendente
  allRows.sort((a, b) => b.edgePct - a.edgePct);
  return allRows;
}
