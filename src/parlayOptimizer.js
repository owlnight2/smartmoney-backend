// ============================================================
// parlayOptimizer.js — Optimización de parlays / combinadas
// ============================================================
// Mejoras de acierto para parlays:
//
//   1. analyzeParlay(picks) → { totalOdds, impliedProb, kellyCombined,
//      correlatedRisk, recommendation }
//      Calcula la cuota combinada, probabilidad implícita y Kelly
//      conjunto. Detecta si los picks están correlacionados (riesgo
//      de "todo o nada").
//
//   2. findBestParlay(allRows, maxLegs=4, minConfidence=60)
//      Busca la mejor combinación de N picks de mayor confianza que
//      no estén correlacionados entre sí.
//
//   3. detectCorrelation(pick1, pick2)
//      Heurística: si dos picks son del mismo evento, mismo mercado
//      pero selecciones opuestas → correlación alta (no combinar).
//      Si son del mismo evento y misma selección → redundancia.
//      Si son de la misma liga/jornada → correlación media.
//
//   4. kellyCombined(picks)
//      Kelly para parlays: calcula la fracción óptima del bankroll
//      considerando la cuota combinada y la probabilidad conjunta.

// Probabilidad implícita de una cuota decimal (sin vig)
function impliedProb(decimalOdds) {
  return decimalOdds > 1 ? 1 / decimalOdds : 0;
}

// Cuota combinada de un parlay (multiplicativa)
function combinedOdds(picks) {
  return picks.reduce((acc, p) => acc * (p.publicOdds || p.odds || 1), 1);
}

// Detecta correlación entre dos picks (0 = independientes, 1 = idénticos, -1 = opuestos)
export function detectCorrelation(pick1, pick2) {
  // Mismo evento
  if (pick1.eventId === pick2.eventId) {
    if (pick1.market === pick2.market && pick1.selection === pick2.selection) {
      return 1.0; // idéntico (redundante)
    }
    if (pick1.market === pick2.market && pick1.selection !== pick2.selection) {
      // Mismo mercado, selección opuesta: Over vs Under, Home vs Away, etc.
      return -1.0; // opuestos (se anulan)
    }
    // Mismo evento, distinto mercado: ej. ML + Over del mismo partido
    return 0.5; // correlación media (el resultado del partido afecta a ambos)
  }
  // Misma liga, misma jornada (proximidad temporal y de liga)
  if (pick1.sportKey === pick2.sportKey) {
    const t1 = new Date(pick1.commenceTime || 0).getTime();
    const t2 = new Date(pick2.commenceTime || 0).getTime();
    if (Math.abs(t1 - t2) < 24 * 3600 * 1000) {
      return 0.2; // misma jornada → leve correlación
    }
  }
  return 0; // independientes
}

// Kelly para un parlay completo
export function kellyCombined(picks) {
  if (!picks.length) return 0;
  const odds = combinedOdds(picks);
  // Probabilidad conjunta: producto de p_sharp de cada pick (asumiendo independencia)
  // Si hay correlación, esto es optimista; lo penalizamos después.
  const jointProb = picks.reduce((acc, p) => acc * (p.sharpPct / 100), 1);
  if (jointProb <= 0 || odds <= 1) return 0;
  const b = odds - 1;
  const q = 1 - jointProb;
  const kellyFull = (b * jointProb - q) / b;
  // Quarter Kelly para reducir varianza en parlays
  return Math.max(0, kellyFull * 0.25);
}

// Analiza un parlay concreto
export function analyzeParlay(picks) {
  if (!picks.length) {
    return { totalOdds: 1, impliedProb: 1, kelly: 0, correlatedRisk: 0, recommendation: 'EMPTY' };
  }

  const totalOdds = combinedOdds(picks);
  const jointProb = picks.reduce((acc, p) => acc * (p.sharpPct / 100), 1);
  const kelly = kellyCombined(picks);

  // Detección de correlaciones: matriz pairwise
  let maxCorr = 0;
  let negativeCorr = 0;
  const correlations = [];
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const c = detectCorrelation(picks[i], picks[j]);
      correlations.push({ i, j, correlation: c });
      if (c > maxCorr) maxCorr = c;
      if (c < negativeCorr) negativeCorr = c;
    }
  }

  // EV del parlay
  const ev = jointProb * (totalOdds - 1) - (1 - jointProb);
  const evPct = +(ev * 100).toFixed(2);

  // Riesgo correlacionado: si hay correlación negativa (opuestos) el parlay se anula
  let correlatedRisk = 0;
  if (negativeCorr < -0.5) correlatedRisk = 100; // anulación casi segura
  else if (maxCorr > 0.7) correlatedRisk = 70; // redundancia alta
  else if (maxCorr > 0.3) correlatedRisk = 40; // correlación media

  // Penalización a la probabilidad conjunta si hay correlación media
  let adjustedJointProb = jointProb;
  if (maxCorr > 0.3 && maxCorr < 0.9) {
    // Si dos picks están correlacionados positivamente (mismo evento, mismo lado),
    // la varianza real es mayor que la independencia sugiere. Ajustamos hacia abajo.
    adjustedJointProb = jointProb * (1 - maxCorr * 0.3);
  }

  // Recomendación
  let recommendation;
  if (negativeCorr < -0.5) {
    recommendation = 'REJECT'; // picks contradictorios
  } else if (correlatedRisk > 60) {
    recommendation = 'AVOID'; // redundancia alta
  } else if (evPct >= 5 && kelly >= 0.005 && picks.length <= 4) {
    recommendation = 'STRONG_BUY';
  } else if (evPct >= 2 && kelly >= 0.002) {
    recommendation = 'BUY';
  } else if (evPct >= 0) {
    recommendation = 'HOLD';
  } else {
    recommendation = 'AVOID';
  }

  return {
    legs: picks.length,
    totalOdds: +totalOdds.toFixed(2),
    jointProb: +adjustedJointProb.toFixed(4),
    evPct,
    kelly: +kelly.toFixed(4),
    kellyPct: +(kelly * 100).toFixed(2),
    correlatedRisk,
    maxCorrelation: +maxCorr.toFixed(2),
    correlations,
    recommendation,
    picks: picks.map(p => ({
      eventId: p.eventId,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      market: p.market,
      selection: p.selection,
      odds: p.publicOdds,
      sharpPct: p.sharpPct,
      confidence: p.confidence,
      verdict: p.verdict,
    })),
  };
}

// Busca la mejor combinación de N picks para un parlay
export function findBestParlay(allRows, { maxLegs = 4, minConfidence = 60, minEv = 1 } = {}) {
  // Filtrar picks que merecen estar en un parlay
  const candidates = allRows.filter(r =>
    r.confidence >= minConfidence &&
    r.evPct >= minEv &&
    r.verdict !== 'AVOID' &&
    r.publicOdds > 1
  );

  if (candidates.length < 2) {
    return { found: false, reason: 'No hay suficientes picks con confianza mínima', candidates: candidates.length };
  }

  // Ordenar por confianza descendente
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Tomar top 8 candidatos y buscar la mejor combinación de hasta maxLegs
  const top = candidates.slice(0, 8);
  const best = { parlay: null, score: -Infinity };

  // Búsqueda greedy: añadir picks mientras mejore el score
  // Score = evPct + kellyPct - correlatedRisk*0.5
  function tryCombinations(current, startIdx, legsLeft) {
    if (legsLeft === 0 || startIdx >= top.length) {
      if (current.length >= 2) {
        const analysis = analyzeParlay(current);
        const score = analysis.evPct + analysis.kellyPct - analysis.correlatedRisk * 0.5;
        if (score > best.score && analysis.recommendation !== 'REJECT') {
          best.score = score;
          best.parlay = analysis;
        }
      }
      return;
    }
    for (let i = startIdx; i < top.length; i++) {
      // Saltar picks correlacionados negativamente con los ya en current
      const conflict = current.some(p => detectCorrelation(p, top[i]) < -0.5);
      if (conflict) continue;
      current.push(top[i]);
      tryCombinations(current, i + 1, legsLeft - 1);
      current.pop();
    }
    // Probar también sin añadir más
    if (current.length >= 2) {
      tryCombinations(current, top.length, 0);
    }
  }

  tryCombinations([], 0, maxLegs);

  if (!best.parlay) {
    return { found: false, reason: 'No se encontró combinación sin conflictos', candidates: candidates.length };
  }

  return { found: true, parlay: best.parlay, candidates: candidates.length };
}
