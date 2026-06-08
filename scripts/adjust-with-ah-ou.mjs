#!/usr/bin/env node

/**
 * adjust-with-ah-ou.mjs
 *
 * 亚盘(Asian Handicap) + 大小球(Over/Under) 后处理层。
 * 零侵入设计——不修改原版模型路径，只追加增强报告。
 *
 * Usage:
 *   node scripts/adjust-with-ah-ou.mjs
 *   node scripts/adjust-with-ah-ou.mjs --limit=5
 */

import { load } from "cheerio";
import iconv from "iconv-lite";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, "..");

const ARGS = {
  mapping: resolve(SKILL_DIR, "data/manual/titan007-match-ids.csv"),
  predictions: resolve(SKILL_DIR, "output/match-predictions-2026.csv"),
  output: resolve(SKILL_DIR, "output/match-predictions-ah-enhanced.csv"),
  report: resolve(SKILL_DIR, "output/ah-ou-market-report.md"),
  limit: 0,
};

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith("--predictions=")) ARGS.predictions = arg.split("=")[1];
  else if (arg.startsWith("--output=")) ARGS.output = arg.split("=")[1];
  else if (arg.startsWith("--report=")) ARGS.report = arg.split("=")[1];
  else if (arg.startsWith("--limit=")) ARGS.limit = parseInt(arg.split("=")[1]) || 0;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
function norm(s) { return (s ?? "").replace(/[\s\u00A0\u3000\t\n\r]+/g, " ").trim(); }
function looksUtf8(buf) { const s = buf.slice(0, 1000).toString("utf8"); return (s.match(/[\u4e00-\u9fff]/g) || []).length > 0; }

async function fetchText(url, referer) {
  const headers = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9" };
  if (referer) headers["Referer"] = referer;
  const res = await fetch(url, { headers });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("utf-8") || looksUtf8(buf)) return buf.toString("utf8");
  try { return iconv.decode(buf, "gb2312"); } catch { return iconv.decode(buf, "gbk"); }
}

function parseCsv(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const row = {};
    headers.forEach((h, i) => row[h.trim()] = (vals[i] || "").trim());
    return row;
  });
}

function parseAsian(html) {
  const $ = load(html, { decodeEntities: false });
  const fullText = norm($.text());
  const upMatch = fullText.match(/升盘\s*(\d+)/);
  const downMatch = fullText.match(/降盘\s*(\d+)/);
  const highMatch = fullText.match(/高水\s*(\d+)/);
  const lowMatch = fullText.match(/低水\s*(\d+)/);
  const upCount = upMatch ? parseInt(upMatch[1]) : 0;
  const downCount = downMatch ? parseInt(downMatch[1]) : 0;
  const highWater = highMatch ? parseInt(highMatch[1]) : 0;
  const lowWater = lowMatch ? parseInt(lowMatch[1]) : 0;
  const lines = new Set();
  const entries = [];
  $("table tr").each((_, tr) => {
    const rowText = norm($(tr).text());
    if (rowText.length < 5) return;
    const hcpM = rowText.match(/(受球半\/两)|(受两半\/三)|(受一\/球半)|(受球半)|(受半\/一)|(受两球半)|(受三球半\/四球?)|(受三球)|(受一球)|(受两球)|(受两\/两半)|(受半球)|(受平\/半)|(球半\/两)|(两半\/三)|(一\/球半)|(球半)|(半\/一)|(两球半)|(三球半\/四球?)|(三\/三半)|(一球)|(两球)|(三球)|(四球)|(两\/两半)|(平\/半)|(半球)|(平手)/);
    if (!hcpM) return;
    lines.add(hcpM[0]);
    const nums = [...rowText.matchAll(/[\d.]+/g)].map(m => parseFloat(m[0]));
    if (nums.length >= 2 && nums[0] >= 0.4 && nums[0] <= 1.6) entries.push({ line: hcpM[0], odds: nums[0] });
  });
  let signal = 0;
  const reasons = [];
  if (upCount > downCount + 2) { signal += 1.5; reasons.push(`升盘${upCount}家远超降盘${downCount}家，市场看好让球方`); }
  else if (downCount > upCount + 2) { signal -= 1.5; reasons.push(`降盘${downCount}家远超升盘${upCount}家，市场看衰让球方`); }
  if (lowWater > highWater + 3) { signal += 1; reasons.push(`低水${lowWater}家多于高水${highWater}家，让球方赔付压力小`); }
  else if (highWater > lowWater + 3) { signal -= 0.5; reasons.push(`高水${highWater}家多于低水${lowWater}家，让球方阻力大`); }
  return { summary: { upCount, downCount, highWater, lowWater }, lineCount: lines.size, lines: [...lines], entries: entries.slice(0, 20), signal: Number(signal.toFixed(1)), direction: signal > 0.5 ? "favor_favorite" : signal < -0.5 ? "favor_underdog" : "neutral", reasons };
}

function parseOverUnder(html) {
  const $ = load(html, { decodeEntities: false });
  const upGoal = parseInt($("#upGoal").text()) || parseInt($("#upBall").text()) || 0;
  const downGoal = parseInt($("#downGoal").text()) || parseInt($("#downBall").text()) || 0;
  let mainLine = null, mainOver = null, mainUnder = null;
  const validLines = new Set([0.5, 1, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4]);
  $("tr").each((_, tr) => {
    const rowText = norm($(tr).text());
    if (rowText.length < 5) return;
    const triplet = rowText.match(/^.*?([\d.]+)\s+(\d+(?:\.\d+)?)\s+([\d.]+(?: |$))/);
    if (!triplet) return;
    const overOdds = parseFloat(triplet[1]), lineVal = parseFloat(triplet[2]), underOdds = parseFloat(triplet[3]);
    if (!validLines.has(lineVal)) return;
    if (overOdds < 0.4 || overOdds > 1.6 || underOdds < 0.4 || underOdds > 1.6) return;
    if (mainLine === null || lineVal === 2.5) { mainLine = lineVal; mainOver = overOdds; mainUnder = underOdds; }
  });
  const direction = downGoal > upGoal ? "under" : upGoal > downGoal ? "over" : "neutral";
  return { summary: { upCount: upGoal, downCount: downGoal }, mainLine: mainLine ? String(mainLine) : null, mainOver, mainUnder, direction };
}

async function main() {
  console.log("=== Asian Handicap + Over/Under Adjustment Layer ===\n");
  const mapping = parseCsv(ARGS.mapping);
  console.log(`Mapping: ${mapping.length} matches`);
  const predictions = parseCsv(ARGS.predictions);
  console.log(`Predictions: ${predictions.length} matches\n`);
  const predLookup = {};
  for (const p of predictions) predLookup[p.matchId] = p;
  const results = [];
  let success = 0;
  const toProcess = ARGS.limit > 0 ? mapping.slice(0, ARGS.limit) : mapping;
  for (let i = 0; i < toProcess.length; i++) {
    const m = toProcess[i];
    process.stdout.write(`  [${i + 1}/${toProcess.length}] ${m.xiaoshi_id} `);
    try {
      const [asianHtml, ouHtml] = await Promise.all([
        fetchText(`https://vip.titan007.com/AsianOdds_n.aspx?id=${m.titan007_id}`, "https://2026.titan007.com/"),
        fetchText(`https://vip.titan007.com/OverDown_n.aspx?id=${m.titan007_id}`, "https://2026.titan007.com/"),
      ]);
      const ah = parseAsian(asianHtml);
      const ou = parseOverUnder(ouHtml);
      const pred = predLookup[m.xiaoshi_id] || {};
      results.push({
        matchId: m.xiaoshi_id, home: m.home, away: m.away,
        predHomeWin: pred.homeWinPct || "", predDraw: pred.drawPct || "", predAwayWin: pred.awayWinPct || "",
        ahUp: ah.summary.upCount, ahDown: ah.summary.downCount, ahHighWater: ah.summary.highWater, ahLowWater: ah.summary.lowWater,
        ahSignal: ah.signal, ahDirection: ah.direction, ahLineCount: ah.lineCount,
        ouUp: ou.summary.upCount, ouDown: ou.summary.downCount, ouMainLine: ou.mainLine || "", ouDirection: ou.direction,
        reasons: ah.reasons.join("; "),
      });
      console.log(`✓ AH: up=${ah.summary.upCount} down=${ah.summary.downCount} sig=${ah.signal} | OU: ${ou.direction}`);
      success++;
    } catch (e) { console.log(`✗ ${e.message.slice(0, 60)}`); }
    if (i < toProcess.length - 1) await new Promise(r => setTimeout(r, 250 + Math.random() * 150));
  }
  if (results.length > 0) {
    const fields = ["matchId", "home", "away", "predHomeWin", "predDraw", "predAwayWin", "ahUp", "ahDown", "ahHighWater", "ahLowWater", "ahSignal", "ahDirection", "ahLineCount", "ouUp", "ouDown", "ouMainLine", "ouDirection", "reasons"];
    const header = fields.join(",");
    const lines = results.map(r => fields.map(f => { const v = r[f] ?? ""; return String(v).includes(",") ? `"${v}"` : v; }).join(","));
    writeFileSync(ARGS.output, [header, ...lines].join("\n") + "\n");
    console.log(`\nWritten ${results.length} rows to ${ARGS.output}`);
  }
  const strongAh = results.filter(r => Math.abs(Number(r.ahSignal)) >= 1);
  const overCount = results.filter(r => r.ouDirection === "over").length;
  const underCount = results.filter(r => r.ouDirection === "under").length;
  const reportLines = [
    "# 亚盘&大小球市场情绪报告", `生成时间: ${new Date().toISOString()}`, `覆盖场次: ${results.length}/${mapping.length}`, "",
    "---", "", "## 亚盘信号较强的比赛", "", "| 比赛 | 方向 | 信号值 | 升/降 | 高/低水 | 原因 |",
    "|------|------|--------|--------|----------|------|",
  ];
  for (const r of strongAh) {
    const dir = r.ahDirection === "favor_favorite" ? "看好让球方" : "看好受让方";
    reportLines.push(`| ${r.home} vs ${r.away} | ${dir} | ${r.ahSignal} | ${r.ahUp}/${r.ahDown} | ${r.ahHighWater}/${r.ahLowWater} | ${(r.reasons || "").slice(0, 60)} |`);
  }
  reportLines.push("", "## 大小球方向统计", "", `- 倾向大球: ${overCount} 场`, `- 倾向小球: ${underCount} 场`, `- 盘口稳定: ${results.length - overCount - underCount} 场`, "");
  writeFileSync(ARGS.report, reportLines.join("\n") + "\n");
  console.log(`Written market report to ${ARGS.report}`);
  console.log("Done!");
}

main().catch(e => { console.error("Fatal error:", e); process.exit(1); });