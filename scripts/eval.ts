import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listBuiltInTemplates } from "../src/templates/index.js";
import type { ArtifactTemplate, RubricCriterion } from "../src/types.js";

interface EvalCliFlags {
  version?: string;
  scenarioFilter?: string;
  council?: string;
  templateFilter?: string;
  judgeCommand?: string;
  judgeArgs?: string[];
  outDir?: string;
  compare?: [string, string];
  agentOrderBinary?: string;
  configPath?: string;
}

interface ScenarioEntry {
  template: ArtifactTemplate;
  scenarioId: string;
  scenarioPath: string;
}

interface ScorecardEntry {
  criterion_id: string;
  criterion_text: string;
  pass: boolean;
  evidence: string;
}

interface ScenarioResult {
  template: string;
  scenario: string;
  artifact_path: string;
  agent_order_run_dir: string;
  scores: ScorecardEntry[];
  notes: string;
  pass_count: number;
  total_count: number;
  pass_rate: number;
}

interface VersionSummary {
  version: string;
  timestamp: string;
  scenarios: ScenarioResult[];
  aggregate: {
    pass_count: number;
    total_count: number;
    pass_rate: number;
    per_template: Record<string, { pass_count: number; total_count: number; pass_rate: number }>;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCENARIOS_ROOT = path.join(REPO_ROOT, "docs/evals/scenarios");
const DEFAULT_RESULTS_ROOT = path.join(REPO_ROOT, "docs/evals/results");
const JUDGE_PROMPT_PATH = path.join(REPO_ROOT, "docs/evals/judge-prompt.md");

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.compare) {
    await compareVersions(flags.compare[0], flags.compare[1], flags.outDir);
    return;
  }

  const version = flags.version ?? "current";
  if (flags.version && !["current", "untagged"].includes(flags.version) && !flags.agentOrderBinary) {
    throw new Error(
      "`--version` is a result label, not an executable selector. Pass `--agent-order <path-to-agent-order-js>` when evaluating a named baseline such as v0.1 or v0.2."
    );
  }
  const scenarios = await collectScenarios(flags);
  if (scenarios.length === 0) {
    throw new Error("No scenarios matched the filter.");
  }

  const judgeCommand = flags.judgeCommand ?? "claude";
  const judgePromptText = await fs.readFile(JUDGE_PROMPT_PATH, "utf8");

  const timestamp = formatTimestamp(new Date());
  const resultsRoot = flags.outDir ? path.resolve(process.cwd(), flags.outDir) : DEFAULT_RESULTS_ROOT;
  const versionDir = path.join(resultsRoot, version, timestamp);
  await fs.mkdir(versionDir, { recursive: true });

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    console.error(`\n[eval] ${scenario.template.id}/${scenario.scenarioId}`);
    const scenarioOutDir = path.join(versionDir, `${scenario.template.id}-${scenario.scenarioId}`);
    await fs.mkdir(scenarioOutDir, { recursive: true });

    const runDir = await invokeAgentOrder({
      binary: flags.agentOrderBinary,
      scenarioPath: scenario.scenarioPath,
      template: scenario.template.id,
      council: flags.council,
      configPath: flags.configPath,
      outBase: path.join(scenarioOutDir, "agent-order-runs")
    });
    if (!runDir) {
      console.error(`[eval] WARN: agent-order produced no run dir for ${scenario.template.id}/${scenario.scenarioId}`);
      continue;
    }
    const artifactSrc = path.join(runDir, "final", "report.md");
    const artifact = await safeRead(artifactSrc);
    if (!artifact) {
      console.error(`[eval] WARN: no final/report.md at ${runDir}`);
      continue;
    }
    const artifactDest = path.join(scenarioOutDir, "artifact.md");
    await fs.writeFile(artifactDest, artifact, "utf8");

    const scoreEntries = await invokeJudge({
      command: judgeCommand,
      judgePromptText,
      scenarioText: await fs.readFile(scenario.scenarioPath, "utf8"),
      artifactText: artifact,
      template: scenario.template
    });

    const passCount = scoreEntries.filter((entry) => entry.pass).length;
    const result: ScenarioResult = {
      template: scenario.template.id,
      scenario: scenario.scenarioId,
      artifact_path: path.relative(REPO_ROOT, artifactDest),
      agent_order_run_dir: path.relative(REPO_ROOT, runDir),
      scores: scoreEntries,
      notes: "",
      pass_count: passCount,
      total_count: scoreEntries.length,
      pass_rate: scoreEntries.length > 0 ? passCount / scoreEntries.length : 0
    };
    results.push(result);

    await fs.writeFile(
      path.join(scenarioOutDir, "scorecard.json"),
      JSON.stringify(result, null, 2) + "\n",
      "utf8"
    );
    console.error(
      `[eval]   pass ${result.pass_count}/${result.total_count} (${(result.pass_rate * 100).toFixed(1)}%)`
    );
  }

  const summary: VersionSummary = {
    version,
    timestamp,
    scenarios: results,
    aggregate: aggregateSummary(results)
  };
  await fs.writeFile(
    path.join(versionDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8"
  );

  console.error(
    `\n[eval] aggregate: ${summary.aggregate.pass_count}/${summary.aggregate.total_count} (${(summary.aggregate.pass_rate * 100).toFixed(1)}%) - ${path.relative(REPO_ROOT, versionDir)}`
  );
}

function aggregateSummary(results: ScenarioResult[]): VersionSummary["aggregate"] {
  let passCount = 0;
  let totalCount = 0;
  const perTemplate: Record<string, { pass_count: number; total_count: number; pass_rate: number }> = {};
  for (const result of results) {
    passCount += result.pass_count;
    totalCount += result.total_count;
    const entry = perTemplate[result.template] ?? { pass_count: 0, total_count: 0, pass_rate: 0 };
    entry.pass_count += result.pass_count;
    entry.total_count += result.total_count;
    entry.pass_rate = entry.total_count > 0 ? entry.pass_count / entry.total_count : 0;
    perTemplate[result.template] = entry;
  }
  return {
    pass_count: passCount,
    total_count: totalCount,
    pass_rate: totalCount > 0 ? passCount / totalCount : 0,
    per_template: perTemplate
  };
}

async function compareVersions(a: string, b: string, outDir?: string): Promise<void> {
  const resultsRoot = outDir ? path.resolve(process.cwd(), outDir) : DEFAULT_RESULTS_ROOT;
  const summaryA = await loadLatestSummary(a, resultsRoot);
  const summaryB = await loadLatestSummary(b, resultsRoot);
  console.log(`Comparing ${a} -> ${b}\n`);

  const allTemplates = new Set([
    ...Object.keys(summaryA.aggregate.per_template),
    ...Object.keys(summaryB.aggregate.per_template)
  ]);

  console.log(`Aggregate pass-rate: ${pct(summaryA.aggregate.pass_rate)} -> ${pct(summaryB.aggregate.pass_rate)}`);
  console.log("Per-template:");
  for (const template of allTemplates) {
    const before = summaryA.aggregate.per_template[template]?.pass_rate ?? 0;
    const after = summaryB.aggregate.per_template[template]?.pass_rate ?? 0;
    const verdict = after > before ? "improve" : after < before ? "regress" : "flat";
    console.log(`  ${template.padEnd(20)} ${pct(before)} -> ${pct(after)}  (${verdict})`);
  }

  const allCriteria = collectCriterionStats([summaryA, summaryB]);
  console.log("\nPer-criterion deltas:");
  for (const [criterion, stats] of allCriteria) {
    const before = stats.versions[a] ?? { passed: 0, total: 0 };
    const after = stats.versions[b] ?? { passed: 0, total: 0 };
    const beforeRate = before.total > 0 ? before.passed / before.total : 0;
    const afterRate = after.total > 0 ? after.passed / after.total : 0;
    const verdict = afterRate > beforeRate ? "improve" : afterRate < beforeRate ? "regress" : "flat";
    console.log(
      `  ${criterion.padEnd(28)} ${pct(beforeRate)} -> ${pct(afterRate)}  (${verdict})`
    );
  }

  const regressed = [...allCriteria.values()].some((stats) => {
    const before = stats.versions[a] ?? { passed: 0, total: 0 };
    const after = stats.versions[b] ?? { passed: 0, total: 0 };
    const beforeRate = before.total > 0 ? before.passed / before.total : 0;
    const afterRate = after.total > 0 ? after.passed / after.total : 0;
    return afterRate < beforeRate;
  });

  if (regressed) {
    console.log("\nVerdict: REGRESSION on at least one criterion. v0.2 ship gate not met.");
    process.exitCode = 1;
  } else if (summaryB.aggregate.pass_rate > summaryA.aggregate.pass_rate) {
    console.log("\nVerdict: aggregate pass-rate improved with no regressions. Ship gate met.");
  } else {
    console.log("\nVerdict: aggregate pass-rate flat or worse, no regressions on individual criteria.");
  }
}

interface CriterionAggregate {
  criterion: string;
  versions: Record<string, { passed: number; total: number }>;
}

function collectCriterionStats(summaries: VersionSummary[]): Map<string, CriterionAggregate> {
  const map = new Map<string, CriterionAggregate>();
  for (const summary of summaries) {
    for (const scenario of summary.scenarios) {
      for (const score of scenario.scores) {
        const key = `${scenario.template}/${score.criterion_id}`;
        const entry =
          map.get(key) ?? {
            criterion: key,
            versions: {} as Record<string, { passed: number; total: number }>
          };
        const versionEntry = entry.versions[summary.version] ?? { passed: 0, total: 0 };
        versionEntry.total += 1;
        if (score.pass) versionEntry.passed += 1;
        entry.versions[summary.version] = versionEntry;
        map.set(key, entry);
      }
    }
  }
  return map;
}

async function loadLatestSummary(version: string, resultsRoot: string): Promise<VersionSummary> {
  const dir = path.join(resultsRoot, version);
  const entries = await fs.readdir(dir);
  const sorted = entries.filter((entry) => entry.match(/^\d{4}/)).sort();
  if (sorted.length === 0) throw new Error(`No timestamped results found under ${dir}.`);
  const latest = sorted[sorted.length - 1];
  const summaryPath = path.join(dir, latest, "summary.json");
  const text = await fs.readFile(summaryPath, "utf8");
  return JSON.parse(text);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function collectScenarios(flags: EvalCliFlags): Promise<ScenarioEntry[]> {
  const scenarios: ScenarioEntry[] = [];
  const templates = listBuiltInTemplates();
  for (const template of templates) {
    if (flags.templateFilter && template.id !== flags.templateFilter) continue;
    const templateDir = path.join(SCENARIOS_ROOT, template.id);
    let scenarioIds: string[] = [];
    try {
      scenarioIds = await fs.readdir(templateDir);
    } catch {
      continue;
    }
    for (const id of scenarioIds) {
      const scenarioPath = path.join(templateDir, id, "scenario.md");
      try {
        await fs.access(scenarioPath);
      } catch {
        continue;
      }
      if (flags.scenarioFilter && `${template.id}/${id}` !== flags.scenarioFilter) continue;
      scenarios.push({ template, scenarioId: id, scenarioPath });
    }
  }
  return scenarios;
}

async function invokeAgentOrder({
  binary,
  scenarioPath,
  template,
  council,
  configPath,
  outBase
}: {
  binary?: string;
  scenarioPath: string;
  template: string;
  council?: string;
  configPath?: string;
  outBase: string;
}): Promise<string | null> {
  const cmd = binary ?? path.join(REPO_ROOT, "dist", "bin", "agent-order.js");
  const args = [template, scenarioPath, "--out", outBase, "--human-input", "never"];
  if (council) args.push("--depth", council);
  if (configPath) args.push("--config", configPath);
  const result = await runProcess("node", [cmd, ...args]);
  if (result.code !== 0) {
    console.error(result.stderr);
    return null;
  }
  const lines = result.stdout.trim().split(/\n/);
  const finalLine = lines[0];
  if (!finalLine) return null;
  return path.dirname(path.dirname(finalLine));
}

async function invokeJudge({
  command,
  judgePromptText,
  scenarioText,
  artifactText,
  template
}: {
  command: string;
  judgePromptText: string;
  scenarioText: string;
  artifactText: string;
  template: ArtifactTemplate;
}): Promise<ScorecardEntry[]> {
  const rubricBlock = template.rubric.map((c: RubricCriterion) => `- ${c.id}: ${c.text}${c.guidance ? ` (${c.guidance})` : ""}`).join("\n");
  const prompt = [
    judgePromptText.trim(),
    "",
    "## Scenario",
    "",
    scenarioText.trim(),
    "",
    "## Artifact",
    "",
    artifactText.trim(),
    "",
    "## Rubric",
    "",
    rubricBlock,
    ""
  ].join("\n");

  const result = await runProcess(command, ["-p", "--output-format", "json"], prompt);
  if (result.code !== 0) {
    console.error(`[eval] judge invocation failed: ${result.stderr}`);
    return [];
  }
  return parseJudgeOutput(result.stdout, template);
}

function parseJudgeOutput(stdout: string, template: ArtifactTemplate): ScorecardEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }

  let body: unknown = parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.result === "string") {
      try {
        body = JSON.parse(obj.result);
      } catch {
        body = obj.result;
      }
    } else if (obj.structured_output) {
      body = obj.structured_output;
    }
  }

  if (!body || typeof body !== "object") return template.rubric.map((c) => failingScore(c, "judge output unparseable"));
  const scoresInput = (body as Record<string, unknown>).scores;
  if (!Array.isArray(scoresInput)) return template.rubric.map((c) => failingScore(c, "judge returned no scores"));

  const byId = new Map<string, ScorecardEntry>();
  for (const entry of scoresInput) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.criterion_id === "string" ? obj.criterion_id.trim() : "";
    if (!id) continue;
    byId.set(id, {
      criterion_id: id,
      criterion_text: typeof obj.criterion_text === "string" ? obj.criterion_text : id,
      pass: Boolean(obj.pass),
      evidence: typeof obj.evidence === "string" ? obj.evidence : ""
    });
  }
  return template.rubric.map((c) => {
    const found = byId.get(c.id);
    if (found) return { ...found, criterion_text: c.text };
    return failingScore(c, "criterion missing from judge output");
  });
}

function failingScore(criterion: RubricCriterion, evidence: string): ScorecardEntry {
  return {
    criterion_id: criterion.id,
    criterion_text: criterion.text,
    pass: false,
    evidence
  };
}

async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(command: string, args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function parseFlags(argv: string[]): EvalCliFlags {
  const flags: EvalCliFlags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--version") flags.version = argv[++i];
    else if (arg === "--scenario") flags.scenarioFilter = argv[++i];
    else if (arg === "--depth") flags.council = argv[++i];
    else if (arg === "--council") flags.council = argv[++i];
    else if (arg === "--template") flags.templateFilter = argv[++i];
    else if (arg === "--judge-command") flags.judgeCommand = argv[++i];
    else if (arg === "--out") flags.outDir = argv[++i];
    else if (arg === "--agent-order") flags.agentOrderBinary = argv[++i];
    else if (arg === "--config") flags.configPath = argv[++i];
    else if (arg === "--compare") {
      const left = argv[++i];
      const right = argv[++i];
      if (!left || !right) throw new Error("--compare requires two version labels");
      flags.compare = [left, right];
    }
  }
  return flags;
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
