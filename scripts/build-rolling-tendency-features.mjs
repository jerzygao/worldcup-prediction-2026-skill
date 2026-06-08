#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "data/processed/match-features-fifa.csv",
    output: "data/processed/match-features-tendency.csv",
    window: "30"
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

function getHistory(map, team) {
  if (!map.has(team)) map.set(team, []);
  return map.get(team);
}

function summarize(history, window) {
  const rows = history.slice(-window);
  if (rows.length < 6) {
    return { matches: rows.length, winRate: "", drawRate: "", goalDiffPerMatch: "" };
  }
  let wins = 0;
  let draws = 0;
  let gf = 0;
  let ga = 0;
  for (const row of rows) {
    gf += row.gf;
    ga += row.ga;
    if (row.gf > row.ga) wins += 1;
    else if (row.gf === row.ga) draws += 1;
  }
  return {
    matches: rows.length,
    winRate: Number((wins / rows.length).toFixed(4)),
    drawRate: Number((draws / rows.length).toFixed(4)),
    goalDiffPerMatch: Number(((gf - ga) / rows.length).toFixed(4))
  };
}

const args = parseArgs(process.argv);
const window = Number(args.window);
const rows = readCsv(args.input);
const histories = new Map();
const out = [];

for (const row of rows) {
  const homeHist = summarize(getHistory(histories, row.homeTeam), window);
  const awayHist = summarize(getHistory(histories, row.awayTeam), window);
  const homeWinRate = homeHist.winRate;
  const awayWinRate = awayHist.winRate;
  const homeDrawRate = homeHist.drawRate;
  const awayDrawRate = awayHist.drawRate;
  const homeGd = homeHist.goalDiffPerMatch;
  const awayGd = awayHist.goalDiffPerMatch;

  out.push({
    ...row,
    tendencyHomeMatches: homeHist.matches,
    tendencyAwayMatches: awayHist.matches,
    tendencyWinRateDiff: homeWinRate !== "" && awayWinRate !== "" ? Number((homeWinRate - awayWinRate).toFixed(4)) : "",
    tendencyDrawRateAvg: homeDrawRate !== "" && awayDrawRate !== "" ? Number(((homeDrawRate + awayDrawRate) / 2).toFixed(4)) : "",
    tendencyGoalDiffDiff: homeGd !== "" && awayGd !== "" ? Number((homeGd - awayGd).toFixed(4)) : ""
  });

  const [homeScore, awayScore] = String(row.score).split("-").map(Number);
  if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
    getHistory(histories, row.homeTeam).push({ gf: homeScore, ga: awayScore });
    getHistory(histories, row.awayTeam).push({ gf: awayScore, ga: homeScore });
  }
}

writeCsv(args.output, out, Object.keys(out[0]));
const usable = out.filter((row) => row.tendencyWinRateDiff !== "" && row.tendencyDrawRateAvg !== "" && row.tendencyGoalDiffDiff !== "").length;
console.log(JSON.stringify({ output: args.output, rows: out.length, window, usable, coverage: Number((usable / out.length).toFixed(4)) }, null, 2));
