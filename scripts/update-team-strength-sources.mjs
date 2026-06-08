#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ALIASES = new Map([
  ["usa", "United States"],
  ["united states", "United States"],
  ["united states of america", "United States"],
  ["korea republic", "South Korea"],
  ["south korea", "South Korea"],
  ["côte d'ivoire", "Ivory Coast"],
  ["cote d'ivoire", "Ivory Coast"],
  ["ivory coast", "Ivory Coast"],
  ["curacao", "Curaçao"],
  ["curaçao", "Curaçao"],
  ["dr congo", "DR Congo"],
  ["congo dr", "DR Congo"],
  ["congo, dr", "DR Congo"],
  ["bosnia-herzegovina", "Bosnia and Herzegovina"],
  ["bosnia and herzegovina", "Bosnia and Herzegovina"],
  ["czechia", "Czech Republic"],
  ["czech republic", "Czech Republic"],
  ["turkiye", "Turkey"],
  ["türkiye", "Turkey"],
  ["turkey", "Turkey"]
]);

function parseArgs(argv) {
  const args = {
    teamStrength: "data/manual/team-strength.csv",
    squadRatingImport: "data/manual/squad-rating-import.csv",
    output: "data/manual/team-strength.csv",
    statusOutput: "data/manual/team-strength-update-status.csv",
    marketValueUrl: "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/national_teams.csv.gz",
    marketValueSource: "dcaribou/transfermarkt-datasets national_teams.csv.gz",
    marketValueSourceUrl: "https://github.com/dcaribou/transfermarkt-datasets",
    updatedAt: new Date().toISOString().slice(0, 10),
    clearSampleRatings: "true"
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
  const raw = String(name ?? "").trim();
  const key = raw.toLowerCase();
  return ALIASES.get(key) ?? raw;
}

function key(name) {
  return norm(name).toLowerCase();
}

async function readRemoteGzipCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const text = zlib.gunzipSync(compressed).toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function verifiedRatingRows(filePath) {
  return new Map(
    readCsv(filePath)
      .filter((row) => row.squadRating && String(row.status ?? "").toLowerCase() !== "sample")
      .map((row) => [key(row.team), row])
  );
}

const args = parseArgs(process.argv);
const strengthRows = readCsv(args.teamStrength);
const marketRows = await readRemoteGzipCsv(args.marketValueUrl);
const marketByTeam = new Map();
for (const row of marketRows) {
  const team = norm(row.name);
  if (!team || !row.total_market_value) continue;
  marketByTeam.set(key(team), row);
}
const ratingByTeam = verifiedRatingRows(args.squadRatingImport);

const rows = [];
const statusRows = [];
for (const row of strengthRows) {
  const team = norm(row.team);
  const market = marketByTeam.get(key(team));
  const rating = ratingByTeam.get(key(team));

  const sampleRating = String(row.ratingSource ?? "").toLowerCase().includes("sample");
  const squadRating = rating?.squadRating || (args.clearSampleRatings === "true" && sampleRating ? "" : row.squadRating || "");
  const ratingSource = rating?.ratingSource || (args.clearSampleRatings === "true" && sampleRating ? "" : row.ratingSource || "");
  const marketValueEur = market?.total_market_value || row.marketValueEur || "";
  const marketValueSource = market?.total_market_value ? args.marketValueSource : row.marketValueSource || "";

  const dataStatus = [
    row.fifaRank || row.fifaPoints ? "fifa" : "",
    squadRating ? "squadRating" : "",
    marketValueEur ? "marketValue" : ""
  ].filter(Boolean).join("|");

  rows.push({
    team,
    fifaRank: row.fifaRank || "",
    fifaPoints: row.fifaPoints || "",
    squadRating,
    marketValueEur,
    marketValueSource,
    ratingSource,
    updatedAt: market?.total_market_value || rating ? args.updatedAt : row.updatedAt || "",
    fifaRankSource: row.fifaRankSource || "",
    dataStatus
  });

  statusRows.push({
    team,
    marketValueStatus: market?.total_market_value ? "updated" : marketValueEur ? "existing" : "missing",
    marketValueEur,
    marketValueSourceUrl: market?.total_market_value ? args.marketValueSourceUrl : "",
    transfermarktTeamUrl: market?.url || "",
    squadRatingStatus: squadRating ? "available" : "missing",
    squadRatingSource: ratingSource,
    fallbackRule: [
      marketValueEur ? "" : "market value excluded",
      squadRating ? "" : "squad rating excluded"
    ].filter(Boolean).join("; ")
  });
}

writeCsv(args.output, rows, ["team", "fifaRank", "fifaPoints", "squadRating", "marketValueEur", "marketValueSource", "ratingSource", "updatedAt", "fifaRankSource", "dataStatus"]);
writeCsv(args.statusOutput, statusRows, ["team", "marketValueStatus", "marketValueEur", "marketValueSourceUrl", "transfermarktTeamUrl", "squadRatingStatus", "squadRatingSource", "fallbackRule"]);

console.log(JSON.stringify({
  output: args.output,
  statusOutput: args.statusOutput,
  teams: rows.length,
  marketValueRows: rows.filter((row) => row.marketValueEur).length,
  squadRatingRows: rows.filter((row) => row.squadRating).length,
  missingMarketValue: statusRows.filter((row) => row.marketValueStatus === "missing").map((row) => row.team),
  missingSquadRating: statusRows.filter((row) => row.squadRatingStatus === "missing").length
}, null, 2));
