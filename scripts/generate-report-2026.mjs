#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    predictions: "output/match-predictions-2026.json",
    simulation: "output/tournament-simulation-2026.json",
    squadAnnouncements: "data/manual/wc26-squad-announcements.csv",
    output: "output/world-cup-2026-report.md"
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] ?? "true";
      i += 1;
    }
  }
  return args;
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function probLine(match) {
  return `${match.homeTeam} vs ${match.awayTeam}: ${pct(match.homeWin)} / ${pct(match.draw)} / ${pct(match.awayWin)}，比分 ${match.predictedScore}，冷门风险 ${match.upsetRisk}`;
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
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

const args = parseArgs(process.argv);
const predictions = JSON.parse(fs.readFileSync(args.predictions, "utf8"));
const simulation = JSON.parse(fs.readFileSync(args.simulation, "utf8"));
const squadAnnouncements = readCsv(args.squadAnnouncements);

const strongest = predictions.rankings.strongestFavorites.slice(0, 10);
const upset = predictions.rankings.upsetRisk.slice(0, 10);
const close = predictions.rankings.closestMatches.slice(0, 10);
const champion = simulation.topChampion.slice(0, 12);
const byDate = new Map();
for (const m of predictions.predictions) {
  if (!byDate.has(m.date)) byDate.set(m.date, []);
  byDate.get(m.date).push(m);
}

const lines = [];
lines.push("# 2026 世界杯预测报告");
lines.push("");
lines.push(`生成时间：${new Date().toISOString()}`);
lines.push("");
lines.push("## 模型提示");
lines.push("");
lines.push("- 小组赛概率使用已校准 softmax 模型，并叠加可用赛前特征。");
lines.push("- 当前批量运行的 72 场比赛没有真实赛前赔率；可用时使用 FIFA、Elo、近期状态、身价和派生阵容/战术代理值。");
lines.push("- 名单公布行只用于阵容新鲜度上下文，不代表确认首发、伤病或比赛日可用性。");
lines.push("- 淘汰赛概率是近似值，因为官方 32 强交叉映射尚未完整接入；当前模拟使用高种子对低种子的启发式规则。");
lines.push("");

if (squadAnnouncements.length) {
  lines.push("## 最新名单公布情况");
  lines.push("");
  lines.push(table(
    ["球队", "日期", "类型", "状态", "人数", "模型用途"],
    squadAnnouncements.map((row) => [
      row.team,
      row.announcementDate,
      row.rosterType,
      row.rosterStatus,
      row.playerCount,
      row.modelUse
    ])
  ));
  lines.push("");
}

lines.push("## 夺冠概率");
lines.push("");
lines.push(table(
  ["排名", "球队", "小组", "32强", "8强", "4强", "决赛", "冠军"],
  champion.map((row, i) => [
    i + 1,
    row.team,
    row.group,
    pct(row.advanceR32),
    pct(row.qf),
    pct(row.sf),
    pct(row.final),
    pct(row.champion)
  ])
));
lines.push("");

lines.push("## 小组出线概率");
lines.push("");
for (const group of Object.keys(simulation.groupTables).sort()) {
  const rows = simulation.groupTables[group].slice(0, 4);
  lines.push(`### ${group} 组`);
  lines.push("");
  lines.push(table(
    ["球队", "第1", "第2", "第3", "晋级", "出局", "平均分"],
    rows.map((row) => [
      row.team,
      pct(row.groupFirst),
      pct(row.groupSecond),
      pct(row.groupThird),
      pct(row.advanceR32),
      pct(row.out),
      row.avgPoints.toFixed(2)
    ])
  ));
  lines.push("");
}

lines.push("## 最稳热门");
lines.push("");
lines.push(table(
  ["日期", "小组", "比赛", "热门胜率", "主/平/客"],
  strongest.map((m) => [
    m.date,
    m.group,
    `${m.homeTeam} vs ${m.awayTeam}`,
    pct(m.favoriteProbability),
    `${pct(m.homeWin)} / ${pct(m.draw)} / ${pct(m.awayWin)}`
  ])
));
lines.push("");

lines.push("## 最高爆冷风险 / 最接近比赛");
lines.push("");
lines.push(table(
  ["日期", "小组", "比赛", "热门胜率", "主/平/客"],
  upset.map((m) => [
    m.date,
    m.group,
    `${m.homeTeam} vs ${m.awayTeam}`,
    pct(m.favoriteProbability),
    `${pct(m.homeWin)} / ${pct(m.draw)} / ${pct(m.awayWin)}`
  ])
));
lines.push("");

lines.push("## 每日比赛简报");
lines.push("");
for (const [date, matches] of [...byDate.entries()].sort()) {
  lines.push(`### ${date}`);
  lines.push("");
  for (const match of matches) lines.push(`- ${probLine(match)}`);
  lines.push("");
}

fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ output: args.output, dates: byDate.size, matches: predictions.predictions.length }, null, 2));
