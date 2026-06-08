#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ALIASES = new Map([
  ["united states", "United States"],
  ["usa", "United States"],
  ["south korea", "South Korea"],
  ["korea republic", "South Korea"],
  ["ivory coast", "Ivory Coast"],
  ["côte d'ivoire", "Ivory Coast"],
  ["curacao", "Curaçao"],
  ["curaçao", "Curaçao"],
  ["dr congo", "DR Congo"],
  ["congo dr", "DR Congo"],
  ["china pr", "China PR"]
]);

function parseArgs(argv) {
  const args = {
    fixtures: "data/results.csv",
    existing: "data/manual/team-strength.csv",
    wc26Teams: "data/manual/wc26-teams.csv",
    fifaSimple: "data/fifa_ranking_simple.csv",
    output: "data/manual/team-strength.csv"
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
  const cleaned = String(name ?? "").trim().toLowerCase();
  return ALIASES.get(cleaned) ?? String(name ?? "").trim();
}

const args = parseArgs(process.argv);
const fixtures = readCsv(args.fixtures).filter((row) =>
  row.tournament === "FIFA World Cup" &&
  row.date >= "2026-06-11" &&
  (row.home_score === "NA" || row.away_score === "NA")
);
const teams = [...new Set(fixtures.flatMap((row) => [norm(row.home_team), norm(row.away_team)]))].sort();
const existing = new Map(readCsv(args.existing).map((row) => [norm(row.team), row]));
const wc26 = new Map(readCsv(args.wc26Teams).map((row) => [norm(row.team), row]));
const fifaLatest = new Map();
for (const row of readCsv(args.fifaSimple)) {
  const team = norm(row.team);
  if (!team) continue;
  const prev = fifaLatest.get(team);
  if (!prev || row.date > prev.date) fifaLatest.set(team, row);
}

const rows = teams.map((team) => {
  const old = existing.get(team) ?? {};
  const wc = wc26.get(team) ?? {};
  const latest = fifaLatest.get(team) ?? {};
  const fifaRank = old.fifaRank || wc.fifaRank || "";
  const fifaPoints = old.fifaPoints || latest.total_points || "";
  return {
    team,
    fifaRank,
    fifaPoints,
    squadRating: old.squadRating || "",
    marketValueEur: old.marketValueEur || "",
    marketValueSource: old.marketValueSource || "",
    ratingSource: old.ratingSource || "",
    updatedAt: old.updatedAt || (wc.fifaRank ? "2026-02-11" : latest.date || ""),
    fifaRankSource: wc.fifaRank ? "wc26-mcp package 0.3.1" : (latest.date ? "fifa_ranking_simple latest snapshot" : ""),
    dataStatus: [
      fifaRank || fifaPoints ? "fifa" : "",
      old.squadRating ? "squadRating" : "",
      old.marketValueEur ? "marketValue" : ""
    ].filter(Boolean).join("|")
  };
});

writeCsv(args.output, rows, ["team", "fifaRank", "fifaPoints", "squadRating", "marketValueEur", "marketValueSource", "ratingSource", "updatedAt", "fifaRankSource", "dataStatus"]);
console.log(JSON.stringify({
  output: args.output,
  teams: rows.length,
  fifaRankRows: rows.filter((r) => r.fifaRank).length,
  squadRatingRows: rows.filter((r) => r.squadRating).length,
  marketValueRows: rows.filter((r) => r.marketValueEur).length
}, null, 2));
