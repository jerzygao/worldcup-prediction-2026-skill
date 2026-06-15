#!/usr/bin/env node
/**
 * sync-worldcup-results.mjs
 *
 * 将 prediction-log.json 中已验证的赛果同步到 data/results.csv，
 * 让主预测管线（build-elo-form → batch-predict）能用到最新赛果。
 *
 * 用法：
 *   node scripts/sync-worldcup-results.mjs
 *   node scripts/sync-worldcup-results.mjs --dry-run   # 只预览不改
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, "..");

const ARGS = { dryRun: false };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--dry-run") ARGS.dryRun = true;
}

const RESULTS_PATH = resolve(SKILL_DIR, "data/results.csv");
const LOG_PATH = resolve(SKILL_DIR, "output/prediction-log.json");

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { cells.push(current); current = ""; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

function formatCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function main() {
  // 读取 prediction-log
  if (!existsSync(LOG_PATH)) {
    console.log("prediction-log.json 不存在，无数据可同步");
    return;
  }
  const log = JSON.parse(readFileSync(LOG_PATH, "utf8"));
  const completed = log.filter(r => r.actual_score && r.actual_score !== "待更新" && !isNaN(r.actual_home_goals));
  if (!completed.length) {
    console.log("prediction-log.json 中没有已验证的赛果");
    return;
  }

  // 读取 results.csv
  const raw = readFileSync(RESULTS_PATH, "utf8");
  const lines = raw.split(/\r?\n/);
  if (!lines.length) { console.error("results.csv 为空"); process.exit(1); }

  const headers = parseCsvLine(lines[0]);
  const dateIdx = headers.indexOf("date");
  const homeIdx = headers.indexOf("home_team");
  const awayIdx = headers.indexOf("away_team");
  const hgIdx = headers.indexOf("home_score");
  const agIdx = headers.indexOf("away_score");

  if ([dateIdx, homeIdx, awayIdx, hgIdx, agIdx].some(i => i === -1)) {
    console.error("results.csv 缺少必要列:", headers);
    process.exit(1);
  }

  // 队名映射：prediction-log 英文名 → results.csv 队名
  const NAME_MAP = {
    "United States": "United States",
    "South Korea": "South Korea",
    "Czech Republic": "Czech Republic",
    "Bosnia and Herzegovina": "Bosnia and Herzegovina",
    "Ivory Coast": "Ivory Coast",
    "DR Congo": "DR Congo",
    "Turkey": "Turkey",
    // 其余直接匹配
  };

  function norm(name) {
    return name ? (NAME_MAP[name] || name).replace(/\s+/g, " ").trim() : "";
  }

  let updated = 0;
  let notFound = 0;

  const newLines = lines.map((line, idx) => {
    if (idx === 0) return line; // header
    const cells = parseCsvLine(line);
    const lineDate = cells[dateIdx];
    const lineHome = norm(cells[homeIdx]);
    const lineAway = norm(cells[awayIdx]);
    const lineHg = cells[hgIdx];
    const lineAg = cells[agIdx];

    // 如果已经有实际比分，跳过
    if (lineHg !== "NA" && lineAg !== "NA" && !isNaN(Number(lineHg))) return line;

    // 查找匹配：只按队名匹，不卡日期（防止 prediction-log 日期字段不准确）
    for (const r of completed) {
      const [logHome, logAway] = r.match.split(" vs ");
      if (norm(logHome) === lineHome && norm(logAway) === lineAway) {
        cells[hgIdx] = String(r.actual_home_goals);
        cells[agIdx] = String(r.actual_away_goals);
        updated++;
        return cells.map(formatCsvCell).join(",");
      }
    }
    return line;
  });

  if (updated === 0) {
    console.log("未找到可同步的赛果（可能已同步过）");
    return;
  }

  const output = newLines.join("\n") + "\n";

  if (ARGS.dryRun) {
    console.log(`[DRY RUN] 将更新 ${updated} 场赛果:`);
    for (const r of completed) {
      // 检查是否在 results.csv 中匹配到了
      const [h, a] = r.match.split(" vs ");
      const matched = newLines.some((line, idx) => {
        if (idx === 0) return false;
        const c = parseCsvLine(line);
        return norm(c[homeIdx]) === norm(h) && norm(c[awayIdx]) === norm(a);
      });
      if (matched) console.log(`  ${r.date} ${r.match}: ${r.actual_score}`);
    }
  } else {
    // 备份
    writeFileSync(RESULTS_PATH + ".bak", raw, "utf8");
    writeFileSync(RESULTS_PATH, output, "utf8");
    console.log(`✅ 已更新 ${updated} 场赛果到 results.csv（备份: results.csv.bak）`);
  }
}

main();
