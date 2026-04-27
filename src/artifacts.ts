import path from "node:path";
import { ensureDir, pathExists, readText, toPosixPath, writeText } from "./fs-utils.js";
import type { AgentTurnResult, CostInfo, JsonObject, TurnRecord } from "./types.js";

export class ArtifactStore {
  cwd: string;
  baseDir: string;
  runDir = "";
  turnsDir = "";
  promptsDir = "";
  rawDir = "";
  schemaDir = "";
  finalDir = "";
  turns: TurnRecord[] = [];
  private reservedCount = 0;

  constructor({ cwd, baseDir }: { cwd: string; baseDir: string }) {
    this.cwd = cwd;
    this.baseDir = path.resolve(cwd, baseDir);
  }

  async init(): Promise<string> {
    const timestamp = timestampForPath(new Date());
    this.runDir = await uniqueRunDir(this.baseDir, timestamp);
    this.turnsDir = path.join(this.runDir, "turns");
    this.promptsDir = path.join(this.runDir, "prompts");
    this.rawDir = path.join(this.runDir, "raw");
    this.schemaDir = path.join(this.runDir, "schemas");
    this.finalDir = path.join(this.runDir, "final");
    await Promise.all([
      ensureDir(this.turnsDir),
      ensureDir(this.promptsDir),
      ensureDir(this.rawDir),
      ensureDir(this.schemaDir),
      ensureDir(this.finalDir)
    ]);
    return this.runDir;
  }

  reserveTurn(): number {
    this.reservedCount += 1;
    return this.reservedCount;
  }

  reserveTurns(count: number): number[] {
    const start = this.reservedCount + 1;
    this.reservedCount += count;
    return Array.from({ length: count }, (_, index) => start + index);
  }

  nextTurnNumber(): number {
    return this.reserveTurn();
  }

  reservedSoFar(): number {
    return this.reservedCount;
  }

  turnId(turnNumber: number): string {
    return String(turnNumber).padStart(4, "0");
  }

  get sortedTurns(): TurnRecord[] {
    return [...this.turns].sort((a, b) => a.id.localeCompare(b.id));
  }

  async writeScenario(scenarioText: string): Promise<string> {
    const scenarioPath = path.join(this.runDir, "scenario.md");
    await writeText(scenarioPath, scenarioText.trim() + "\n");
    return scenarioPath;
  }

  async writeSchema(name: string, schema: JsonObject): Promise<string> {
    const schemaPath = path.join(this.schemaDir, name);
    await writeText(schemaPath, JSON.stringify(schema, null, 2) + "\n");
    return schemaPath;
  }

  async writePrompt(turnNumber: number, actor: string, phase: string, prompt: string): Promise<string> {
    const fileName = `${this.turnId(turnNumber)}-${safeName(actor)}.${safeName(phase)}.prompt.md`;
    const promptPath = path.join(this.promptsDir, fileName);
    await writeText(promptPath, prompt);
    return promptPath;
  }

  rawPath(turnNumber: number, actor: string, phase: string, extension = "json"): string {
    const fileName = `${this.turnId(turnNumber)}-${safeName(actor)}.${safeName(phase)}.raw.${extension}`;
    return path.join(this.rawDir, fileName);
  }

  async writeTurn({
    turnNumber,
    actor,
    phase,
    inputTurnIds,
    result,
    cost,
    durationMs,
    anonymousLabel
  }: {
    turnNumber: number;
    actor: string;
    phase: string;
    inputTurnIds: string[];
    result: AgentTurnResult;
    cost?: CostInfo;
    durationMs?: number;
    anonymousLabel?: string | null;
  }): Promise<TurnRecord> {
    const turnId = this.turnId(turnNumber);
    const fileName = `${turnId}-${safeName(actor)}.${safeName(phase)}.md`;
    const outputPath = path.join(this.turnsDir, fileName);
    const claims = result.claims ?? [];
    const objections = result.objections ?? [];
    const rubricScores = result.rubric_scores ?? [];
    const incorporated = result.incorporated_objection_ids ?? [];

    const metadata: JsonObject = {
      turn: turnId,
      actor,
      phase,
      created_at: new Date().toISOString(),
      input_turns: inputTurnIds,
      status: result.status,
      blocking_issues: result.blocking_issues,
      questions_for_user: result.questions_for_user ?? [],
      claims,
      objections,
      rubric_scores: rubricScores,
      incorporated_objection_ids: incorporated
    };
    if (anonymousLabel) metadata.anonymous_label = anonymousLabel;
    if (durationMs !== undefined) metadata.duration_ms = durationMs;
    if (cost) metadata.cost = cost;

    const content = `${frontmatter(metadata)}\n${result.markdown.trim()}\n`;
    await writeText(outputPath, content);

    const record: TurnRecord = {
      id: turnId,
      actor,
      phase,
      inputTurnIds,
      summary: result.summary,
      status: result.status,
      blockingIssues: result.blocking_issues,
      questionsForUser: result.questions_for_user ?? [],
      claims,
      objections,
      rubricScores,
      incorporatedObjectionIds: incorporated,
      cost,
      durationMs,
      anonymousLabel: anonymousLabel ?? null,
      path: outputPath
    };
    this.turns.push(record);
    return record;
  }

  async appendTrace(event: JsonObject): Promise<void> {
    const tracePath = path.join(this.runDir, "trace.jsonl");
    const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n";
    await ensureDir(path.dirname(tracePath));
    await import("node:fs/promises").then((fs) => fs.appendFile(tracePath, line, "utf8"));
  }

  async writeIndex(finalPath: string | null = null, htmlPath: string | null = null): Promise<void> {
    const lines = ["# The Order of the Agents Run", ""];
    lines.push(`Run directory: \`${toPosixPath(path.relative(this.cwd, this.runDir))}\``);
    if (finalPath) lines.push(`Final report: \`${toPosixPath(path.relative(this.cwd, finalPath))}\``);
    if (htmlPath) lines.push(`HTML index: \`${toPosixPath(path.relative(this.cwd, htmlPath))}\``);
    lines.push("", "## Turns", "");
    for (const turn of this.sortedTurns) {
      const rel = toPosixPath(path.relative(this.runDir, turn.path));
      const label = turn.anonymousLabel ? ` [${turn.anonymousLabel}]` : "";
      lines.push(`- ${turn.id} ${turn.actor}${label} ${turn.phase}: [${rel}](${rel})`);
    }
    lines.push("");
    await writeText(path.join(this.runDir, "index.md"), lines.join("\n"));
  }

  async writeFinalReport(markdown: string, sourceTurn: TurnRecord | null): Promise<string> {
    const finalPath = path.join(this.finalDir, "report.md");
    const sourceLine = sourceTurn
      ? `<!-- source_turn: ${sourceTurn.id} ${sourceTurn.actor}.${sourceTurn.phase} -->\n\n`
      : "";
    await writeText(finalPath, sourceLine + markdown.trim() + "\n");
    return finalPath;
  }

  async writeHtmlIndex(html: string): Promise<string> {
    const htmlPath = path.join(this.runDir, "index.html");
    await writeText(htmlPath, html);
    return htmlPath;
  }

  async readTurn(turn: TurnRecord): Promise<string> {
    return readText(turn.path);
  }

  async readScenario(): Promise<string> {
    return readText(path.join(this.runDir, "scenario.md"));
  }
}

async function uniqueRunDir(baseDir: string, timestamp: string): Promise<string> {
  let candidate = path.join(baseDir, timestamp);
  let suffix = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(baseDir, `${timestamp}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

function frontmatter(metadata: JsonObject): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(metadata)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
      }
    } else if (value && typeof value === "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function timestampForPath(date: Date): string {
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

function safeName(value: string): string {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
