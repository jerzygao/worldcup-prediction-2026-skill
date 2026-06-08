#!/usr/bin/env node

/**
 * fetch-jingcai-odds.mjs
 *
 * 竞彩推荐方案生成器。
 * 读取预存的体彩赛程数据 + 模型预测，输出推荐方案。
 *
 * Usage:
 *   node scripts/fetch-jingcai-odds.mjs --only-worldcup
 *   node scripts/fetch-jingcai-odds.mjs --date=2026-06-11
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, "..");

const ARGS = { date: "", onlyWorldCup: false,
  schedule: resolve(SKILL_DIR, "data/manual/jingcai-schedule.json"),
  predFile: resolve(SKILL_DIR, "output/match-predictions-2026.csv"),
  ahFile: resolve(SKILL_DIR, "output/match-predictions-ah-enhanced.csv"),
  out: resolve(SKILL_DIR, "output/jingcai-recommendations.md"),
};

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--date=")) ARGS.date = a.split("=")[1];
  else if (a === "--only-worldcup") ARGS.onlyWorldCup = true;
  else if (a.startsWith("--out=")) ARGS.out = a.split("=")[1];
}

const NORM = s => (s ?? "").replace(/\s+/g, " ").trim();

function readCSV(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").replace(/^\uFEFF/, "").split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const h = lines[0].split(",").map(s => s.trim());
  return lines.slice(1).map(l => { const v = l.split(","); const o = {}; h.forEach((k, i) => o[k] = (v[i] || "").trim()); return o; });
}

const MAP = {
  "墨西哥":"Mexico","南非":"South Africa","韩国":"South Korea","捷克":"Czech Republic",
  "加拿大":"Canada","波黑":"Bosnia and Herzegovina","美国":"United States","巴拉圭":"Paraguay",
  "卡塔尔":"Qatar","瑞士":"Switzerland","巴西":"Brazil","摩洛哥":"Morocco",
  "海地":"Haiti","苏格兰":"Scotland","澳大利亚":"Australia","土耳其":"Turkey",
  "德国":"Germany","库拉索":"Curaçao","科特迪瓦":"Ivory Coast","厄瓜多尔":"Ecuador",
  "荷兰":"Netherlands","日本":"Japan","瑞典":"Sweden","突尼斯":"Tunisia",
  "比利时":"Belgium","埃及":"Egypt","伊朗":"Iran","新西兰":"New Zealand",
  "西班牙":"Spain","佛得角":"Cape Verde","沙特":"Saudi Arabia","乌拉圭":"Uruguay",
  "法国":"France","塞内加尔":"Senegal","伊拉克":"Iraq","挪威":"Norway",
  "阿根廷":"Argentina","阿尔及利":"Algeria","奥地利":"Austria","约旦":"Jordan",
  "葡萄牙":"Portugal","刚果金":"DR Congo","英格兰":"England","克罗地亚":"Croatia",
  "加纳":"Ghana","巴拿马":"Panama","乌兹别克":"Uzbekistan","哥伦比亚":"Colombia",
};

function main() {
  console.log("=== 竞彩推荐方案生成 ===\n");
  if (!existsSync(ARGS.schedule)) { console.error("赛程数据文件不存在:", ARGS.schedule); process.exit(1); }
  const allMatches = JSON.parse(readFileSync(ARGS.schedule, "utf8"));
  console.log(`赛程加载: ${allMatches.length} 场`);
  let matches = allMatches;
  if (ARGS.onlyWorldCup) matches = matches.filter(m => m.league === "世界杯");
  if (ARGS.date) matches = matches.filter(m => m.date === ARGS.date);
  console.log(`筛选后: ${matches.length} 场`);
  if (matches.length === 0) { writeFileSync(ARGS.out, ["# 竞彩推荐方案", "", "当前无可投注的世界杯赛事。", ""].join("\n"), "utf8"); return; }
  const preds = readCSV(ARGS.predFile);
  const ahData = readCSV(ARGS.ahFile);
  let lines = [];
  lines.push("# 竞彩推荐方案", `生成时间：${new Date().toISOString()}`, "数据源：中国体彩网 + Elo/FIFA/身价预测模型 + Titan007 市场情绪", "");
  const byDate = {};
  for (const m of matches) { if (!byDate[m.date]) byDate[m.date] = []; byDate[m.date].push(m); }
  for (const [date, ms] of Object.entries(byDate).sort()) {
    lines.push("---", `## ${date}`, "");
    for (const m of ms) {
      const he = MAP[m.home] || "", ae = MAP[m.away] || "";
      let pred = null, ah = null;
      if (he && ae) {
        pred = preds.find(p => (NORM(p.homeTeam)===he&&NORM(p.awayTeam)===ae)||(NORM(p.homeTeam)===ae&&NORM(p.awayTeam)===he));
        if (ahData.length) ah = ahData.find(a => (NORM(a.home)===he&&NORM(a.away)===ae)||(NORM(a.home)===ae&&NORM(a.away)===he));
      }
      lines.push(`### ${m.code} ${m.home} vs ${m.away}`, "| 项目 | 内容 |", "|------|------|", `| 联赛 | ${m.league} |`, `| 开赛 | ${m.time || m.date} |`);
      if (pred) {
        const hw = +pred.homeWin || 0, dp = +pred.draw || 0, aw = +pred.awayWin || 0;
        lines.push(`| 模型预测 | 胜${(hw*100).toFixed(0)}% 平${(dp*100).toFixed(0)}% 负${(aw*100).toFixed(0)}% |`);
        lines.push(`| 比分预测 | ${pred.predictedScore || "?"}（冷门风险${pred.upsetRisk || "medium"}） |`);
      }
      if (ah && +ah.ahSignal) {
        const d = ah.ahDirection === "favor_favorite" ? "看好让球方" : "看好受让方";
        const ou = ah.ouDirection === "over" ? "大球" : "小球";
        lines.push(`| 市场情绪 | 亚盘${d}(${ah.ahSignal}) / 倾向${ou} |`);
      }
      lines.push("", "**💡 方案：**");
      if (pred) {
        const hw = +pred.homeWin || 0, dp = +pred.draw || 0, aw = +pred.awayWin || 0;
        const max = Math.max(hw, dp, aw);
        const maxName = hw === max ? "主胜" : dp === max ? "平局" : "客胜";
        if (max > 0.55) lines.push(`- 单场：**${maxName}**（概率${(max*100).toFixed(0)}%）`);
        if (Math.abs(hw - aw) > 0.30) lines.push(`- 让球：**${hw > aw ? m.home : m.away}** 占优，可关注让球方向`);
        const sm = {"2-0":"2:0/1:0/3:0","1-0":"1:0/2:0/1:1","0-1":"0:1/0:2/1:1","0-2":"0:2/0:1/1:2","1-1":"1:1/0:0","2-1":"2:1/1:0/2:0","1-2":"1:2/0:1/2:3"};
        if (sm[pred.predictedScore || ""]) lines.push(`- 比分：${sm[pred.predictedScore]}（模型预测${pred.predictedScore}）`);
      }
      if (ah && ah.reasons) { const r = (ah.reasons || "").slice(0, 60); if (r) lines.push(`- 提示：${r}`); }
      lines.push("");
    }
    const vb = ms.filter(m => {
      const he = MAP[m.home]||"", ae = MAP[m.away]||"";
      if (!he||!ae) return false;
      const p = preds.find(x => (NORM(x.homeTeam)===he&&NORM(x.awayTeam)===ae)||(NORM(x.homeTeam)===ae&&NORM(x.awayTeam)===he));
      return p && Math.max(+p.homeWin||0, +p.awayWin||0) > 0.55;
    });
    if (vb.length >= 2) {
      lines.push("### 📋 过关方案", "| 场次 | 方向 | 概率 |", "|------|------|------|");
      for (const m of vb) {
        const he = MAP[m.home], ae = MAP[m.away];
        const p = preds.find(x => (NORM(x.homeTeam)===he&&NORM(x.awayTeam)===ae)||(NORM(x.homeTeam)===ae&&NORM(x.awayTeam)===he));
        const hw = +p.homeWin||0, aw = +p.awayWin||0;
        lines.push(`| ${m.code} ${m.home} vs ${m.away} | ${hw>aw?"主胜":"客胜"} | ${(Math.max(hw,aw)*100).toFixed(0)}% |`);
      }
      lines.push("", `建议 ${vb.length} 串 1。赔率以 lottery.gov.cn 为准。`, "");
    }
  }
  lines.push("---", "⚠️ 以上推荐仅供参考，不构成投注建议。购彩有节制，请理性投注。");
  writeFileSync(ARGS.out, lines.join("\n"), "utf8");
  console.log(`\n报告已写入 ${ARGS.out}`);
}

main();