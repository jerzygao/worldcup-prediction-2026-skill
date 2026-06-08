#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function cleanOdds(odds) {
  const raw = {
    home: 1 / odds.home,
    draw: 1 / odds.draw,
    away: 1 / odds.away
  };
  const total = raw.home + raw.draw + raw.away;
  return {
    home: raw.home / total,
    draw: raw.draw / total,
    away: raw.away / total,
    overround: total - 1
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error("Usage: node scripts/clean-odds.mjs --input data/sample/matches.json");
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(args.input, "utf8"));
  const cleaned = rows.map((row) => ({
    matchId: row.matchId,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    cleanedOdds: cleanOdds(row.odds)
  }));
  console.log(JSON.stringify(cleaned, null, 2));
}
