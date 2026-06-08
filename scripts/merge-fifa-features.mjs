#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const NAME_ALIASES = new Map([
  ["usa", "united states"],
  ["united states of america", "united states"],
  ["korea republic", "south korea"],
  ["ir iran", "iran"],
  ["czechia", "czech republic"],
  ["china pr", "china"],
  ["côte d'ivoire", "ivory coast"],
  ["cote d'ivoire", "ivory coast"],
  ["dr congo", "congo dr"],
  ["congo, dr", "congo dr"],
  ["cape verde islands", "cape verde"],
  ["kyrgyz republic", "kyrgyzstan"],
  ["curaçao", "curacao"]
]);

function parseArgs(argv) {
  const args = {
    matches: "data/processed/match-features.csv",
    fifaSimple: "data/fifa_ranking_simple.csv",
    fifaDetailed: "data/fifa_ranking.csv",
    output: "data/processed/match-features-fifa.csv"
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
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function norm(name) {
  const cleaned = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ");
  return NAME_ALIASES.get(cleaned) ?? cleaned;
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildIndex(simpleRows, detailedRows) {
  const index = new Map();
  function add(team, date, points, rank, source) {
    const key = norm(team);
    if (!key || !date) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ date, points, rank, source });
  }
  for (const row of detailedRows) {
    add(row.country_full, row.rank_date, toNum(row.total_points), toNum(row.rank), "detailed");
  }
  for (const row of simpleRows) {
    add(row.team, row.date, toNum(row.total_points), null, "simple");
  }
  for (const rows of index.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
  }
  return index;
}

function latestBefore(index, team, date) {
  const rows = index.get(norm(team));
  if (!rows) return null;
  let lo = 0;
  let hi = rows.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid].date < date) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? rows[best] : null;
}

const args = parseArgs(process.argv);
const matches = readCsv(args.matches);
const simple = fs.existsSync(args.fifaSimple) ? readCsv(args.fifaSimple) : [];
const detailed = fs.existsSync(args.fifaDetailed) ? readCsv(args.fifaDetailed) : [];
const index = buildIndex(simple, detailed);

let bothPoints = 0;
let eitherRank = 0;
const out = matches.map((row) => {
  const home = latestBefore(index, row.homeTeam, row.date);
  const away = latestBefore(index, row.awayTeam, row.date);
  const homePoints = home?.points ?? null;
  const awayPoints = away?.points ?? null;
  const homeRank = home?.rank ?? null;
  const awayRank = away?.rank ?? null;
  const fifaPointsDiff = Number.isFinite(homePoints) && Number.isFinite(awayPoints)
    ? Number((homePoints - awayPoints).toFixed(4))
    : "";
  const fifaRankDiff = Number.isFinite(homeRank) && Number.isFinite(awayRank)
    ? Number((awayRank - homeRank).toFixed(4))
    : "";
  if (fifaPointsDiff !== "") bothPoints += 1;
  if (fifaRankDiff !== "") eitherRank += 1;
  return {
    ...row,
    fifaHomePoints: homePoints ?? "",
    fifaAwayPoints: awayPoints ?? "",
    fifaPointsDiff,
    fifaHomeRank: homeRank ?? "",
    fifaAwayRank: awayRank ?? "",
    fifaRankDiff,
    fifaHomeDate: home?.date ?? "",
    fifaAwayDate: away?.date ?? ""
  };
});

writeCsv(args.output, out, Object.keys(out[0]));
console.log(JSON.stringify({
  output: args.output,
  rows: out.length,
  fifaPointsCoverage: Number((bothPoints / out.length).toFixed(4)),
  fifaRankCoverage: Number((eitherRank / out.length).toFixed(4)),
  indexedTeams: index.size
}, null, 2));
