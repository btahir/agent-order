import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentOutput } from "../schema.js";
import { commandForDisplay, runProcess } from "../process.js";
import { writeText } from "../fs-utils.js";
import type {
  AdapterTurnOutput,
  AgentCheckResult,
  AgentConfig,
  AgentTurnInvocation,
  CouncilConfig,
  ProcessResult
} from "../types.js";

export async function runGenericTurn({
  agent,
  config,
  prompt,
  outputPath,
  cwd,
  turnNumber,
  phase
}: AgentTurnInvocation): Promise<AdapterTurnOutput> {
  const options = {
    ...config.adapters.generic,
    ...(agent.options ?? {})
  } as Record<string, unknown>;
  const command = agent.command;
  if (!command) throw new Error(`generic-cli agent ${agent.id} requires a command.`);

  const promptPath = path.join(
    path.dirname(outputPath),
    `${String(turnNumber).padStart(4, "0")}-${agent.id}.${phase}.input.md`
  );
  await writeText(promptPath, prompt);

  const templateContext: Record<string, string> = {
    prompt,
    promptPath,
    outputPath,
    turnId: String(turnNumber).padStart(4, "0"),
    agentId: agent.id,
    phase
  };

  const args = (agent.args ?? []).map((arg) => applyTemplate(arg, templateContext));
  const inputMode = agent.input?.mode ?? "stdin";
  const outputMode = agent.output?.mode ?? "stdout";
  const input = inputMode === "stdin" ? prompt : "";

  if (inputMode === "file" && !args.some((arg) => arg.includes(promptPath))) {
    args.push(promptPath);
  }
  if (outputMode === "file" && !args.some((arg) => arg.includes(outputPath))) {
    args.push(outputPath);
  }

  const processResult = await runProcess({
    command,
    args,
    cwd,
    input,
    timeoutMs: numberOption(options.timeout_ms, 600000)
  });

  if (processResult.code !== 0) {
    throw new Error(formatFailure(agent.id, command, args, processResult));
  }

  const raw = outputMode === "file" ? await fs.readFile(outputPath, "utf8") : processResult.stdout;
  return {
    result: normalizeAgentOutput(parseJsonOrText(raw)),
    process: {
      ...processResult,
      command: commandForDisplay(command, args)
    },
    raw
  };
}

function numberOption(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

export async function checkGeneric(agent: AgentConfig, _config: CouncilConfig): Promise<AgentCheckResult> {
  if (!agent.command) {
    return {
      ok: false,
      agent: agent.id,
      adapter: agent.adapter,
      message: "generic-cli agent is missing command"
    };
  }

  const args = agent.check_args ?? ["--version"];
  const result = await runProcess({
    command: agent.command,
    args,
    timeoutMs: 15000
  });
  return {
    ok: result.code === 0,
    agent: agent.id,
    adapter: agent.adapter,
    message:
      result.code === 0
        ? (result.stdout || result.stderr).trim() || "command available"
        : result.stderr.trim() || "check failed"
  };
}

function applyTemplate(value: string, context: Record<string, string>): string {
  return String(value).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return context[key] ?? "";
  });
}

function parseJsonOrText(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatFailure(agentId: string, command: string, args: string[], result: ProcessResult): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  return [
    `Generic adapter failed for agent ${agentId}.`,
    `Command: ${commandForDisplay(command, args)}`,
    `Exit: ${result.code}${result.signal ? ` signal ${result.signal}` : ""}${result.timedOut ? " timed out" : ""}`,
    stderr ? `stderr:\n${stderr}` : null,
    stdout ? `stdout:\n${stdout}` : null
  ].filter(Boolean).join("\n\n");
}
