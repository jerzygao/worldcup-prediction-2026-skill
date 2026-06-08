#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    teamStrength: "data/manual/team-strength.csv",
    teams: "data/processed/team-current.json",
    wc26Teams: "data/manual/wc26-teams.csv",
    outputStrength: "data/manual/team-strength.csv",
    outputProfiles: "data/manual/team-tactical-profiles.csv",
    updatedAt: "2026-05-20"
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
    return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
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
  return String(name ?? "").trim().toLowerCase();
}

function num(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function minMax(value, values, fallback = 0.5) {
  if (!Number.isFinite(value)) return fallback;
  const finite = values.filter(Number.isFinite);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return fallback;
  return (value - min) / (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function styleFlags(style) {
  const text = String(style ?? "").toLowerCase();
  return {
    pressing: /press|pressing|high-energy|intensity/.test(text),
    counter: /counter|transition|direct|pace|quick/.test(text),
    possession: /possession|technical|build-up|passing/.test(text),
    defensive: /defensive|compact|organized|resolute|disciplined/.test(text),
    setPiece: /set-piece|aerial|physical/.test(text),
    creative: /flair|creative|expansive|attacking/.test(text)
  };
}

function styleTags(flags) {
  return [
    flags.pressing ? "pressing" : "",
    flags.counter ? "transition" : "",
    flags.possession ? "possession" : "",
    flags.defensive ? "compact" : "",
    flags.setPiece ? "setPieces" : "",
    flags.creative ? "creativeAttack" : ""
  ].filter(Boolean).join("|");
}

function label(value) {
  if (value >= 82) return "elite";
  if (value >= 77) return "strong";
  if (value >= 72) return "solid";
  if (value >= 67) return "limited";
  return "fragile";
}

const args = parseArgs(process.argv);
const strengthRows = readCsv(args.teamStrength);
const teams = JSON.parse(fs.readFileSync(args.teams, "utf8"));
const wcRows = readCsv(args.wc26Teams);
const teamByName = new Map(teams.map((team) => [norm(team.team), team]));
const wcByName = new Map(wcRows.map((row) => [norm(row.team), row]));

const marketValues = strengthRows.map((row) => Math.log(Math.max(1, num(row.marketValueEur) ?? 0))).filter(Number.isFinite);
const elos = teams.map((team) => team.elo).filter(Number.isFinite);
const fifaPoints = strengthRows.map((row) => num(row.fifaPoints)).filter(Number.isFinite);
const fifaRanks = strengthRows.map((row) => num(row.fifaRank)).filter(Number.isFinite);

const updatedStrength = [];
const profiles = [];
for (const row of strengthRows) {
  const team = row.team;
  const current = teamByName.get(norm(team));
  const wc = wcByName.get(norm(team)) ?? {};
  const market = num(row.marketValueEur);
  const fifaPoint = num(row.fifaPoints);
  const fifaRank = num(row.fifaRank);
  const marketScore = minMax(Math.log(Math.max(1, market ?? 0)), marketValues, 0.35);
  const eloScore = minMax(current?.elo, elos, 0.45);
  const fifaScore = fifaPoint !== null
    ? minMax(fifaPoint, fifaPoints, 0.45)
    : fifaRank !== null
      ? 1 - minMax(fifaRank, fifaRanks, 0.45)
      : 0.4;
  const formScore = clamp((current?.recentForm?.formScore ?? 0.25) / 0.75, 0, 1);
  const pedigree = clamp((Number(wc.worldCupTitles || 0) * 0.08) + (Number(wc.worldCupAppearances || 0) / 22) * 0.08, 0, 0.16);
  const composite =
    0.32 * marketScore +
    0.28 * eloScore +
    0.18 * fifaScore +
    0.17 * formScore +
    pedigree;
  const squadRating = clamp(62 + composite * 24, 62, 86.5);
  const flags = styleFlags(wc.playingStyle);
  const attackRating = clamp(squadRating + (flags.creative ? 2.2 : 0) + (flags.counter ? 1.2 : 0) + ((current?.recentForm?.goalDiffPerMatch ?? 0) * 0.7), 58, 90);
  const defenseRating = clamp(squadRating + (flags.defensive ? 2.2 : 0) + ((current?.recentForm?.cleanSheetRate ?? 0) - 0.3) * 5, 58, 90);
  const midfieldRating = clamp(squadRating + (flags.possession ? 2.0 : 0) + (flags.pressing ? 0.8 : 0), 58, 90);
  const transitionRating = clamp(squadRating + (flags.counter ? 2.6 : 0) + (flags.pressing ? 1.0 : 0), 58, 90);
  const setPieceRating = clamp(squadRating + (flags.setPiece ? 2.2 : 0) + (flags.defensive ? 0.6 : 0), 58, 90);
  const strengths = [
    attackRating >= 79 ? "front-line quality" : "",
    defenseRating >= 79 ? "defensive stability" : "",
    midfieldRating >= 79 ? "midfield control" : "",
    transitionRating >= 79 ? "transition threat" : "",
    setPieceRating >= 78 ? "set pieces" : "",
    current?.recentForm?.cleanSheetRate >= 0.5 ? "clean-sheet form" : "",
    current?.recentForm?.winRate >= 0.65 ? "winning momentum" : ""
  ].filter(Boolean).slice(0, 4);
  const weaknesses = [
    attackRating < 70 ? "limited finishing profile" : "",
    defenseRating < 70 ? "defensive vulnerability" : "",
    midfieldRating < 70 ? "can lose central control" : "",
    transitionRating < 70 ? "limited counter threat" : "",
    !market ? "market-value data missing" : "",
    !row.fifaPoints && !row.fifaRank ? "FIFA data missing" : ""
  ].filter(Boolean).slice(0, 3);

  updatedStrength.push({
    ...row,
    squadRating: squadRating.toFixed(2),
    ratingSource: "derived proxy: market value + Elo + FIFA + recent form + wc26 profile",
    updatedAt: args.updatedAt,
    dataStatus: [...new Set(String(row.dataStatus || "").split("|").filter(Boolean).concat(["squadRating"]))].join("|")
  });
  profiles.push({
    team,
    styleTags: styleTags(flags),
    attackRating: attackRating.toFixed(2),
    midfieldRating: midfieldRating.toFixed(2),
    defenseRating: defenseRating.toFixed(2),
    transitionRating: transitionRating.toFixed(2),
    setPieceRating: setPieceRating.toFixed(2),
    squadTier: label(squadRating),
    strengths: strengths.join("|") || "balanced profile",
    weaknesses: weaknesses.join("|") || "no major proxy weakness",
    playingStyle: wc.playingStyle || "",
    keyPlayers: wc.keyPlayers || "",
    source: "derived proxy from wc26 profile, team-current Elo/form, FIFA, and market value",
    updatedAt: args.updatedAt
  });
}

writeCsv(args.outputStrength, updatedStrength, ["team", "fifaRank", "fifaPoints", "squadRating", "marketValueEur", "marketValueSource", "ratingSource", "updatedAt", "fifaRankSource", "dataStatus"]);
writeCsv(args.outputProfiles, profiles, ["team", "styleTags", "attackRating", "midfieldRating", "defenseRating", "transitionRating", "setPieceRating", "squadTier", "strengths", "weaknesses", "playingStyle", "keyPlayers", "source", "updatedAt"]);

console.log(JSON.stringify({
  outputStrength: args.outputStrength,
  outputProfiles: args.outputProfiles,
  teams: updatedStrength.length,
  squadRatingRows: updatedStrength.filter((row) => row.squadRating).length,
  profileRows: profiles.length
}, null, 2));
