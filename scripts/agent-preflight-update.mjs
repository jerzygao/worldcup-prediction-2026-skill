#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    candidateDir: "",
    candidateSuffix: "v3",
    skipRealtime: "false",
    skipPredictions: "false",
    updatedAt: new Date().toISOString().slice(0, 10),
    output: "output/agent-preflight-update-report.md"
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] ?? "true";
      i += 1;
    }
  }
  return args;
}

function run(command, args) {
  const started = Date.now();
  execFileSync(command, args, { stdio: "inherit", cwd: process.cwd() });
  return { command: [command, ...args].join(" "), seconds: Number(((Date.now() - started) / 1000).toFixed(2)) };
}

function fileExists(filePath) {
  return fs.existsSync(path.resolve(filePath));
}

const args = parseArgs(process.argv);
const steps = [];

if (args.candidateDir) {
  steps.push(run("node", ["scripts/validate-external-candidates.mjs", "--candidateDir", args.candidateDir]));
  const issueFile = path.join(args.candidateDir, "candidate-validation-issues.csv");
  const issueText = fileExists(issueFile) ? fs.readFileSync(issueFile, "utf8") : "";
  if (/\berror\b/.test(issueText)) {
    throw new Error(`External candidate validation has blocking errors: ${issueFile}`);
  }
  steps.push(run("node", ["scripts/merge-external-candidates.mjs", "--candidateDir", args.candidateDir, "--suffix", args.candidateSuffix, "--updatedAt", args.updatedAt]));
}

if (args.skipRealtime !== "true") {
  steps.push(run("node", ["scripts/update-realtime-prematch-data.mjs", "--now", new Date().toISOString(), "--refreshStrength", "false", "--rerunPredictions", "false"]));
} else {
  steps.push({ command: "跳过实时更新", seconds: 0 });
}

steps.push(run("node", ["scripts/update-team-strength-sources.mjs", "--updatedAt", args.updatedAt]));
steps.push(run("node", ["scripts/build-squad-tactical-profiles.mjs", "--updatedAt", args.updatedAt]));

if (args.skipPredictions !== "true") {
  steps.push(run("node", ["scripts/batch-predict-2026.mjs"]));
  steps.push(run("node", ["scripts/simulate-2026.mjs"]));
  steps.push(run("node", ["scripts/generate-report-2026.mjs"]));
} else {
  steps.push({ command: "跳过预测重跑", seconds: 0 });
}

const statusPath = "data/manual/pre-match-update-status.csv";
const statusText = fileExists(statusPath) ? fs.readFileSync(statusPath, "utf8") : "";
const oddsMissing = (statusText.match(/missing_ODDS_API_KEY/g) || []).length;
const oddsUpdated = (statusText.match(/,updated,/g) || []).length;

const report = [
  "# Agent 赛前更新报告",
  "",
  `生成时间：${new Date().toISOString()}`,
  "",
  "## 执行步骤",
  "",
  "| 命令 | 秒数 |",
  "| --- | ---: |",
  ...steps.map((step) => `| ${step.command.replaceAll("|", "\\|")} | ${step.seconds} |`),
  "",
  "## 数据新鲜度提示",
  "",
  `- 赛前状态文件：${statusPath}`,
  `- 缺失赔率 API 标记数量：${oddsMissing}`,
  `- 状态 CSV 中通用 updated 标记数量：${oddsUpdated}`,
  "- 所有 `needs_verification`、`source_partial` 或 `source_conflict` 行只能作为上下文。",
  "- 除非明确做实时预测，否则不要使用开赛后或比赛中的数据。"
];

fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, `${report.join("\n")}\n`);
console.log(JSON.stringify({ output: args.output, steps: steps.length, oddsMissing }, null, 2));
