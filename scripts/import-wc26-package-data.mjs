#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    packageDir: ".tmp/wc26/package/dist/data",
    outputDir: "data/manual"
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] ?? "true";
      i += 1;
    }
  }
  return args;
}

async function loadModule(filePath) {
  const url = new URL(`file:///${path.resolve(filePath).replaceAll("\\", "/")}`);
  return import(url.href);
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

function parseAmericanOdds(odds) {
  const n = Number(String(odds).replace("+", ""));
  if (!Number.isFinite(n)) return "";
  if (n > 0) return Number((n / 100 + 1).toFixed(4));
  return Number((100 / Math.abs(n) + 1).toFixed(4));
}

function impliedToDecimal(pct) {
  const p = Number(String(pct).replace("%", "")) / 100;
  return p > 0 ? Number((1 / p).toFixed(4)) : "";
}

const args = parseArgs(process.argv);
const teamsModule = await loadModule(path.join(args.packageDir, "teams.js"));
const oddsModule = await loadModule(path.join(args.packageDir, "odds.js"));
const injuriesModule = await loadModule(path.join(args.packageDir, "injuries.js"));
const profilesModule = await loadModule(path.join(args.packageDir, "team-profiles.js"));

const teams = teamsModule.teams ?? [];
const teamById = new Map(teams.map((t) => [t.id, t]));
const profiles = new Map((profilesModule.teamProfiles ?? []).map((p) => [p.team_id, p]));

writeCsv(
  path.join(args.outputDir, "wc26-teams.csv"),
  teams.map((t) => {
    const p = profiles.get(t.id) ?? {};
    return {
      team: t.name,
      teamId: t.id,
      code: t.code,
      wc26PackageGroup: t.group,
      confederation: t.confederation,
      fifaRank: t.fifa_ranking,
      isHost: t.is_host,
      coach: p.coach ?? "",
      playingStyle: p.playing_style ?? "",
      keyPlayers: (p.key_players ?? []).map((x) => `${x.name} (${x.position}, ${x.club})`).join("; "),
      worldCupAppearances: p.world_cup_history?.appearances ?? "",
      worldCupTitles: p.world_cup_history?.titles ?? "",
      bestResult: p.world_cup_history?.best_result ?? "",
      source: "wc26-mcp package 0.3.1"
    };
  }),
  ["team", "teamId", "code", "wc26PackageGroup", "confederation", "fifaRank", "isHost", "coach", "playingStyle", "keyPlayers", "worldCupAppearances", "worldCupTitles", "bestResult", "source"]
);

const odds = oddsModule.tournamentOdds ?? {};
writeCsv(
  path.join(args.outputDir, "wc26-tournament-winner-odds.csv"),
  (odds.tournament_winner ?? []).map((o) => ({
    team: teamById.get(o.team_id)?.name ?? o.team_id,
    teamId: o.team_id,
    americanOdds: o.odds,
    decimalOdds: parseAmericanOdds(o.odds) || impliedToDecimal(o.implied_probability),
    impliedProbability: o.implied_probability,
    lastUpdated: odds.last_updated,
    source: odds.source
  })),
  ["team", "teamId", "americanOdds", "decimalOdds", "impliedProbability", "lastUpdated", "source"]
);

writeCsv(
  path.join(args.outputDir, "wc26-injuries.csv"),
  (injuriesModule.injuries ?? []).map((x) => ({
    team: teamById.get(x.team_id)?.name ?? x.team_id,
    teamId: x.team_id,
    player: x.player,
    position: x.position,
    status: x.status,
    injury: x.injury,
    expectedReturn: x.expected_return,
    lastUpdated: x.last_updated,
    source: x.source
  })),
  ["team", "teamId", "player", "position", "status", "injury", "expectedReturn", "lastUpdated", "source"]
);

console.log(JSON.stringify({
  outputDir: args.outputDir,
  teams: teams.length,
  winnerOdds: odds.tournament_winner?.length ?? 0,
  injuries: injuriesModule.injuries?.length ?? 0
}, null, 2));
