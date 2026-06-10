#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const VENUES = new Map([
  ["arlington|united states", { latitude: 32.7473, longitude: -97.0945, venue: "AT&T Stadium" }],
  ["dallas|united states", { latitude: 32.7473, longitude: -97.0945, venue: "Dallas Stadium" }],
  ["atlanta|united states", { latitude: 33.7554, longitude: -84.4008, venue: "Mercedes-Benz Stadium" }],
  ["east rutherford|united states", { latitude: 40.8135, longitude: -74.0745, venue: "MetLife Stadium" }],
  ["new york new jersey|united states", { latitude: 40.8135, longitude: -74.0745, venue: "New York New Jersey Stadium" }],
  ["foxborough|united states", { latitude: 42.0909, longitude: -71.2643, venue: "Gillette Stadium" }],
  ["boston|united states", { latitude: 42.0909, longitude: -71.2643, venue: "Boston Stadium" }],
  ["guadalupe|mexico", { latitude: 25.6681, longitude: -100.2440, venue: "Estadio BBVA" }],
  ["monterrey|mexico", { latitude: 25.6681, longitude: -100.2440, venue: "Monterrey Stadium" }],
  ["guadalajara|mexico", { latitude: 20.6817, longitude: -103.4626, venue: "Guadalajara Stadium" }],
  ["houston|united states", { latitude: 29.6847, longitude: -95.4107, venue: "NRG Stadium" }],
  ["inglewood|united states", { latitude: 33.9535, longitude: -118.3392, venue: "SoFi Stadium" }],
  ["los angeles|united states", { latitude: 33.9535, longitude: -118.3392, venue: "Los Angeles Stadium" }],
  ["kansas city|united states", { latitude: 39.0490, longitude: -94.4839, venue: "Arrowhead Stadium" }],
  ["mexico city|mexico", { latitude: 19.3029, longitude: -99.1505, venue: "Estadio Azteca" }],
  ["miami gardens|united states", { latitude: 25.9580, longitude: -80.2389, venue: "Hard Rock Stadium" }],
  ["miami|united states", { latitude: 25.9580, longitude: -80.2389, venue: "Miami Stadium" }],
  ["philadelphia|united states", { latitude: 39.9008, longitude: -75.1675, venue: "Lincoln Financial Field" }],
  ["santa clara|united states", { latitude: 37.4030, longitude: -121.9700, venue: "Levi's Stadium" }],
  ["san francisco bay area|united states", { latitude: 37.4030, longitude: -121.9700, venue: "San Francisco Bay Area Stadium" }],
  ["seattle|united states", { latitude: 47.5952, longitude: -122.3316, venue: "Lumen Field" }],
  ["toronto|canada", { latitude: 43.6327, longitude: -79.4186, venue: "BMO Field" }],
  ["vancouver|canada", { latitude: 49.2767, longitude: -123.1119, venue: "BC Place" }],
  ["zapopan|mexico", { latitude: 20.6817, longitude: -103.4626, venue: "Estadio Akron" }]
]);

function parseArgs(argv) {
  const args = {
    fixtures: "data/manual/wc26-official-group-stage.csv",
    odds: "data/manual/match-odds.csv",
    weather: "data/manual/match-weather.csv",
    lineups: "data/manual/match-lineups.csv",
    injuries: "data/manual/match-injuries.csv",
    status: "data/manual/pre-match-update-status.csv",
    refreshStrength: "true",
    rerunPredictions: "true",
    now: new Date().toISOString()
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
  const existingRows = [];
  if (fs.existsSync(filePath)) {
    const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) {
      const hdrs = parseCsvLine(lines[0]);
      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        existingRows.push(Object.fromEntries(hdrs.map((h, j) => [h, cells[j] ?? ""])));
      }
    }
  }
  const keyFields = ["date", "homeTeam", "awayTeam", "bookmaker"];
  const keyMap = new Map();
  const n = (v) => String(v ?? "").trim().toLowerCase();
  for (const row of existingRows) keyMap.set(keyFields.map((f) => n(row[f])).join("|"), row);
  for (const row of rows) keyMap.set(keyFields.map((f) => n(row[f])).join("|"), row);
  const merged = [...keyMap.values()];
  const outLines = [headers.join(","), ...merged.map((row) => headers.map((h) => csvEscape(row[h])).join(","))];
  fs.writeFileSync(filePath, `${outLines.join("\n")}\n`);
}

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function venueKey(city, country) {
  return `${norm(city)}|${norm(country)}`;
}

function matchId(row, index) {
  return `${row.date}-${String(index + 1).padStart(3, "0")}`;
}

function matchKey(date, homeTeam, awayTeam) {
  return `${date}|${norm(homeTeam)}|${norm(awayTeam)}`;
}

function fixtureRows(filePath) {
  const rows = readCsv(filePath);
  if (rows.some((row) => row.stage === "group" && row.homeTeam && row.awayTeam)) {
    return rows
      .filter((row) => row.stage === "group" && row.date >= "2026-06-11" && row.homeTeam && row.awayTeam)
      .map((row, index) => ({
        matchId: row.matchId || `${row.date}-${String(index + 1).padStart(3, "0")}`,
        date: row.date,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        city: row.city,
        country: row.country,
        stadium: row.stadium || "",
        neutral: String(row.neutral).toLowerCase() === "true"
      }));
  }
  return rows
    .filter((row) =>
      row.tournament === "FIFA World Cup" &&
      row.date >= "2026-06-11" &&
      (row.home_score === "NA" || row.away_score === "NA")
    )
    .map((row, index) => ({
      matchId: matchId(row, index),
      date: row.date,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      city: row.city,
      country: row.country,
      neutral: String(row.neutral).toLowerCase() === "true"
    }));
}

function daysUntil(date, now) {
  const target = new Date(`${date}T12:00:00Z`);
  return Math.floor((target.getTime() - now.getTime()) / 86400000);
}

function ensureTemplate(filePath, headers) {
  if (!fs.existsSync(filePath)) writeCsv(filePath, [], headers);
}

async function fetchOpenMeteoWeather(fixtures, now, outputPath) {
  const weatherRows = [];
  const statusByKey = new Map();
  for (const fixture of fixtures) {
    const d = daysUntil(fixture.date, now);
    const key = matchKey(fixture.date, fixture.homeTeam, fixture.awayTeam);
    const venue = VENUES.get(venueKey(fixture.city, fixture.country));
    if (!venue) {
      statusByKey.set(key, "missing_venue_coordinates");
      continue;
    }
    if (d < 0) {
      statusByKey.set(key, "match_date_past");
      continue;
    }
    if (d > 16) {
      statusByKey.set(key, "not_in_open_meteo_forecast_window");
      continue;
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${venue.latitude}&longitude=${venue.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&start_date=${fixture.date}&end_date=${fixture.date}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      weatherRows.push({
        matchId: fixture.matchId,
        date: fixture.date,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        city: fixture.city,
        country: fixture.country,
        venue: venue.venue,
        temperatureMaxC: data.daily?.temperature_2m_max?.[0] ?? "",
        temperatureMinC: data.daily?.temperature_2m_min?.[0] ?? "",
        precipitationMm: data.daily?.precipitation_sum?.[0] ?? "",
        windMaxKmh: data.daily?.wind_speed_10m_max?.[0] ?? "",
        source: "Open-Meteo forecast API",
        sourceUrl: url,
        fetchedAt: now.toISOString()
      });
      statusByKey.set(key, "updated");
    } catch (error) {
      statusByKey.set(key, `fetch_failed:${error.message}`);
    }
  }
  writeCsv(outputPath, weatherRows, ["matchId", "date", "homeTeam", "awayTeam", "city", "country", "venue", "temperatureMaxC", "temperatureMinC", "precipitationMm", "windMaxKmh", "source", "sourceUrl", "fetchedAt"]);
  return statusByKey;
}

function average(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

async function fetchOddsApi(fixtures, now, outputPath) {
  const key = process.env.ODDS_API_KEY;
  const statusByKey = new Map(fixtures.map((fixture) => [matchKey(fixture.date, fixture.homeTeam, fixture.awayTeam), key ? "not_found" : "missing_ODDS_API_KEY"]));
  if (!key) return statusByKey;

  const url = `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds?apiKey=${encodeURIComponent(key)}&regions=us,eu,uk&markets=h2h&oddsFormat=decimal`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const events = await response.json();
    const rows = [];
    for (const event of events) {
      const home = event.home_team || "";
      const away = event.away_team || "";
      const eventDate = String(event.commence_time || "").slice(0, 10);
      const fixture = fixtures.find((item) =>
        item.date === eventDate &&
        (norm(item.homeTeam) === norm(home) || norm(item.awayTeam) === norm(home)) &&
        (norm(item.homeTeam) === norm(away) || norm(item.awayTeam) === norm(away))
      );
      if (!fixture) continue;
      const homePrices = [];
      const drawPrices = [];
      const awayPrices = [];
      for (const bookmaker of event.bookmakers ?? []) {
        const market = bookmaker.markets?.find((item) => item.key === "h2h");
        for (const outcome of market?.outcomes ?? []) {
          if (norm(outcome.name) === norm(fixture.homeTeam)) homePrices.push(outcome.price);
          else if (norm(outcome.name) === norm(fixture.awayTeam)) awayPrices.push(outcome.price);
          else if (norm(outcome.name) === "draw") drawPrices.push(outcome.price);
        }
      }
      const homeOdds = average(homePrices);
      const drawOdds = average(drawPrices);
      const awayOdds = average(awayPrices);
      if (homeOdds && drawOdds && awayOdds) {
        rows.push({
          date: fixture.date,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          bookmaker: "the-odds-api consensus average",
          homeOdds: homeOdds.toFixed(4),
          drawOdds: drawOdds.toFixed(4),
          awayOdds: awayOdds.toFixed(4),
          timestamp: now.toISOString(),
          sourceUrl: "https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds"
        });
        statusByKey.set(matchKey(fixture.date, fixture.homeTeam, fixture.awayTeam), "updated");
      }
    }
    writeCsv(outputPath, rows, ["date", "homeTeam", "awayTeam", "bookmaker", "homeOdds", "drawOdds", "awayOdds", "timestamp", "sourceUrl"]);
  } catch (error) {
    for (const fixture of fixtures) statusByKey.set(matchKey(fixture.date, fixture.homeTeam, fixture.awayTeam), `fetch_failed:${error.message.slice(0, 120)}`);
  }
  return statusByKey;
}

function availabilityMap(rows, keyFields) {
  return new Set(rows.map((row) => keyFields.map((field) => norm(row[field])).join("|")));
}

const args = parseArgs(process.argv);
const now = new Date(args.now);
const fixtures = fixtureRows(args.fixtures);

ensureTemplate(args.lineups, ["date", "homeTeam", "awayTeam", "team", "player", "position", "starter", "confirmed", "source", "sourceUrl", "updatedAt"]);
ensureTemplate(args.injuries, ["date", "team", "player", "status", "expectedReturn", "importance", "source", "sourceUrl", "updatedAt"]);

if (args.refreshStrength === "true") {
  execFileSync("node", ["scripts/update-team-strength-sources.mjs", "--updatedAt", now.toISOString().slice(0, 10)], { stdio: "inherit" });
  execFileSync("node", ["scripts/build-squad-tactical-profiles.mjs", "--updatedAt", now.toISOString().slice(0, 10)], { stdio: "inherit" });
}

const oddsStatus = await fetchOddsApi(fixtures, now, args.odds);
const weatherStatus = await fetchOpenMeteoWeather(fixtures, now, args.weather);
const lineupRows = readCsv(args.lineups);
const injuryRows = readCsv(args.injuries);
const lineupKeys = availabilityMap(lineupRows.filter((row) => String(row.confirmed).toLowerCase() === "true"), ["date", "homeTeam", "awayTeam"]);
const injuryTeams = new Set(injuryRows.map((row) => norm(row.team)));

const statusRows = fixtures.map((fixture) => {
  const key = matchKey(fixture.date, fixture.homeTeam, fixture.awayTeam);
  const d = daysUntil(fixture.date, now);
  const lineupWindow = d <= 0 && d >= -1;
  return {
    matchId: fixture.matchId,
    date: fixture.date,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    city: fixture.city,
    country: fixture.country,
    oddsStatus: oddsStatus.get(key) || "not_checked",
    weatherStatus: weatherStatus.get(key) || "not_checked",
    lineupStatus: lineupKeys.has(`${norm(fixture.date)}|${norm(fixture.homeTeam)}|${norm(fixture.awayTeam)}`)
      ? "confirmed_imported"
      : lineupWindow
        ? "lineup_window_open_manual_or_api_update_needed"
        : "not_in_lineup_window",
    injuryStatus: injuryTeams.has(norm(fixture.homeTeam)) || injuryTeams.has(norm(fixture.awayTeam))
      ? "manual_injury_rows_available"
      : "no_verified_injury_rows",
    downgradeRule: [
      (oddsStatus.get(key) === "updated") ? "" : "odds excluded",
      (weatherStatus.get(key) === "updated") ? "" : "weather report-only or unavailable",
      lineupWindow ? "lineup can be refreshed" : "lineup not used until matchday"
    ].filter(Boolean).join("; "),
    checkedAt: now.toISOString()
  };
});

writeCsv(args.status, statusRows, ["matchId", "date", "homeTeam", "awayTeam", "city", "country", "oddsStatus", "weatherStatus", "lineupStatus", "injuryStatus", "downgradeRule", "checkedAt"]);

if (args.rerunPredictions === "true") {
  execFileSync("node", ["scripts/batch-predict-2026.mjs"], { stdio: "inherit" });
  execFileSync("node", ["scripts/simulate-2026.mjs"], { stdio: "inherit" });
  execFileSync("node", ["scripts/generate-report-2026.mjs"], { stdio: "inherit" });
}

console.log(JSON.stringify({
  status: args.status,
  odds: args.odds,
  weather: args.weather,
  lineups: args.lineups,
  injuries: args.injuries,
  fixtures: fixtures.length,
  oddsUpdated: statusRows.filter((row) => row.oddsStatus === "updated").length,
  weatherUpdated: statusRows.filter((row) => row.weatherStatus === "updated").length,
  lineupConfirmed: statusRows.filter((row) => row.lineupStatus === "confirmed_imported").length
}, null, 2));
