#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    fixtures: "data/manual/wc26-official-group-stage.csv",
    odds: "data/manual/match-odds.csv",
    wc26Teams: "data/manual/wc26-teams.csv",
    model: "config/calibrated-model.json",
    outputJson: "output/match-predictions-2026.json",
    outputCsv: "output/match-predictions-2026.csv"
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
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function writeCsv(filePath, rows, headers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function norm(name) {
  return String(name ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchKey(date, home, away) {
  return `${date}|${norm(home)}|${norm(away)}`;
}

function getFixtures(rows) {
  if (rows.some((row) => row.stage === "group" && row.homeTeam && row.awayTeam)) {
    return rows
      .filter((row) => row.stage === "group" && row.date >= "2026-06-11" && row.homeTeam && row.awayTeam)
      .map((row, index) => ({
        matchId: row.matchId || `2026-WC-GS-${String(index + 1).padStart(3, "0")}`,
        matchNumber: row.matchNumber || String(index + 1),
        date: row.date,
        kickoffLocal: row.kickoffLocal || "",
        group: row.group || "",
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        officialHomeTeam: row.officialHomeTeam || row.homeTeam,
        officialAwayTeam: row.officialAwayTeam || row.awayTeam,
        stadium: row.stadium || "",
        city: row.city,
        country: row.country,
        neutral: String(row.neutral).toUpperCase() === "TRUE",
        sourceUrl: row.sourceUrl || "",
        verifiedAt: row.verifiedAt || ""
      }));
  }
  return rows
    .filter((row) =>
      row.tournament === "FIFA World Cup" &&
      row.date >= "2026-06-11" &&
      (row.home_score === "NA" || row.away_score === "NA")
    )
    .map((row, index) => ({
      matchId: `2026-WC-GS-${String(index + 1).padStart(3, "0")}`,
      date: row.date,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      city: row.city,
      country: row.country,
      neutral: String(row.neutral).toUpperCase() === "TRUE"
    }));
}

function inferGroups(fixtures) {
  const parent = new Map();
  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }
  for (const fx of fixtures) union(fx.homeTeam, fx.awayTeam);
  const groups = new Map();
  for (const team of parent.keys()) {
    const root = find(team);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(team);
  }
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  return [...groups.values()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((teams, index) => ({ group: labels[index] ?? `G${index + 1}`, teams: teams.sort() }));
}

function groupsFromTeamFile(rows, fixtures) {
  const fixtureTeams = new Set(fixtures.flatMap((fixture) => [fixture.homeTeam, fixture.awayTeam]));
  const groupByTeam = new Map(rows
    .filter((row) => row.team && row.wc26PackageGroup)
    .map((row) => [norm(row.team), row.wc26PackageGroup]));
  const byGroup = new Map();
  for (const row of rows) {
    if (!fixtureTeams.has(row.team) || !row.wc26PackageGroup) continue;
    if (!byGroup.has(row.wc26PackageGroup)) byGroup.set(row.wc26PackageGroup, []);
    byGroup.get(row.wc26PackageGroup).push(row.team);
  }
  const complete = byGroup.size >= 12 && [...fixtureTeams].every((team) => groupByTeam.has(norm(team)));
  const scheduleGroups = new Map();
  for (const fixture of fixtures) {
    if (!fixture.group) continue;
    if (!scheduleGroups.has(fixture.group)) scheduleGroups.set(fixture.group, new Set());
    scheduleGroups.get(fixture.group).add(fixture.homeTeam);
    scheduleGroups.get(fixture.group).add(fixture.awayTeam);
  }
  if (scheduleGroups.size >= 12 && [...fixtureTeams].every((team) => fixtures.some((fixture) => fixture.group && (fixture.homeTeam === team || fixture.awayTeam === team)))) {
    return [...scheduleGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, teams]) => ({ group, teams: [...teams] }));
  }
  if (complete) return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, teams]) => ({ group, teams }));

  return inferGroups(fixtures)
    .map((fallbackGroup) => {
      const labels = [...new Set(fallbackGroup.teams.map((team) => groupByTeam.get(norm(team))).filter(Boolean))];
      return {
        group: labels.length === 1 ? labels[0] : fallbackGroup.group,
        teams: fallbackGroup.teams
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group));
}

function oddsMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.homeOdds || !row.drawOdds || !row.awayOdds) continue;
    map.set(matchKey(row.date, row.homeTeam, row.awayTeam), row);
  }
  return map;
}

function runPrediction(fixture, odds, model) {
  const args = [
    "scripts/predict-match.mjs",
    "--home", fixture.homeTeam,
    "--away", fixture.awayTeam,
    "--neutral", String(fixture.neutral),
    "--model", model
  ];
  if (odds) {
    args.push("--homeOdds", odds.homeOdds, "--drawOdds", odds.drawOdds, "--awayOdds", odds.awayOdds);
  }
  const stdout = execFileSync("node", args, { cwd: process.cwd(), encoding: "utf8" });
  return JSON.parse(stdout);
}

const args = parseArgs(process.argv);
const rawRows = readCsv(args.fixtures);
const fixtures = getFixtures(rawRows);
const groups = groupsFromTeamFile(readCsv(args.wc26Teams), fixtures);
const groupByTeam = new Map(groups.flatMap((g) => g.teams.map((team) => [team, g.group])));
const oddsByMatch = oddsMap(readCsv(args.odds));

const predictions = fixtures.map((fixture) => {
  const odds = oddsByMatch.get(matchKey(fixture.date, fixture.homeTeam, fixture.awayTeam));
  const pred = runPrediction(fixture, odds, args.model);
  const probs = pred.probabilities;
  const favorite = Math.max(probs.homeWin, probs.draw, probs.awayWin);
  const homeAwayGap = Math.abs(probs.homeWin - probs.awayWin);
  return {
    ...fixture,
    group: fixture.group || groupByTeam.get(fixture.homeTeam) || "",
    homeWin: probs.homeWin,
    draw: probs.draw,
    awayWin: probs.awayWin,
    predictedScore: pred.predictedScore,
    confidence: pred.confidence,
    upsetRisk: pred.upsetRisk,
    favoriteProbability: Number(favorite.toFixed(4)),
    homeAwayGap: Number(homeAwayGap.toFixed(4)),
    modelVersion: pred.features.modelVersion,
    oddsUsed: Boolean(odds),
    missingFeatures: pred.missingFeatures.join("|"),
    drivers: pred.drivers.join(" / "),
    homeRosterStatus: pred.matchupAnalysis?.home?.rosterStatus ?? "",
    awayRosterStatus: pred.matchupAnalysis?.away?.rosterStatus ?? "",
    matchupNotes: pred.matchupAnalysis?.matchupNotes?.join(" / ") ?? ""
  };
});

const result = {
  generatedAt: new Date().toISOString(),
  fixtures: fixtures.length,
  groups,
  predictions,
  rankings: {
    upsetRisk: [...predictions].sort((a, b) => a.favoriteProbability - b.favoriteProbability),
    strongestFavorites: [...predictions].sort((a, b) => b.favoriteProbability - a.favoriteProbability),
    closestMatches: [...predictions].sort((a, b) => a.homeAwayGap - b.homeAwayGap)
  }
};

fs.mkdirSync(path.dirname(args.outputJson), { recursive: true });
fs.writeFileSync(args.outputJson, JSON.stringify(result, null, 2));
writeCsv(args.outputCsv, predictions, [
  "matchId", "matchNumber", "date", "kickoffLocal", "group", "homeTeam", "awayTeam", "officialHomeTeam", "officialAwayTeam", "stadium", "city", "country", "neutral",
  "homeWin", "draw", "awayWin", "predictedScore", "confidence", "upsetRisk",
  "favoriteProbability", "homeAwayGap", "modelVersion", "oddsUsed", "missingFeatures",
  "homeRosterStatus", "awayRosterStatus", "matchupNotes"
]);
console.log(JSON.stringify({ outputJson: args.outputJson, outputCsv: args.outputCsv, fixtures: predictions.length, groups: groups.length }, null, 2));
