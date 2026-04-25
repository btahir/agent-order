import path from "node:path";
import { ensureDir, readText, toPosixPath, writeText } from "./fs-utils.js";
import type { AgentTurnResult, JsonObject, TurnRecord } from "./types.js";

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

  constructor({ cwd, baseDir }: { cwd: string; baseDir: string }) {
    this.cwd = cwd;
    this.baseDir = path.resolve(cwd, baseDir);
  }

  async init(): Promise<string> {
    const timestamp = timestampForPath(new Date());
    this.runDir = path.join(this.baseDir, timestamp);
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

  nextTurnNumber(): number {
    return this.turns.length + 1;
  }

  turnId(turnNumber = this.nextTurnNumber()): string {
    return String(turnNumber).padStart(4, "0");
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
    result
  }: {
    turnNumber: number;
    actor: string;
    phase: string;
    inputTurnIds: string[];
    result: AgentTurnResult;
  }): Promise<TurnRecord> {
    const turnId = this.turnId(turnNumber);
    const fileName = `${turnId}-${safeName(actor)}.${safeName(phase)}.md`;
    const outputPath = path.join(this.turnsDir, fileName);
    const metadata: JsonObject = {
      turn: turnId,
      actor,
      phase,
      created_at: new Date().toISOString(),
      input_turns: inputTurnIds,
      status: result.status,
      blocking_issues: result.blocking_issues,
      questions_for_user: result.questions_for_user ?? []
    };

    const content = `${frontmatter(metadata)}\n${result.markdown.trim()}\n`;
    await writeText(outputPath, content);

    const record = {
      id: turnId,
      actor,
      phase,
      inputTurnIds,
      summary: result.summary,
      status: result.status,
      blockingIssues: result.blocking_issues,
      questionsForUser: result.questions_for_user ?? [],
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

  async writeIndex(finalPath: string | null = null): Promise<void> {
    const lines = ["# The Order of the Agents Run", ""];
    lines.push(`Run directory: \`${toPosixPath(path.relative(this.cwd, this.runDir))}\``);
    if (finalPath) lines.push(`Final report: \`${toPosixPath(path.relative(this.cwd, finalPath))}\``);
    lines.push("", "## Turns", "");
    for (const turn of this.turns) {
      const rel = toPosixPath(path.relative(this.runDir, turn.path));
      lines.push(`- ${turn.id} ${turn.actor} ${turn.phase}: [${rel}](${rel})`);
    }
    lines.push("");
    await writeText(path.join(this.runDir, "index.md"), lines.join("\n"));
  }

  async writeFinalReport(markdown: string, sourceTurn: TurnRecord | null): Promise<string> {
    const finalPath = path.join(this.finalDir, "report.md");
    const sourceLine = sourceTurn ? `<!-- source_turn: ${sourceTurn.id} ${sourceTurn.actor}.${sourceTurn.phase} -->\n\n` : "";
    await writeText(finalPath, sourceLine + markdown.trim() + "\n");
    return finalPath;
  }

  async readTurn(turn: TurnRecord): Promise<string> {
    return readText(turn.path);
  }
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
