#!/usr/bin/env node
import fs from "node:fs";
import { cleanOdds } from "./clean-odds.mjs";

const BASE_WEIGHTS = {
  odds: 0.35,
  elo: 0.25,
  recentForm: 0.15,
  fifa: 0.10,
  squadRating: 0.08,
  marketValue: 0.07
};

const DEFAULT_MODEL = "config/calibrated-model.json";

function parseArgs(argv) {
  const args = {
    teams: "data/processed/team-current.json",
    neutral: "true",
    model: DEFAULT_MODEL,
    tendencies: "data/processed/team-tendencies.csv"
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] ?? "true";
      i += 1;
    }
  }
  return args;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
  });
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(num) ? num : null;
}

function normalizeName(name) {
  return String(name ?? "").trim().toLowerCase();
}

function findTeam(teams, name) {
  const normalized = normalizeName(name);
  const exact = teams.find((team) => normalizeName(team.team) === normalized);
  if (exact) return exact;

  const contains = teams.filter((team) => normalizeName(team.team).includes(normalized));
  if (contains.length === 1) return contains[0];

  const prefix = teams.filter((team) => normalizeName(team.team).startsWith(normalized));
  if (prefix.length === 1) return prefix[0];

  const suggestions = teams
    .filter((team) => normalizeName(team.team).includes(normalized.slice(0, 4)))
    .slice(0, 8)
    .map((team) => team.team);

  throw new Error(`Team not found or ambiguous: ${name}${suggestions.length ? `. Suggestions: ${suggestions.join(", ")}` : ""}`);
}

function findStrength(rows, name) {
  const normalized = normalizeName(name);
  const row = rows.find((item) => normalizeName(item.team) === normalized);
  if (!row) return null;
  return {
    team: row.team,
    fifaRank: toNumber(row.fifaRank),
    fifaPoints: toNumber(row.fifaPoints),
    squadRating: toNumber(row.squadRating),
    marketValueEur: toNumber(row.marketValueEur),
    marketValueSource: row.marketValueSource || row.source || "",
    ratingSource: row.ratingSource || row.source || "",
    updatedAt: row.updatedAt || ""
  };
}

function findTendency(rows, name) {
  const normalized = normalizeName(name);
  const row = rows.find((item) => normalizeName(item.team) === normalized);
  if (!row) return null;
  return {
    team: row.team,
    winRate: toNumber(row.winRate),
    drawRate: toNumber(row.drawRate),
    goalDiffPerMatch: toNumber(row.goalDiffPerMatch),
    matches: toNumber(row.matches)
  };
}

function findProfile(rows, name) {
  const normalized = normalizeName(name);
  const row = rows.find((item) => normalizeName(item.team) === normalized);
  if (!row) return null;
  return {
    team: row.team,
    styleTags: String(row.styleTags || "").split("|").filter(Boolean),
    attackRating: toNumber(row.attackRating),
    midfieldRating: toNumber(row.midfieldRating),
    defenseRating: toNumber(row.defenseRating),
    transitionRating: toNumber(row.transitionRating),
    setPieceRating: toNumber(row.setPieceRating),
    squadTier: row.squadTier || "",
    strengths: String(row.strengths || "").split("|").filter(Boolean),
    weaknesses: String(row.weaknesses || "").split("|").filter(Boolean),
    playingStyle: row.playingStyle || "",
    keyPlayers: row.keyPlayers || "",
    source: row.source || "",
    updatedAt: row.updatedAt || ""
  };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function normalizeProbs(probs) {
  const total = probs.homeWin + probs.draw + probs.awayWin;
  return {
    homeWin: probs.homeWin / total,
    draw: probs.draw / total,
    awayWin: probs.awayWin / total
  };
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const total = exps.reduce((sum, x) => sum + x, 0);
  return exps.map((x) => x / total);
}

function calibratedBasePredict(home, away, options) {
  const params = options.model?.params;
  if (!params) return null;

  const homeAdvantage = options.neutral ? 0 : 1;
  const elo = (home.elo - away.elo) / 100;
  const hasFifaPoints = Number.isFinite(options.homeStrength?.fifaPoints) && Number.isFinite(options.awayStrength?.fifaPoints);
  const hasFifaRanks = Number.isFinite(options.homeStrength?.fifaRank) && Number.isFinite(options.awayStrength?.fifaRank);
  const fifaMode = hasFifaPoints ? "points" : hasFifaRanks ? "rank" : null;
  const fifaRawDiff = hasFifaPoints
    ? options.homeStrength.fifaPoints - options.awayStrength.fifaPoints
    : hasFifaRanks
      ? options.awayStrength.fifaRank - options.homeStrength.fifaRank
      : null;
  const fifa = hasFifaPoints
    ? fifaRawDiff / 100
    : hasFifaRanks
      ? fifaRawDiff / 25
      : 0;
  const form = home.recentForm.formScore - away.recentForm.formScore;
  const homeTendency = options.homeTendency;
  const awayTendency = options.awayTendency;
  const hasTendency =
    Number.isFinite(homeTendency?.winRate) &&
    Number.isFinite(awayTendency?.winRate) &&
    Number.isFinite(homeTendency?.drawRate) &&
    Number.isFinite(awayTendency?.drawRate) &&
    Number.isFinite(homeTendency?.goalDiffPerMatch) &&
    Number.isFinite(awayTendency?.goalDiffPerMatch);
  const winTendency = hasTendency ? homeTendency.winRate - awayTendency.winRate : 0;
  const gdTendency = hasTendency ? homeTendency.goalDiffPerMatch - awayTendency.goalDiffPerMatch : 0;
  const drawTendency = hasTendency ? (homeTendency.drawRate + awayTendency.drawRate) / 2 - 0.24 : 0;

  const strength =
    params.eloCoef * elo +
    params.fifaCoef * fifa +
    params.formCoef * form +
    params.winTendencyCoef * winTendency +
    params.gdTendencyCoef * gdTendency +
    params.homeCoef * homeAdvantage;
  const drawLogit =
    params.drawBias -
    params.drawEloPenalty * Math.abs(elo) -
    params.drawFifaPenalty * Math.abs(fifa) -
    params.drawFormPenalty * Math.abs(form) +
    params.drawTendencyCoef * drawTendency +
    params.drawNeutralBoost * (options.neutral ? 1 : 0);
  const [homeWin, draw, awayWin] = softmax([strength, drawLogit, -strength]);
  return {
    probabilities: { homeWin, draw, awayWin },
    details: {
      modelVersion: options.model.version,
      eloDiff: Number(((home.elo - away.elo) + (options.neutral ? 0 : 60)).toFixed(2)),
      fifaDiff: fifaRawDiff === null ? null : Number(fifaRawDiff.toFixed(2)),
      fifaMode,
      recentFormDiff: Number(form.toFixed(4)),
      tendencyWinRateDiff: hasTendency ? Number(winTendency.toFixed(4)) : null,
      tendencyDrawRateAvg: hasTendency ? Number((drawTendency + 0.24).toFixed(4)) : null,
      tendencyGoalDiffDiff: hasTendency ? Number(gdTendency.toFixed(4)) : null,
      homeAdvantageApplied: options.neutral ? 0 : 60,
      missingBaseFeatures: [
        ...(fifaMode ? [] : ["fifa"]),
        ...(hasTendency ? [] : ["tendency"])
      ]
    }
  };
}

function availableWeights(features) {
  const active = {};
  for (const [key, weight] of Object.entries(BASE_WEIGHTS)) {
    if (features[key]?.available) active[key] = weight;
  }
  const total = Object.values(active).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(Object.entries(active).map(([key, weight]) => [key, weight / total]));
}

function fifaLean(homeStrength, awayStrength) {
  if (Number.isFinite(homeStrength?.fifaPoints) && Number.isFinite(awayStrength?.fifaPoints)) {
    return {
      available: true,
      lean: sigmoid((homeStrength.fifaPoints - awayStrength.fifaPoints) / 180),
      diff: Number((homeStrength.fifaPoints - awayStrength.fifaPoints).toFixed(2)),
      mode: "points"
    };
  }
  if (Number.isFinite(homeStrength?.fifaRank) && Number.isFinite(awayStrength?.fifaRank)) {
    return {
      available: true,
      lean: sigmoid((awayStrength.fifaRank - homeStrength.fifaRank) / 18),
      diff: Number((awayStrength.fifaRank - homeStrength.fifaRank).toFixed(2)),
      mode: "rank"
    };
  }
  return { available: false };
}

function squadLean(homeStrength, awayStrength) {
  if (Number.isFinite(homeStrength?.squadRating) && Number.isFinite(awayStrength?.squadRating)) {
    return {
      available: true,
      lean: sigmoid((homeStrength.squadRating - awayStrength.squadRating) / 4.5),
      diff: Number((homeStrength.squadRating - awayStrength.squadRating).toFixed(2))
    };
  }
  return { available: false };
}

function marketLean(homeStrength, awayStrength) {
  if (Number.isFinite(homeStrength?.marketValueEur) && Number.isFinite(awayStrength?.marketValueEur) && homeStrength.marketValueEur > 0 && awayStrength.marketValueEur > 0) {
    const logRatio = Math.log(homeStrength.marketValueEur / awayStrength.marketValueEur);
    return {
      available: true,
      lean: sigmoid(logRatio),
      diff: Number(logRatio.toFixed(4)),
      homeMarketValueEur: homeStrength.marketValueEur,
      awayMarketValueEur: awayStrength.marketValueEur
    };
  }
  return { available: false };
}

function oddsLean(odds) {
  if (!odds?.home || !odds?.draw || !odds?.away) return { available: false };
  const cleaned = cleanOdds(odds);
  const sideTotal = cleaned.home + cleaned.away || 1;
  return {
    available: true,
    lean: cleaned.home / sideTotal,
    draw: cleaned.draw,
    cleaned: {
      home: Number(cleaned.home.toFixed(4)),
      draw: Number(cleaned.draw.toFixed(4)),
      away: Number(cleaned.away.toFixed(4)),
      overround: Number(cleaned.overround.toFixed(4))
    }
  };
}

function predict(home, away, options) {
  const calibrated = calibratedBasePredict(home, away, options);
  if (calibrated) {
    const market = oddsLean(options.odds);
    const squad = squadLean(options.homeStrength, options.awayStrength);
    const value = marketLean(options.homeStrength, options.awayStrength);
    const externalWeights = options.model.externalFeatureBlend ?? {};
    const activeExternal = {
      ...(market.available ? { odds: externalWeights.odds ?? 0 } : {}),
      ...(squad.available ? { squadRating: externalWeights.squadRating ?? 0 } : {}),
      ...(value.available ? { marketValue: externalWeights.marketValue ?? 0 } : {})
    };
    const externalTotal = Object.values(activeExternal).reduce((sum, x) => sum + x, 0);
    const baseWeight = Math.max(0.45, 1 - externalTotal);
    const scale = baseWeight + externalTotal;
    let homeLean = calibrated.probabilities.homeWin * baseWeight;
    let draw = calibrated.probabilities.draw * baseWeight;
    let awayLean = calibrated.probabilities.awayWin * baseWeight;
    if (market.available) {
      homeLean += market.cleaned.home * activeExternal.odds;
      draw += market.cleaned.draw * activeExternal.odds;
      awayLean += market.cleaned.away * activeExternal.odds;
    }
    if (squad.available) {
      homeLean += squad.lean * activeExternal.squadRating;
      awayLean += (1 - squad.lean) * activeExternal.squadRating;
    }
    if (value.available) {
      homeLean += value.lean * activeExternal.marketValue;
      awayLean += (1 - value.lean) * activeExternal.marketValue;
    }
    const probs = normalizeProbs({ homeWin: homeLean / scale, draw: draw / scale, awayWin: awayLean / scale });
    return {
      eloDiff: calibrated.details.eloDiff,
      formDiff: calibrated.details.recentFormDiff,
      homeAdvantage: calibrated.details.homeAdvantageApplied,
      activeWeights: {
        calibratedModel: Number(baseWeight.toFixed(4)),
        ...Object.fromEntries(Object.entries(activeExternal).map(([k, v]) => [k, Number(v.toFixed(4))]))
      },
      featureDetails: {
        odds: market,
        elo: { available: true, diff: calibrated.details.eloDiff },
        recentForm: { available: true, diff: calibrated.details.recentFormDiff },
        fifa: calibrated.details.missingBaseFeatures.includes("fifa")
          ? { available: false }
          : { available: true, diff: calibrated.details.fifaDiff, mode: calibrated.details.fifaMode },
        squadRating: squad,
        marketValue: value,
        tendency: calibrated.details.missingBaseFeatures.includes("tendency")
          ? { available: false }
          : {
              available: true,
              winRateDiff: calibrated.details.tendencyWinRateDiff,
              drawRateAvg: calibrated.details.tendencyDrawRateAvg,
              goalDiffDiff: calibrated.details.tendencyGoalDiffDiff
            }
      },
      modelVersion: calibrated.details.modelVersion,
      probabilities: {
        homeWin: Number(probs.homeWin.toFixed(4)),
        draw: Number(probs.draw.toFixed(4)),
        awayWin: Number(probs.awayWin.toFixed(4))
      }
    };
  }

  const homeAdvantage = options.neutral ? 0 : 60;
  const eloDiff = home.elo + homeAdvantage - away.elo;
  const formDiff = home.recentForm.formScore - away.recentForm.formScore;
  const features = {
    odds: oddsLean(options.odds),
    elo: {
      available: true,
      lean: sigmoid(eloDiff / 360),
      diff: Number(eloDiff.toFixed(2))
    },
    recentForm: {
      available: true,
      lean: sigmoid(formDiff * 1.8),
      diff: Number(formDiff.toFixed(4))
    },
    fifa: fifaLean(options.homeStrength, options.awayStrength),
    squadRating: squadLean(options.homeStrength, options.awayStrength),
    marketValue: marketLean(options.homeStrength, options.awayStrength)
  };
  const weights = availableWeights(features);
  const homeLean = Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * features[key].lean, 0);
  const awayLean = 1 - homeLean;
  const balance = 1 - Math.abs(homeLean - awayLean);
  const modelDraw = clamp(0.18 + 0.14 * balance, 0.16, 0.32);
  const draw = features.odds.available
    ? clamp((weights.odds ?? 0) * features.odds.draw + (1 - (weights.odds ?? 0)) * modelDraw, 0.14, 0.36)
    : modelDraw;
  const remaining = 1 - draw;
  const probs = normalizeProbs({
    homeWin: homeLean * remaining,
    draw,
    awayWin: awayLean * remaining
  });
  return {
    eloDiff: Number(eloDiff.toFixed(2)),
    formDiff: Number(formDiff.toFixed(4)),
    homeAdvantage,
    activeWeights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number(value.toFixed(4))])),
    featureDetails: features,
    probabilities: {
      homeWin: Number(probs.homeWin.toFixed(4)),
      draw: Number(probs.draw.toFixed(4)),
      awayWin: Number(probs.awayWin.toFixed(4))
    }
  };
}

function predictedScore(probs) {
  if (probs.draw >= probs.homeWin && probs.draw >= probs.awayWin) return "1-1";
  const edge = Math.abs(probs.homeWin - probs.awayWin);
  if (probs.homeWin > probs.awayWin) {
    if (probs.homeWin > 0.62) return "2-0";
    if (edge < 0.16) return "2-1";
    return "1-0";
  }
  if (probs.awayWin > 0.62) return "0-2";
  if (edge < 0.16) return "1-2";
  return "0-1";
}

function confidence(probs) {
  const sorted = Object.values(probs).sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];
  if (gap >= 0.22) return "high";
  if (gap >= 0.1) return "medium";
  return "low";
}

function upsetRisk(probs) {
  const sorted = Object.values(probs).sort((a, b) => b - a);
  const favorite = sorted[0];
  if (favorite < 0.42) return "high";
  if (favorite < 0.52) return "medium";
  return "low";
}

function topDrivers(home, away, prediction) {
  const drivers = [];
  if (Math.abs(prediction.eloDiff) >= 40) {
    drivers.push(`${prediction.eloDiff > 0 ? home.team : away.team} has the Elo edge (${Math.abs(prediction.eloDiff).toFixed(0)} points).`);
  } else {
    drivers.push("The Elo gap is small, so the matchup is relatively balanced.");
  }

  if (Math.abs(prediction.formDiff) >= 0.08) {
    drivers.push(`${prediction.formDiff > 0 ? home.team : away.team} has better recent 10-match form.`);
  } else {
    drivers.push("Recent form is close between the two teams.");
  }

  if (prediction.homeAdvantage > 0) {
    drivers.push(`${home.team} receives a home advantage adjustment.`);
  } else {
    drivers.push("The match is treated as neutral-site, so no home advantage is applied.");
  }

  if (prediction.featureDetails.odds.available) {
    drivers.push("Pre-match odds are included after bookmaker margin removal.");
  }

  if (prediction.featureDetails.squadRating.available) {
    const leader = prediction.featureDetails.squadRating.diff >= 0 ? home.team : away.team;
    drivers.push(`${leader} has the stronger game-rating squad profile.`);
  }

  if (prediction.featureDetails.marketValue.available) {
    const leader = prediction.featureDetails.marketValue.diff >= 0 ? home.team : away.team;
    drivers.push(`${leader} has the higher market-value profile.`);
  }

  if (prediction.featureDetails.tendency?.available) {
    drivers.push("Rolling team tendency features are included from recent historical match patterns.");
  }

  return drivers;
}

function matchupAnalysis(home, away, homeProfile, awayProfile) {
  if (!homeProfile || !awayProfile) return null;
  const homeTags = new Set(homeProfile.styleTags);
  const awayTags = new Set(awayProfile.styleTags);
  const notes = [];
  if (homeProfile.transitionRating !== null && awayProfile.defenseRating !== null && homeProfile.transitionRating - awayProfile.defenseRating >= 3) {
    notes.push(`${home.team} 的转换推进可能冲击 ${away.team} 的防线。`);
  }
  if (awayProfile.transitionRating !== null && homeProfile.defenseRating !== null && awayProfile.transitionRating - homeProfile.defenseRating >= 3) {
    notes.push(`${away.team} 的反击速度可能限制 ${home.team} 的压上。`);
  }
  if (homeTags.has("possession") && awayTags.has("compact")) {
    notes.push(`${home.team} 控球推进会遇到 ${away.team} 的紧凑防守，破密集能力是关键。`);
  }
  if (awayTags.has("possession") && homeTags.has("compact")) {
    notes.push(`${away.team} 控球推进会遇到 ${home.team} 的紧凑防守，边路和定位球会更重要。`);
  }
  if (homeTags.has("pressing") && awayProfile.midfieldRating !== null && awayProfile.midfieldRating < 74) {
    notes.push(`${home.team} 的压迫可能放大 ${away.team} 中后场出球压力。`);
  }
  if (awayTags.has("pressing") && homeProfile.midfieldRating !== null && homeProfile.midfieldRating < 74) {
    notes.push(`${away.team} 的压迫可能放大 ${home.team} 中后场出球压力。`);
  }
  if (homeProfile.setPieceRating !== null && awayProfile.setPieceRating !== null && homeProfile.setPieceRating - awayProfile.setPieceRating >= 3) {
    notes.push(`${home.team} 在定位球环节有相对优势。`);
  }
  if (awayProfile.setPieceRating !== null && homeProfile.setPieceRating !== null && awayProfile.setPieceRating - homeProfile.setPieceRating >= 3) {
    notes.push(`${away.team} 在定位球环节有相对优势。`);
  }
  return {
    home: {
      tier: homeProfile.squadTier,
      styleTags: homeProfile.styleTags,
      strengths: homeProfile.strengths,
      weaknesses: homeProfile.weaknesses,
      keyPlayers: homeProfile.keyPlayers
    },
    away: {
      tier: awayProfile.squadTier,
      styleTags: awayProfile.styleTags,
      strengths: awayProfile.strengths,
      weaknesses: awayProfile.weaknesses,
      keyPlayers: awayProfile.keyPlayers
    },
    matchupNotes: notes.slice(0, 4),
    source: homeProfile.source || awayProfile.source || "team tactical profile"
  };
}

function loadInput(args) {
  if (!args.input) return {};
  return JSON.parse(fs.readFileSync(args.input, "utf8"));
}

function mergeOdds(args, input) {
  if (input.odds) return input.odds;
  if (args.homeOdds && args.drawOdds && args.awayOdds) {
    return {
      home: Number(args.homeOdds),
      draw: Number(args.drawOdds),
      away: Number(args.awayOdds)
    };
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  const input = loadInput(args);
  const homeName = args.home ?? input.homeTeam;
  const awayName = args.away ?? input.awayTeam;
  if (!homeName || !awayName) {
    console.error("Usage: node scripts/predict-match.mjs --home France --away Japan --neutral true");
    console.error("   or: node scripts/predict-match.mjs --input data/sample/france-japan-prediction.json");
    process.exit(1);
  }

  const teams = JSON.parse(fs.readFileSync(args.teams, "utf8"));
  const strengthRows = readCsv(args.strength ?? input.strengthFile ?? "data/manual/team-strength.csv");
  const tendencyRows = readCsv(args.tendencies ?? input.tendenciesFile ?? "data/processed/team-tendencies.csv");
  const profileRows = readCsv(args.profiles ?? input.profilesFile ?? "data/manual/team-tactical-profiles.csv");
  const model = fs.existsSync(args.model ?? input.modelFile ?? DEFAULT_MODEL)
    ? JSON.parse(fs.readFileSync(args.model ?? input.modelFile ?? DEFAULT_MODEL, "utf8"))
    : null;
  const home = findTeam(teams, homeName);
  const away = findTeam(teams, awayName);
  const homeStrength = {
    ...findStrength(strengthRows, home.team),
    ...(input.fifaPoints?.home !== undefined ? { fifaPoints: Number(input.fifaPoints.home) } : {}),
    ...(input.fifaRank?.home !== undefined ? { fifaRank: Number(input.fifaRank.home) } : {}),
    ...(input.squadRating?.home !== undefined ? { squadRating: Number(input.squadRating.home) } : {}),
    ...(input.marketValue?.home !== undefined ? { marketValueEur: Number(input.marketValue.home) } : {})
  };
  const awayStrength = {
    ...findStrength(strengthRows, away.team),
    ...(input.fifaPoints?.away !== undefined ? { fifaPoints: Number(input.fifaPoints.away) } : {}),
    ...(input.fifaRank?.away !== undefined ? { fifaRank: Number(input.fifaRank.away) } : {}),
    ...(input.squadRating?.away !== undefined ? { squadRating: Number(input.squadRating.away) } : {}),
    ...(input.marketValue?.away !== undefined ? { marketValueEur: Number(input.marketValue.away) } : {})
  };
  const homeTendency = findTendency(tendencyRows, home.team);
  const awayTendency = findTendency(tendencyRows, away.team);
  const homeProfile = findProfile(profileRows, home.team);
  const awayProfile = findProfile(profileRows, away.team);
  const prediction = predict(home, away, {
    neutral: String(args.neutral ?? input.neutral ?? "true").toLowerCase() !== "false",
    odds: mergeOdds(args, input),
    homeStrength,
    awayStrength,
    homeTendency,
    awayTendency,
    model
  });
  const probs = prediction.probabilities;
  const missingFeatures = Object.entries(prediction.featureDetails)
    .filter(([, detail]) => !detail.available)
    .map(([key]) => key);
  const result = {
    match: `${home.team} vs ${away.team}`,
    neutral: String(args.neutral ?? input.neutral ?? "true").toLowerCase() !== "false",
    inputs: {
      home: {
        team: home.team,
        elo: home.elo,
        recentFormScore: home.recentForm.formScore,
        recentRecord: `${home.recentForm.wins}-${home.recentForm.draws}-${home.recentForm.losses}`
      },
      away: {
        team: away.team,
        elo: away.elo,
        recentFormScore: away.recentForm.formScore,
        recentRecord: `${away.recentForm.wins}-${away.recentForm.draws}-${away.recentForm.losses}`
      }
    },
    features: {
      eloDiff: prediction.eloDiff,
      recentFormDiff: prediction.formDiff,
      homeAdvantageApplied: prediction.homeAdvantage,
      activeWeights: prediction.activeWeights,
      odds: prediction.featureDetails.odds.available ? prediction.featureDetails.odds.cleaned : null,
      fifa: prediction.featureDetails.fifa.available
        ? {
            mode: prediction.featureDetails.fifa.mode,
            diff: prediction.featureDetails.fifa.diff
          }
        : null,
      squadRatingDiff: prediction.featureDetails.squadRating.available ? prediction.featureDetails.squadRating.diff : null,
      marketValueLogRatio: prediction.featureDetails.marketValue.available ? prediction.featureDetails.marketValue.diff : null
      ,
      tendency: prediction.featureDetails.tendency?.available
        ? {
            winRateDiff: prediction.featureDetails.tendency.winRateDiff,
            drawRateAvg: prediction.featureDetails.tendency.drawRateAvg,
            goalDiffDiff: prediction.featureDetails.tendency.goalDiffDiff
          }
        : null,
      modelVersion: prediction.modelVersion ?? null
    },
    probabilities: probs,
    predictedScore: predictedScore(probs),
    confidence: confidence(probs),
    upsetRisk: upsetRisk(probs),
    drivers: topDrivers(home, away, prediction),
    matchupAnalysis: matchupAnalysis(home, away, homeProfile, awayProfile),
    missingFeatures,
    caveat: missingFeatures.length
      ? `Missing features were excluded and weights were redistributed: ${missingFeatures.join(", ")}.`
      : "All first-version feature groups were available: odds, Elo, recent form, FIFA, game squad rating, and market value."
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
