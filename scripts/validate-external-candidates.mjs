#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const desktop = path.join(process.env.USERPROFILE || process.env.HOME || ".", "Desktop");
  const args = {
    candidateDir: path.join(desktop, "世界杯预测Skill_外部AI_数据补全_2026-05-20"),
    wc26Teams: "data/manual/wc26-teams.csv",
    report: "candidate-validation-report.md",
    issues: "candidate-validation-issues.csv"
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
  if (!fs.existsSync(filePath)) return { rows: [], headers: [], exists: false };
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { rows: [], headers: [], exists: true };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    return {
      __line: index + 2,
      ...Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]))
    };
  });
  return { rows, headers, exists: true };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function writeCsv(filePath, rows, headers) {
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

function issue(issues, file, line, severity, field, message) {
  issues.push({ file, line: line || "", severity, field: field || "", message });
}

function hasUrl(value) {
  return /^https?:\/\/\S+/i.test(String(value ?? "").trim());
}

function requiredHeaders(name, headers, expected, issues) {
  for (const field of expected) {
    if (!headers.includes(field)) issue(issues, name, 1, "error", field, "Missing required header.");
  }
}

function validateEnum(row, file, field, allowed, issues) {
  if (!allowed.has(row[field])) issue(issues, file, row.__line, "error", field, `Invalid value "${row[field]}".`);
}

function validateRequired(row, file, fields, issues) {
  for (const field of fields) {
    if (!String(row[field] ?? "").trim()) issue(issues, file, row.__line, "error", field, "Required value is blank.");
  }
}

function toNumber(value) {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validate() {
  const args = parseArgs(process.argv);
  const candidateDir = path.resolve(args.candidateDir);
  const issues = [];
  const summary = [];
  const wc = readCsv(args.wc26Teams);
  const teams = new Set(wc.rows.map((row) => norm(row.team)).filter(Boolean));

  const schemas = {
    "wc26-squad-announcements-candidate.csv": {
      headers: ["team", "announcementDate", "rosterType", "rosterStatus", "playerCount", "source", "sourceUrl", "updatedAt", "modelUse", "notes"],
      rosterType: new Set(["final_26", "extended_27", "preliminary", "train_on_additions", "not_announced", "unknown"]),
      rosterStatus: new Set(["official_fifa", "official_federation", "reported_final_crosschecked", "reported_single_source", "source_partial", "source_conflict", "not_announced", "needs_verification"]),
      modelUse: new Set(["profile_context", "profile_context_only", "do_not_use_yet"])
    },
    "wc26-squad-players-candidate.csv": {
      headers: ["team", "announcementDate", "rosterType", "positionGroup", "player", "club", "sourceUrl", "status", "updatedAt", "notes"],
      rosterType: new Set(["final_26", "extended_27", "preliminary", "train_on_additions", "not_announced", "unknown"]),
      positionGroup: new Set(["Goalkeeper", "Defender", "Midfielder", "Forward"]),
      status: new Set(["reported", "official", "source_partial", "source_conflict", "needs_verification"])
    },
    "squad-rating-candidate.csv": {
      headers: ["team", "squadRating", "goalkeeperRating", "defenseRating", "midfieldRating", "attackRating", "ratingSource", "ratingSourceUrl", "updatedAt", "status", "notes"],
      status: new Set(["verified_game_rating", "derived_proxy", "partial_proxy", "needs_verification"])
    },
    "wc26-availability-candidate.csv": {
      headers: ["team", "player", "availabilityType", "status", "impactLevel", "source", "sourceUrl", "updatedAt", "notes"],
      availabilityType: new Set(["injury", "suspension", "omitted_from_squad", "fitness_doubt", "returned_to_squad", "unknown"]),
      impactLevel: new Set(["low", "medium", "high", "critical", "unknown"])
    },
    "odds-source-candidates.csv": {
      headers: ["provider", "sourceUrl", "coverage", "requiresApiKey", "hasWorldCup2026Market", "hasMatchOdds", "hasOutrightOdds", "accessMethod", "rateLimit", "notes"]
    }
  };

  const loaded = new Map();
  for (const [file, schema] of Object.entries(schemas)) {
    const fullPath = path.join(candidateDir, file);
    const data = readCsv(fullPath);
    loaded.set(file, data);
    if (!data.exists) {
      issue(issues, file, "", "warning", "", "Candidate file not found yet.");
      summary.push({ file, rows: 0, errors: 0, warnings: 1 });
      continue;
    }
    requiredHeaders(file, data.headers, schema.headers, issues);
    for (const row of data.rows) {
      if (row.team && teams.size && !teams.has(norm(row.team))) {
        issue(issues, file, row.__line, "warning", "team", `Team "${row.team}" is not an exact current wc26-teams.csv name.`);
      }
      if (schema.rosterType) validateEnum(row, file, "rosterType", schema.rosterType, issues);
      if (schema.rosterStatus) validateEnum(row, file, "rosterStatus", schema.rosterStatus, issues);
      if (schema.modelUse) validateEnum(row, file, "modelUse", schema.modelUse, issues);
      if (schema.positionGroup) validateEnum(row, file, "positionGroup", schema.positionGroup, issues);
      if (schema.status) validateEnum(row, file, "status", schema.status, issues);
      if (schema.availabilityType) validateEnum(row, file, "availabilityType", schema.availabilityType, issues);
      if (schema.impactLevel) validateEnum(row, file, "impactLevel", schema.impactLevel, issues);
      if ("sourceUrl" in row && row.sourceUrl && !hasUrl(row.sourceUrl)) {
        issue(issues, file, row.__line, "error", "sourceUrl", "sourceUrl must start with http:// or https://.");
      }
    }
    if (file === "wc26-squad-announcements-candidate.csv") {
      for (const row of data.rows) {
        validateRequired(row, file, ["team", "rosterType", "rosterStatus", "modelUse"], issues);
        if (row.rosterStatus !== "not_announced" && !hasUrl(row.sourceUrl)) {
          issue(issues, file, row.__line, "error", "sourceUrl", "Announced roster rows need a sourceUrl.");
        }
        const count = toNumber(row.playerCount);
        if (row.playerCount && (!Number.isInteger(count) || count < 0 || count > 60)) {
          issue(issues, file, row.__line, "error", "playerCount", "playerCount should be an integer from 0 to 60.");
        }
      }
      const covered = new Set(data.rows.map((row) => norm(row.team)).filter(Boolean));
      for (const team of teams) {
        if (!covered.has(team)) issue(issues, file, "", "warning", "team", `Missing announcement row for ${team}.`);
      }
    }
    if (file === "wc26-squad-players-candidate.csv") {
      for (const row of data.rows) {
        validateRequired(row, file, ["team", "positionGroup", "player", "status", "sourceUrl"], issues);
      }
    }
    if (file === "squad-rating-candidate.csv") {
      for (const row of data.rows) {
        validateRequired(row, file, ["team", "status", "updatedAt"], issues);
        for (const field of ["squadRating", "goalkeeperRating", "defenseRating", "midfieldRating", "attackRating"]) {
          const value = toNumber(row[field]);
          if (row[field] && (value === null || value < 0 || value > 100)) {
            issue(issues, file, row.__line, "error", field, "Rating must be numeric from 0 to 100.");
          }
        }
      }
    }
  }

  const announcements = loaded.get("wc26-squad-announcements-candidate.csv")?.rows ?? [];
  const players = loaded.get("wc26-squad-players-candidate.csv")?.rows ?? [];
  const playerCountByTeam = new Map();
  for (const row of players) playerCountByTeam.set(norm(row.team), (playerCountByTeam.get(norm(row.team)) ?? 0) + 1);
  for (const row of announcements) {
    const expected = toNumber(row.playerCount);
    const actual = playerCountByTeam.get(norm(row.team)) ?? 0;
    if (expected && ["final_26", "extended_27", "preliminary"].includes(row.rosterType) && actual && actual !== expected) {
      issue(issues, "wc26-squad-players-candidate.csv", "", "warning", "playerCount", `${row.team} announcement count is ${expected}, player rows contain ${actual}.`);
    }
  }

  for (const [file, data] of loaded.entries()) {
    const fileIssues = issues.filter((item) => item.file === file);
    summary.push({
      file,
      rows: data.rows.length,
      errors: fileIssues.filter((item) => item.severity === "error").length,
      warnings: fileIssues.filter((item) => item.severity === "warning").length
    });
  }

  const issuePath = path.join(candidateDir, args.issues);
  const reportPath = path.join(candidateDir, args.report);
  fs.mkdirSync(candidateDir, { recursive: true });
  writeCsv(issuePath, issues, ["file", "line", "severity", "field", "message"]);

  const mergeReady = issues.filter((item) => item.severity === "error").length === 0;
  const lines = [
    "# 外部候选数据校验报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    `候选目录：${candidateDir}`,
    `是否可合并：${mergeReady ? "没有阻塞错误" : "发现阻塞错误"}`,
    "",
    "## 文件汇总",
    "",
    "| 文件 | 行数 | 错误 | 警告 |",
    "| --- | ---: | ---: | ---: |",
    ...summary.map((row) => `| ${row.file} | ${row.rows} | ${row.errors} | ${row.warnings} |`),
    "",
    "## 合并规则",
    "",
    "- `official_fifa`、`official_federation`、`reported_final_crosschecked`、`official` 或 `reported` 行，在抽查来源 URL 后可考虑合并。",
    "- `source_partial`、`source_conflict`、`partial_proxy` 或 `needs_verification` 行只能保留为上下文。",
    "- 训练名单和初选名单不得当成最终 26 人名单或首发阵容。",
    "",
    "## 阻塞问题",
    "",
    ...issues.filter((item) => item.severity === "error").slice(0, 80).map((item) => `- ${item.file}${item.line ? `:${item.line}` : ""} ${item.field}: ${item.message}`),
    ...(issues.some((item) => item.severity === "error") ? [] : ["- 无"]),
    "",
    "## 警告",
    "",
    ...issues.filter((item) => item.severity === "warning").slice(0, 120).map((item) => `- ${item.file}${item.line ? `:${item.line}` : ""} ${item.field}: ${item.message}`),
    ...(issues.some((item) => item.severity === "warning") ? [] : ["- 无"])
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ candidateDir, report: reportPath, issues: issuePath, mergeReady, issueCount: issues.length }, null, 2));
}

validate();
