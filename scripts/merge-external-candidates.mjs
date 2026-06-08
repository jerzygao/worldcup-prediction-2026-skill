#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const desktop = path.join(process.env.USERPROFILE || process.env.HOME || ".", "Desktop");
  const args = {
    candidateDir: path.join(desktop, "世界杯预测Skill_外部AI_数据补全_2026-05-20"),
    suffix: "v3",
    updatedAt: "2026-05-20",
    announcements: "data/manual/wc26-squad-announcements.csv",
    players: "data/manual/wc26-squad-players.csv",
    positionRatings: "data/manual/squad-position-ratings.csv",
    availability: "data/manual/wc26-availability.csv",
    oddsSources: "references/odds-source-candidates.csv",
    knockoutRulesJson: "references/wc26-knockout-bracket-rules.json",
    knockoutRulesMd: "references/wc26-knockout-bracket-rules.md",
    report: "output/external-candidate-merge-report.md"
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

function norm(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function file(candidateDir, base, suffix) {
  return path.join(candidateDir, `${base}-${suffix}.csv`);
}

const announcementRank = new Map([
  ["official_fifa", 7],
  ["official_federation", 6],
  ["reported_final_crosschecked", 5],
  ["reported_single_source", 4],
  ["source_partial", 3],
  ["source_conflict", 2],
  ["needs_verification", 1],
  ["not_announced", 0]
]);
const playerRank = new Map([
  ["official", 5],
  ["reported", 4],
  ["source_partial", 3],
  ["source_conflict", 2],
  ["needs_verification", 1]
]);

function rank(map, value) {
  return map.get(value) ?? -1;
}

function betterAnnouncement(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (rank(announcementRank, b.rosterStatus) > rank(announcementRank, a.rosterStatus)) return b;
  if (rank(announcementRank, b.rosterStatus) < rank(announcementRank, a.rosterStatus)) return a;
  return (b.updatedAt || "") > (a.updatedAt || "") ? b : a;
}

function betterPlayer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (rank(playerRank, b.status) > rank(playerRank, a.status)) return b;
  if (rank(playerRank, b.status) < rank(playerRank, a.status)) return a;
  return (b.updatedAt || "") > (a.updatedAt || "") ? b : a;
}

function merge() {
  const args = parseArgs(process.argv);
  const candidateDir = path.resolve(args.candidateDir);
  const suffix = args.suffix;

  const candidateAnnouncements = readCsv(file(candidateDir, "wc26-squad-announcements-candidate", suffix));
  const candidatePlayers = readCsv(file(candidateDir, "wc26-squad-players-candidate", suffix));
  const candidateRatings = readCsv(file(candidateDir, "squad-rating-candidate", suffix));
  const candidateAvailability = readCsv(file(candidateDir, "wc26-availability-candidate", suffix));
  const candidateOdds = readCsv(file(candidateDir, "odds-source-candidates", suffix));

  const currentAnnouncements = readCsv(args.announcements);
  const currentPlayers = readCsv(args.players);
  const annByTeam = new Map();
  for (const row of currentAnnouncements) annByTeam.set(norm(row.team), row);
  for (const row of candidateAnnouncements) annByTeam.set(norm(row.team), betterAnnouncement(annByTeam.get(norm(row.team)), {
    ...row,
    updatedAt: row.updatedAt || args.updatedAt
  }));
  const announcements = [...annByTeam.values()].sort((a, b) => a.team.localeCompare(b.team));

  const completeCandidateTeams = new Set(
    candidateAnnouncements
      .filter((row) => {
        const count = Number(row.playerCount);
        if (!Number.isFinite(count) || count <= 0) return false;
        const rows = candidatePlayers.filter((player) => norm(player.team) === norm(row.team));
        return rows.length === count;
      })
      .map((row) => norm(row.team))
  );

  const playerByKey = new Map();
  for (const row of currentPlayers) {
    if (completeCandidateTeams.has(norm(row.team))) continue;
    playerByKey.set(`${norm(row.team)}|${norm(row.player)}`, row);
  }
  let skippedPlayers = 0;
  for (const row of candidatePlayers) {
    if (norm(row.player) === "diogo jota" && norm(row.team) === "portugal") {
      skippedPlayers += 1;
      continue;
    }
    const key = `${norm(row.team)}|${norm(row.player)}`;
    playerByKey.set(key, betterPlayer(playerByKey.get(key), {
      ...row,
      updatedAt: row.updatedAt || args.updatedAt
    }));
  }
  const players = [...playerByKey.values()].sort((a, b) => a.team.localeCompare(b.team) || a.positionGroup.localeCompare(b.positionGroup) || a.player.localeCompare(b.player));

  const ratings = candidateRatings.map((row) => ({
    team: row.team,
    squadRating: row.squadRating,
    goalkeeperRating: row.goalkeeperRating,
    defenseRating: row.defenseRating,
    midfieldRating: row.midfieldRating,
    attackRating: row.attackRating,
    ratingSource: row.ratingSource,
    ratingSourceUrl: row.ratingSourceUrl,
    updatedAt: row.updatedAt || args.updatedAt,
    status: row.status,
    notes: row.notes
  })).sort((a, b) => a.team.localeCompare(b.team));

  const availability = candidateAvailability
    .filter((row) => row.player)
    .map((row) => ({ ...row, updatedAt: row.updatedAt || args.updatedAt }))
    .sort((a, b) => a.team.localeCompare(b.team) || a.player.localeCompare(b.player));

  writeCsv(args.announcements, announcements, ["team", "announcementDate", "rosterType", "rosterStatus", "playerCount", "source", "sourceUrl", "updatedAt", "modelUse", "notes"]);
  writeCsv(args.players, players, ["team", "announcementDate", "rosterType", "positionGroup", "player", "club", "sourceUrl", "status", "updatedAt", "notes"]);
  writeCsv(args.positionRatings, ratings, ["team", "squadRating", "goalkeeperRating", "defenseRating", "midfieldRating", "attackRating", "ratingSource", "ratingSourceUrl", "updatedAt", "status", "notes"]);
  writeCsv(args.availability, availability, ["team", "player", "availabilityType", "status", "impactLevel", "source", "sourceUrl", "updatedAt", "notes"]);
  writeCsv(args.oddsSources, candidateOdds, ["provider", "sourceUrl", "coverage", "requiresApiKey", "hasWorldCup2026Market", "hasMatchOdds", "hasOutrightOdds", "accessMethod", "rateLimit", "notes"]);

  const jsonSource = path.join(candidateDir, `wc26-knockout-bracket-rules-${suffix}.json`);
  const mdSource = path.join(candidateDir, `wc26-knockout-bracket-rules-${suffix}.md`);
  if (fs.existsSync(jsonSource)) {
    const parsed = JSON.parse(fs.readFileSync(jsonSource, "utf8"));
    if (parsed.coverageStatus === "partial_only" && parsed.thirdPlaceMatrixComplete === false) {
      fs.mkdirSync(path.dirname(args.knockoutRulesJson), { recursive: true });
      fs.copyFileSync(jsonSource, args.knockoutRulesJson);
    }
  }
  if (fs.existsSync(mdSource)) {
    fs.mkdirSync(path.dirname(args.knockoutRulesMd), { recursive: true });
    fs.copyFileSync(mdSource, args.knockoutRulesMd);
  }

  const report = [
    "# 外部候选数据合并报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    `候选目录：${candidateDir}`,
    "",
    "## 输出结果",
    "",
    `- 名单公布：${announcements.length} 行`,
    `- 名单球员：${players.length} 行`,
    `- 位置评分：${ratings.length} 行`,
    `- 可用性上下文：${availability.length} 行`,
    `- 赔率来源候选：${candidateOdds.length} 行`,
    `- 跳过的葡萄牙 Diogo Jota 有效行：${skippedPlayers}`,
    "",
    "## 合并策略",
    "",
    "- 已有更强来源会优先于低等级候选行保留。",
    "- `needs_verification` 行只保留为上下文，不得驱动硬模型调整。",
    "- 淘汰赛规则文件仅在声明部分覆盖时复制，不用于替换当前模拟器。"
  ];
  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, `${report.join("\n")}\n`);
  console.log(JSON.stringify({ report: args.report, announcements: announcements.length, players: players.length, ratings: ratings.length, availability: availability.length, oddsSources: candidateOdds.length, skippedPlayers }, null, 2));
}

merge();
