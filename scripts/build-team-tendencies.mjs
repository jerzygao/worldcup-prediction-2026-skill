#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "data/processed/match-features.csv",
    output: "data/processed/team-tendencies.csv",
    since: "2018-01-01"
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
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function writeCsv(filePath, rows, headers) {
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function getStats(map, team) {
  if (!map.has(team)) {
    map.set(team, {
      team,
      matches: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      neutralMatches: 0,
      homeLikeMatches: 0,
      homeLikeWins: 0
    });
  }
  return map.get(team);
}

const args = parseArgs(process.argv);
const rows = readCsv(args.input).filter((row) => row.date >= args.since);
const stats = new Map();

for (const row of rows) {
  const hs = row.score.split("-").map(Number);
  if (hs.length !== 2 || !Number.isFinite(hs[0]) || !Number.isFinite(hs[1])) continue;
  const [homeScore, awayScore] = hs;
  const neutral = String(row.neutral).toLowerCase() === "true";
  const home = getStats(stats, row.homeTeam);
  const away = getStats(stats, row.awayTeam);
  home.matches += 1;
  away.matches += 1;
  home.goalsFor += homeScore;
  home.goalsAgainst += awayScore;
  away.goalsFor += awayScore;
  away.goalsAgainst += homeScore;
  if (neutral) {
    home.neutralMatches += 1;
    away.neutralMatches += 1;
  } else {
    home.homeLikeMatches += 1;
  }
  if (homeScore > awayScore) {
    home.wins += 1;
    away.losses += 1;
    if (!neutral) home.homeLikeWins += 1;
  } else if (homeScore < awayScore) {
    away.wins += 1;
    home.losses += 1;
  } else {
    home.draws += 1;
    away.draws += 1;
  }
}

const output = [...stats.values()]
  .filter((row) => row.matches >= 8)
  .map((row) => ({
    team: row.team,
    matches: row.matches,
    winRate: Number((row.wins / row.matches).toFixed(4)),
    drawRate: Number((row.draws / row.matches).toFixed(4)),
    lossRate: Number((row.losses / row.matches).toFixed(4)),
    goalsForPerMatch: Number((row.goalsFor / row.matches).toFixed(4)),
    goalsAgainstPerMatch: Number((row.goalsAgainst / row.matches).toFixed(4)),
    goalDiffPerMatch: Number(((row.goalsFor - row.goalsAgainst) / row.matches).toFixed(4)),
    neutralShare: Number((row.neutralMatches / row.matches).toFixed(4)),
    homeLikeWinRate: row.homeLikeMatches ? Number((row.homeLikeWins / row.homeLikeMatches).toFixed(4)) : ""
  }))
  .sort((a, b) => b.goalDiffPerMatch - a.goalDiffPerMatch);

writeCsv(args.output, output, Object.keys(output[0]));
console.log(JSON.stringify({ output: args.output, teams: output.length, since: args.since }, null, 2));
