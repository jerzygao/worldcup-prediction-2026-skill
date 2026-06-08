#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanOdds } from "./clean-odds.mjs";

const FEATURE_KEYS = ["odds", "elo", "fifaPoints", "marketValue", "recentForm"];

function parseArgs(argv) {
  const args = { iterations: "2000", output: "output/weight-search-results.json" };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] ?? "true";
      i += 1;
    }
  }
  return args;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function normalizeWeights(weights) {
  const total = FEATURE_KEYS.reduce((sum, key) => sum + weights[key], 0);
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, weights[key] / total]));
}

function randomWeights() {
  return normalizeWeights({
    odds: 0.25 + Math.random() * 0.25,
    elo: 0.12 + Math.random() * 0.25,
    fifaPoints: 0.03 + Math.random() * 0.14,
    marketValue: 0.03 + Math.random() * 0.15,
    recentForm: 0.05 + Math.random() * 0.20
  });
}

function modelSignal(features) {
  return {
    elo: sigmoid(features.eloDiff / 420),
    fifaPoints: sigmoid(features.fifaPointsDiff / 280),
    marketValue: sigmoid(features.marketValueLogRatio),
    recentForm: sigmoid(features.recentFormDiff * 2.2)
  };
}

function predict(row, weights) {
  const market = cleanOdds(row.odds);
  const signal = modelSignal(row.features);

  const homeLean =
    weights.odds * market.home +
    weights.elo * signal.elo +
    weights.fifaPoints * signal.fifaPoints +
    weights.marketValue * signal.marketValue +
    weights.recentForm * signal.recentForm;

  const awayLean =
    weights.odds * market.away +
    weights.elo * (1 - signal.elo) +
    weights.fifaPoints * (1 - signal.fifaPoints) +
    weights.marketValue * (1 - signal.marketValue) +
    weights.recentForm * (1 - signal.recentForm);

  const balance = 1 - Math.abs(homeLean - awayLean);
  const drawBase = weights.odds * market.draw + 0.26 * (1 - weights.odds);
  const draw = clamp(drawBase * (0.75 + 0.5 * balance), 0.12, 0.34);
  const remaining = 1 - draw;
  const sideTotal = homeLean + awayLean || 1;

  return {
    H: (homeLean / sideTotal) * remaining,
    D: draw,
    A: (awayLean / sideTotal) * remaining
  };
}

function logLoss(rows, weights) {
  const eps = 1e-12;
  return rows.reduce((sum, row) => {
    const probs = predict(row, weights);
    return sum - Math.log(Math.max(eps, probs[row.actual]));
  }, 0) / rows.length;
}

function brierScore(rows, weights) {
  return rows.reduce((sum, row) => {
    const probs = predict(row, weights);
    return sum + ["H", "D", "A"].reduce((s, key) => {
      const target = row.actual === key ? 1 : 0;
      return s + (probs[key] - target) ** 2;
    }, 0);
  }, 0) / rows.length;
}

function accuracy(rows, weights) {
  let correct = 0;
  for (const row of rows) {
    const probs = predict(row, weights);
    const pick = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
    if (pick === row.actual) correct += 1;
  }
  return correct / rows.length;
}

function predictedScore(probs) {
  if (probs.D >= probs.H && probs.D >= probs.A) return "1-1";
  if (probs.H > probs.A) return probs.H > 0.62 ? "2-0" : "2-1";
  return probs.A > 0.62 ? "0-2" : "1-2";
}

function confidence(probs) {
  const sorted = Object.values(probs).sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];
  if (gap >= 0.22) return "high";
  if (gap >= 0.10) return "medium";
  return "low";
}

function upsetRisk(row, probs) {
  const market = cleanOdds(row.odds);
  const favoriteProb = Math.max(market.home, market.away);
  const modelFavoriteProb = Math.max(probs.H, probs.A);
  if (favoriteProb > 0.58 && modelFavoriteProb < 0.50) return "high";
  if (favoriteProb > 0.52 && modelFavoriteProb < 0.56) return "medium";
  return "low";
}

function validateRows(rows) {
  for (const row of rows) {
    for (const key of ["matchId", "actual", "odds", "features"]) {
      if (!(key in row)) throw new Error(`Missing ${key} in ${row.matchId ?? "unknown row"}`);
    }
    if (!["H", "D", "A"].includes(row.actual)) throw new Error(`Invalid actual in ${row.matchId}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.data) {
    console.error("Usage: node scripts/weight-search.mjs --data data/sample/matches.json --iterations 2000");
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(args.data, "utf8"));
  validateRows(rows);

  let best = null;
  const iterations = Number(args.iterations);
  for (let i = 0; i < iterations; i += 1) {
    const weights = randomWeights();
    const score = logLoss(rows, weights);
    if (!best || score < best.logLoss) {
      best = {
        weights,
        logLoss: score,
        brierScore: brierScore(rows, weights),
        accuracy: accuracy(rows, weights)
      };
    }
  }

  const predictions = rows.map((row) => {
    const probs = predict(row, best.weights);
    return {
      matchId: row.matchId,
      match: `${row.homeTeam} vs ${row.awayTeam}`,
      homeWin: Number(probs.H.toFixed(4)),
      draw: Number(probs.D.toFixed(4)),
      awayWin: Number(probs.A.toFixed(4)),
      predictedScore: predictedScore(probs),
      confidence: confidence(probs),
      upsetRisk: upsetRisk(row, probs),
      actual: row.actual
    };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    dataFile: args.data,
    rows: rows.length,
    iterations,
    best,
    predictions
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
