#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const INITIAL_ELO = 1500;
const HOME_ADVANTAGE = 60;
const RECENT_WINDOW = 10;

function parseArgs(argv) {
  const args = {
    input: "data/results.csv",
    outDir: "data/processed"
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
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
    row.sourceIndex = index + 1;
    return row;
  });
}

function kFactor(tournament) {
  const name = tournament.toLowerCase();
  if (name === "fifa world cup") return 60;
  if (name.includes("world cup qualification")) return 40;
  if (
    name.includes("uefa euro") ||
    name.includes("copa america") ||
    name.includes("african cup") ||
    name.includes("asian cup") ||
    name.includes("gold cup") ||
    name.includes("nations league") ||
    name.includes("confederations cup")
  ) {
    return 45;
  }
  if (name.includes("friendly")) return 20;
  return 30;
}

function goalMultiplier(goalDiff) {
  const diff = Math.abs(goalDiff);
  if (diff <= 1) return 1;
  if (diff === 2) return 1.5;
  return (11 + diff) / 8;
}

function expectedScore(teamElo, opponentElo) {
  return 1 / (1 + 10 ** ((opponentElo - teamElo) / 400));
}

function actualScore(goalsFor, goalsAgainst) {
  if (goalsFor > goalsAgainst) return 1;
  if (goalsFor < goalsAgainst) return 0;
  return 0.5;
}

function emptyForm() {
  return {
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    winRate: 0,
    pointsPerMatch: 0,
    goalDiffPerMatch: 0,
    cleanSheetRate: 0,
    formScore: 0
  };
}

function summarizeForm(history) {
  const recent = history.slice(-RECENT_WINDOW);
  if (recent.length === 0) return emptyForm();

  const summary = emptyForm();
  summary.matches = recent.length;
  for (const match of recent) {
    summary.goalsFor += match.goalsFor;
    summary.goalsAgainst += match.goalsAgainst;
    if (match.goalsFor > match.goalsAgainst) {
      summary.wins += 1;
      summary.points += 3;
    } else if (match.goalsFor === match.goalsAgainst) {
      summary.draws += 1;
      summary.points += 1;
    } else {
      summary.losses += 1;
    }
  }

  summary.winRate = summary.wins / summary.matches;
  summary.pointsPerMatch = summary.points / summary.matches;
  summary.goalDiffPerMatch = (summary.goalsFor - summary.goalsAgainst) / summary.matches;
  summary.cleanSheetRate = recent.filter((match) => match.goalsAgainst === 0).length / summary.matches;

  const pointsComponent = (summary.pointsPerMatch - 1.5) / 1.5;
  const goalComponent = Math.max(-1, Math.min(1, summary.goalDiffPerMatch / 2));
  const cleanSheetComponent = summary.cleanSheetRate - 0.35;
  summary.formScore = Math.max(
    -1,
    Math.min(1, 0.6 * pointsComponent + 0.3 * goalComponent + 0.1 * cleanSheetComponent)
  );

  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [
      key,
      typeof value === "number" ? Number(value.toFixed(4)) : value
    ])
  );
}

function resultCode(homeScore, awayScore) {
  if (homeScore > awayScore) return "H";
  if (homeScore < awayScore) return "A";
  return "D";
}

function updateHistory(history, team, goalsFor, goalsAgainst, date, opponent, tournament) {
  if (!history.has(team)) history.set(team, []);
  history.get(team).push({ date, opponent, tournament, goalsFor, goalsAgainst });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function writeCsv(filePath, rows, headers) {
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function getRating(ratings, team) {
  if (!ratings.has(team)) ratings.set(team, INITIAL_ELO);
  return ratings.get(team);
}

function build(inputPath, outDir) {
  const rawRows = readCsv(inputPath);
  const rows = rawRows
    .map((row) => ({
      date: row.date,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      homeScore: Number(row.home_score),
      awayScore: Number(row.away_score),
      tournament: row.tournament,
      city: row.city,
      country: row.country,
      neutral: String(row.neutral).toUpperCase() === "TRUE",
      sourceIndex: row.sourceIndex
    }))
    .filter((row) => row.date && row.homeTeam && row.awayTeam && Number.isFinite(row.homeScore) && Number.isFinite(row.awayScore))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sourceIndex - b.sourceIndex);

  const ratings = new Map();
  const histories = new Map();
  const matchFeatures = [];
  const eloHistory = [];

  for (const [index, row] of rows.entries()) {
    const homeEloBefore = getRating(ratings, row.homeTeam);
    const awayEloBefore = getRating(ratings, row.awayTeam);
    const homeFormBefore = summarizeForm(histories.get(row.homeTeam) ?? []);
    const awayFormBefore = summarizeForm(histories.get(row.awayTeam) ?? []);
    const homeAdjusted = homeEloBefore + (row.neutral ? 0 : HOME_ADVANTAGE);
    const homeExpected = expectedScore(homeAdjusted, awayEloBefore);
    const awayExpected = 1 - homeExpected;
    const homeActual = actualScore(row.homeScore, row.awayScore);
    const awayActual = 1 - homeActual;
    const k = kFactor(row.tournament) * goalMultiplier(row.homeScore - row.awayScore);
    const homeChange = k * (homeActual - homeExpected);
    const awayChange = k * (awayActual - awayExpected);
    const homeEloAfter = homeEloBefore + homeChange;
    const awayEloAfter = awayEloBefore + awayChange;

    ratings.set(row.homeTeam, homeEloAfter);
    ratings.set(row.awayTeam, awayEloAfter);

    const matchId = `${row.date}-${String(index + 1).padStart(5, "0")}`;
    matchFeatures.push({
      matchId,
      date: row.date,
      tournament: row.tournament,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      neutral: row.neutral,
      score: `${row.homeScore}-${row.awayScore}`,
      actual: resultCode(row.homeScore, row.awayScore),
      features: {
        eloHomeBefore: Number(homeEloBefore.toFixed(2)),
        eloAwayBefore: Number(awayEloBefore.toFixed(2)),
        eloDiff: Number((homeEloBefore - awayEloBefore).toFixed(2)),
        homeAdvantageApplied: row.neutral ? 0 : HOME_ADVANTAGE,
        recentFormHome: homeFormBefore,
        recentFormAway: awayFormBefore,
        recentFormDiff: Number((homeFormBefore.formScore - awayFormBefore.formScore).toFixed(4))
      },
      eloUpdate: {
        kFactor: Number(k.toFixed(2)),
        expectedHome: Number(homeExpected.toFixed(4)),
        expectedAway: Number(awayExpected.toFixed(4)),
        eloHomeAfter: Number(homeEloAfter.toFixed(2)),
        eloAwayAfter: Number(awayEloAfter.toFixed(2)),
        eloHomeChange: Number(homeChange.toFixed(2)),
        eloAwayChange: Number(awayChange.toFixed(2))
      }
    });

    eloHistory.push(
      {
        matchId,
        date: row.date,
        team: row.homeTeam,
        opponent: row.awayTeam,
        eloBefore: Number(homeEloBefore.toFixed(2)),
        eloAfter: Number(homeEloAfter.toFixed(2)),
        eloChange: Number(homeChange.toFixed(2))
      },
      {
        matchId,
        date: row.date,
        team: row.awayTeam,
        opponent: row.homeTeam,
        eloBefore: Number(awayEloBefore.toFixed(2)),
        eloAfter: Number(awayEloAfter.toFixed(2)),
        eloChange: Number(awayChange.toFixed(2))
      }
    );

    updateHistory(histories, row.homeTeam, row.homeScore, row.awayScore, row.date, row.awayTeam, row.tournament);
    updateHistory(histories, row.awayTeam, row.awayScore, row.homeScore, row.date, row.homeTeam, row.tournament);
  }

  const teams = [...ratings.entries()]
    .map(([team, elo]) => ({
      team,
      elo: Number(elo.toFixed(2)),
      recentForm: summarizeForm(histories.get(team) ?? []),
      matches: histories.get(team)?.length ?? 0
    }))
    .sort((a, b) => b.elo - a.elo);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "match-features.json"), JSON.stringify(matchFeatures, null, 2));
  fs.writeFileSync(path.join(outDir, "elo-history.json"), JSON.stringify(eloHistory, null, 2));
  fs.writeFileSync(path.join(outDir, "team-current.json"), JSON.stringify(teams, null, 2));

  writeCsv(
    path.join(outDir, "team-current.csv"),
    teams.map((row) => ({
      team: row.team,
      elo: row.elo,
      matches: row.matches,
      recentMatches: row.recentForm.matches,
      recentWins: row.recentForm.wins,
      recentDraws: row.recentForm.draws,
      recentLosses: row.recentForm.losses,
      recentGoalsFor: row.recentForm.goalsFor,
      recentGoalsAgainst: row.recentForm.goalsAgainst,
      recentPointsPerMatch: row.recentForm.pointsPerMatch,
      recentGoalDiffPerMatch: row.recentForm.goalDiffPerMatch,
      recentCleanSheetRate: row.recentForm.cleanSheetRate,
      recentFormScore: row.recentForm.formScore
    })),
    [
      "team",
      "elo",
      "matches",
      "recentMatches",
      "recentWins",
      "recentDraws",
      "recentLosses",
      "recentGoalsFor",
      "recentGoalsAgainst",
      "recentPointsPerMatch",
      "recentGoalDiffPerMatch",
      "recentCleanSheetRate",
      "recentFormScore"
    ]
  );

  writeCsv(
    path.join(outDir, "match-features.csv"),
    matchFeatures.map((row) => ({
      matchId: row.matchId,
      date: row.date,
      tournament: row.tournament,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      neutral: row.neutral,
      score: row.score,
      actual: row.actual,
      eloHomeBefore: row.features.eloHomeBefore,
      eloAwayBefore: row.features.eloAwayBefore,
      eloDiff: row.features.eloDiff,
      recentFormHome: row.features.recentFormHome.formScore,
      recentFormAway: row.features.recentFormAway.formScore,
      recentFormDiff: row.features.recentFormDiff,
      expectedHome: row.eloUpdate.expectedHome,
      expectedAway: row.eloUpdate.expectedAway
    })),
    [
      "matchId",
      "date",
      "tournament",
      "homeTeam",
      "awayTeam",
      "neutral",
      "score",
      "actual",
      "eloHomeBefore",
      "eloAwayBefore",
      "eloDiff",
      "recentFormHome",
      "recentFormAway",
      "recentFormDiff",
      "expectedHome",
      "expectedAway"
    ]
  );

  const summary = {
    inputPath,
    outDir,
    firstMatchDate: matchFeatures[0]?.date ?? null,
    lastMatchDate: matchFeatures.at(-1)?.date ?? null,
    matches: matchFeatures.length,
    teams: teams.length,
    settings: {
      initialElo: INITIAL_ELO,
      homeAdvantage: HOME_ADVANTAGE,
      recentWindow: RECENT_WINDOW
    },
    topElo: teams.slice(0, 20)
  };
  fs.writeFileSync(path.join(outDir, "build-summary.json"), JSON.stringify(summary, null, 2));

  return summary;
}

const args = parseArgs(process.argv);
const result = build(args.input, args.outDir);
console.log(JSON.stringify(result, null, 2));
