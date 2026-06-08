#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    predictions: "output/match-predictions-2026.json",
    teams: "data/processed/team-current.json",
    iterations: "20000",
    outputJson: "output/tournament-simulation-2026.json",
    outputCsv: "output/group-qualification-2026.csv",
    seed: "20260520"
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] ?? "true";
      i += 1;
    }
  }
  return args;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function blankStats(team, group) {
  return { team, group, played: 0, points: 0, gf: 0, ga: 0, wins: 0, draws: 0, losses: 0 };
}

function addResult(table, team, gf, ga) {
  const row = table.get(team);
  row.played += 1;
  row.gf += gf;
  row.ga += ga;
  if (gf > ga) {
    row.points += 3;
    row.wins += 1;
  } else if (gf === ga) {
    row.points += 1;
    row.draws += 1;
  } else {
    row.losses += 1;
  }
}

function sampleScore(match, rand) {
  const r = rand();
  const h = match.homeWin;
  const d = match.draw;
  if (r < h) {
    const x = rand();
    if (x < 0.35) return [1, 0];
    if (x < 0.75) return [2, 1];
    if (x < 0.92) return [2, 0];
    return [3, 1];
  }
  if (r < h + d) {
    const x = rand();
    if (x < 0.22) return [0, 0];
    if (x < 0.82) return [1, 1];
    return [2, 2];
  }
  const x = rand();
  if (x < 0.35) return [0, 1];
  if (x < 0.75) return [1, 2];
  if (x < 0.92) return [0, 2];
  return [1, 3];
}

function sortTable(rows, rand) {
  return [...rows].sort((a, b) =>
    b.points - a.points ||
    (b.gf - b.ga) - (a.gf - a.ga) ||
    b.gf - a.gf ||
    b.wins - a.wins ||
    (rand() - 0.5)
  );
}

function knockoutWinProb(teamA, teamB, eloMap) {
  const eloA = eloMap.get(teamA) ?? 1500;
  const eloB = eloMap.get(teamB) ?? 1500;
  return 1 / (1 + 10 ** ((eloB - eloA) / 420));
}

function simulateKnockout(qualifiers, eloMap, rand) {
  // Approximation until official 2026 R32 bracket mapping is wired in:
  // seed qualified teams by group finish strength and pair high seed vs low seed.
  let seeds = qualifiers
    .map((q) => ({
      ...q,
      seedScore: q.rank * 1000 - q.points * 10 - (q.gf - q.ga) - (eloMap.get(q.team) ?? 1500) / 1000
    }))
    .sort((a, b) => a.seedScore - b.seedScore);
  const reached = new Map(seeds.map((q) => [q.team, { r32: 1, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 }]));
  let round = seeds.map((q) => q.team);
  const roundKeys = ["r16", "qf", "sf", "final", "champion"];
  for (const key of roundKeys) {
    const next = [];
    for (let i = 0; i < round.length / 2; i += 1) {
      const a = round[i];
      const b = round[round.length - 1 - i];
      const p = knockoutWinProb(a, b, eloMap);
      const winner = rand() < p ? a : b;
      reached.get(winner)[key] = 1;
      next.push(winner);
    }
    round = next;
  }
  return reached;
}

const args = parseArgs(process.argv);
const rand = mulberry32(Number(args.seed));
const data = JSON.parse(fs.readFileSync(args.predictions, "utf8"));
const teams = JSON.parse(fs.readFileSync(args.teams, "utf8"));
const eloMap = new Map(teams.map((row) => [row.team, row.elo]));
const iterations = Number(args.iterations);

const counts = new Map();
function ensure(team, group) {
  if (!counts.has(team)) {
    counts.set(team, {
      team,
      group,
      groupFirst: 0,
      groupSecond: 0,
      groupThird: 0,
      thirdAdvance: 0,
      advanceR32: 0,
      r16: 0,
      qf: 0,
      sf: 0,
      final: 0,
      champion: 0,
      out: 0,
      avgPoints: 0
    });
  }
  return counts.get(team);
}

for (const g of data.groups) for (const team of g.teams) ensure(team, g.group);

for (let iter = 0; iter < iterations; iter += 1) {
  const table = new Map();
  for (const g of data.groups) {
    for (const team of g.teams) table.set(team, blankStats(team, g.group));
  }
  for (const match of data.predictions) {
    const [hs, as] = sampleScore(match, rand);
    addResult(table, match.homeTeam, hs, as);
    addResult(table, match.awayTeam, as, hs);
  }
  const qualifiers = [];
  const thirds = [];
  for (const g of data.groups) {
    const sorted = sortTable(g.teams.map((team) => table.get(team)), rand);
    sorted.forEach((row, index) => {
      const c = ensure(row.team, row.group);
      c.avgPoints += row.points;
      if (index === 0) c.groupFirst += 1;
      else if (index === 1) c.groupSecond += 1;
      else if (index === 2) c.groupThird += 1;
    });
    qualifiers.push({ ...sorted[0], rank: 1 }, { ...sorted[1], rank: 2 });
    thirds.push({ ...sorted[2], rank: 3 });
  }
  const bestThirds = sortTable(thirds, rand).slice(0, 8);
  for (const row of bestThirds) ensure(row.team, row.group).thirdAdvance += 1;
  qualifiers.push(...bestThirds);
  for (const row of qualifiers) ensure(row.team, row.group).advanceR32 += 1;
  for (const row of [...table.values()]) {
    if (!qualifiers.some((q) => q.team === row.team)) ensure(row.team, row.group).out += 1;
  }

  const ko = simulateKnockout(qualifiers, eloMap, rand);
  for (const [team, reached] of ko.entries()) {
    const c = ensure(team, counts.get(team)?.group ?? "");
    for (const key of ["r16", "qf", "sf", "final", "champion"]) c[key] += reached[key];
  }
}

const rows = [...counts.values()]
  .map((c) => ({
    team: c.team,
    group: c.group,
    groupFirst: Number((c.groupFirst / iterations).toFixed(4)),
    groupSecond: Number((c.groupSecond / iterations).toFixed(4)),
    groupThird: Number((c.groupThird / iterations).toFixed(4)),
    thirdAdvance: Number((c.thirdAdvance / iterations).toFixed(4)),
    advanceR32: Number((c.advanceR32 / iterations).toFixed(4)),
    r16: Number((c.r16 / iterations).toFixed(4)),
    qf: Number((c.qf / iterations).toFixed(4)),
    sf: Number((c.sf / iterations).toFixed(4)),
    final: Number((c.final / iterations).toFixed(4)),
    champion: Number((c.champion / iterations).toFixed(4)),
    out: Number((c.out / iterations).toFixed(4)),
    avgPoints: Number((c.avgPoints / iterations).toFixed(3))
  }))
  .sort((a, b) => b.champion - a.champion || b.advanceR32 - a.advanceR32);

const result = {
  generatedAt: new Date().toISOString(),
  iterations,
  caveat: "Group qualification uses 2026 top-2 plus best-8 third-place format. Knockout probabilities use an approximate high-vs-low seeded bracket until official R32 mapping is connected.",
  teams: rows,
  topChampion: rows.slice(0, 16),
  groupTables: Object.fromEntries(data.groups.map((g) => [g.group, rows.filter((row) => row.group === g.group).sort((a, b) => b.advanceR32 - a.advanceR32)]))
};

fs.mkdirSync(path.dirname(args.outputJson), { recursive: true });
fs.writeFileSync(args.outputJson, JSON.stringify(result, null, 2));
writeCsv(args.outputCsv, rows, ["team", "group", "groupFirst", "groupSecond", "groupThird", "thirdAdvance", "advanceR32", "r16", "qf", "sf", "final", "champion", "out", "avgPoints"]);
console.log(JSON.stringify({ outputJson: args.outputJson, outputCsv: args.outputCsv, iterations, teams: rows.length }, null, 2));
