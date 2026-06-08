#!/usr/bin/env node

/**
 * import-titan007-odds.mjs
 *
 * 从 titan007 (球探网) 导入欧赔数据，补充到 match-odds.csv。
 * 零侵入设计——只读写数据文件，不改原版预测管线。
 *
 * Usage:
 *   node scripts/import-titan007-odds.mjs
 *   node scripts/import-titan007-odds.mjs --limit=5
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
  out: resolve(SKILL_DIR, "data/manual/match-odds.csv"),
  limit: 0,
};

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith("--mapping=")) ARGS.mapping = arg.split("=")[1];
  else if (arg.startsWith("--out=")) ARGS.out = arg.split("=")[1];
  else if (arg.startsWith("--limit=")) ARGS.limit = parseInt(arg.split("=")[1]) || 0;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function norm(s) { return (s ?? "").replace(/[\s\u00A0\u3000\t\n\r]+/g, " ").trim(); }

function looksUtf8(buf) {
  const sample = buf.slice(0, 1000).toString("utf8");
  return (sample.match(/[\u4e00-\u9fff]/g) || []).length > 0;
}

async function fetchText(url, referer) {
  const headers = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
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
  if (lines.length === 0) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const row = {};
    headers.forEach((h, i) => row[h.trim()] = (vals[i] || "").trim());
    return row;
  });
}

function writeCsv(path, rows, fields) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const header = fields.join(",");
  const lines = rows.map(row => fields.map(f => {
    const v = row[f] ?? "";
    return v.includes(",") ? `"${v}"` : v;
  }).join(","));
  const existing = existsSync(path) ? readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim() : "";
  const newContent = [header, ...lines].join("\n") + "\n";
  if (existing && existing.startsWith(header)) {
    const existingRows = new Set(existing.split("\n").slice(1).filter(l => l.trim()));
    const newRows = lines.filter(l => !existingRows.has(l));
    if (newRows.length === 0) { console.log(`  No new odds data to write.`); return; }
    writeFileSync(path, existing + newRows.join("\n") + "\n");
    console.log(`  Appended ${newRows.length} new rows.`);
  } else {
    writeFileSync(path, newContent);
    console.log(`  Wrote ${lines.length} rows.`);
  }
}

function parseEuroFromJS(jsText) {
  const gameMatch = jsText.match(/var game=Array\(([\s\S]*?)\);\s*(?:var|$)/);
  if (!gameMatch) return null;
  const raw = gameMatch[1];
  const entries = raw.split(/\"\s*,\s*\"/).map(s => s.replace(/^[\s\n\r]*\"|\"[\s\n\r]*$/g, "").trim()).filter(Boolean);
  if (entries.length === 0) return null;
  const allCurs = [];
  for (const entry of entries) {
    const parts = entry.split("|");
    if (parts.length < 10) continue;
    const curWin = parts[10] ? parseFloat(parts[10]) : NaN;
    const curDraw = parts[11] ? parseFloat(parts[11]) : NaN;
    const curLoss = parts[12] ? parseFloat(parts[12]) : NaN;
    if (!isNaN(curWin) && !isNaN(curDraw) && !isNaN(curLoss)) allCurs.push({ win: curWin, draw: curDraw, loss: curLoss });
  }
  if (allCurs.length === 0) return null;
  const avg = (arr, key) => arr.reduce((s, x) => s + x[key], 0) / arr.length;
  return { current: { win: Number(avg(allCurs, "win").toFixed(4)), draw: Number(avg(allCurs, "draw").toFixed(4)), loss: Number(avg(allCurs, "loss").toFixed(4)) }, companyCount: allCurs.length };
}

async function fetchEuroOdds(titan007Id) {
  const jsUrl = `https://1x2d.titan007.com/${titan007Id}.js`;
  try {
    const jsText = await fetchText(jsUrl, "https://op1.titan007.com/");
    const result = parseEuroFromJS(jsText);
    if (result) return result;
  } catch { /* fall through */ }
  return null;
}

async function main() {
  console.log("=== Titan007 European Odds Importer ===\n");
  const mapping = parseCsv(ARGS.mapping);
  console.log(`Mapping: ${mapping.length} matches loaded`);
  const now = new Date().toISOString();
  const oddsRows = [];
  let success = 0, failed = 0;
  const toProcess = ARGS.limit > 0 ? mapping.slice(0, ARGS.limit) : mapping;
  console.log(`Fetching odds for ${toProcess.length} matches...\n`);
  for (let i = 0; i < toProcess.length; i++) {
    const m = toProcess[i];
    process.stdout.write(`  [${i + 1}/${toProcess.length}] ${m.xiaoshi_id} (titan007:${m.titan007_id}) `);
    try {
      const odds = await fetchEuroOdds(m.titan007_id);
      if (odds && odds.current.win > 0) {
        oddsRows.push({
          date: m.date || "", homeTeam: m.home, awayTeam: m.away,
          bookmaker: "titan007 consensus average",
          homeOdds: String(odds.current.win), drawOdds: String(odds.current.draw), awayOdds: String(odds.current.loss),
          timestamp: now, sourceUrl: `https://1x2d.titan007.com/${m.titan007_id}.js`,
        });
        console.log(`✓ home=${odds.current.win} draw=${odds.current.draw} away=${odds.current.loss} (${odds.companyCount} companies)`);
        success++;
      } else { console.log("✗ no odds data"); failed++; }
    } catch (e) { console.log(`✗ error: ${e.message.slice(0, 60)}`); failed++; }
    if (i < toProcess.length - 1) await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
  }
  console.log(`\n--- Summary ---\n  Success: ${success}/${toProcess.length}\n  Failed: ${failed}/${toProcess.length}`);
  if (oddsRows.length > 0) {
    writeCsv(ARGS.out, oddsRows, ["date", "homeTeam", "awayTeam", "bookmaker", "homeOdds", "drawOdds", "awayOdds", "timestamp", "sourceUrl"]);
    console.log("Done! Titan007 odds added to match-odds.csv");
  }
}

main().catch(e => { console.error("Fatal error:", e); process.exit(1); });