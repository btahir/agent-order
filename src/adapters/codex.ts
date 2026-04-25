import fs from "node:fs/promises";
import { normalizeAgentOutput } from "../schema.js";
import { commandForDisplay, runProcess } from "../process.js";
import type { AdapterTurnOutput, AgentCheckResult, AgentConfig, AgentTurnInvocation, CouncilConfig, ProcessResult } from "../types.js";

export async function runCodexTurn({ agent, config, prompt, schemaPath, outputPath, cwd }: AgentTurnInvocation): Promise<AdapterTurnOutput> {
  const options = {
    ...config.adapters.codex,
    ...(agent.options ?? {})
  } as Record<string, unknown>;
  const command = agent.command ?? "codex";
  const args: string[] = ["exec"];

  if (options.skip_git_repo_check !== false) args.push("--skip-git-repo-check");
  if (options.ephemeral !== false) args.push("--ephemeral");
  args.push("--sandbox", stringOption(options.sandbox, "read-only"));
  args.push("-c", `approval_policy="${stringOption(options.approval_policy, "never")}"`);
  args.push("--output-schema", schemaPath);
  args.push("--output-last-message", outputPath);
  args.push("--color", "never");
  if (agent.model) args.push("--model", agent.model);
  if (Array.isArray(agent.extra_args)) args.push(...agent.extra_args);
  args.push("-");

  const processResult = await runProcess({
    command,
    args,
    cwd,
    input: prompt,
    timeoutMs: numberOption(options.timeout_ms, 600000)
  });

  if (processResult.code !== 0) {
    throw new Error(formatFailure(agent.id, command, args, processResult));
  }

  const raw = await fs.readFile(outputPath, "utf8");
  return {
    result: normalizeAgentOutput(parseJsonOrText(raw)),
    process: {
      ...processResult,
      command: commandForDisplay(command, args)
    },
    raw
  };
}

function stringOption(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOption(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

export async function checkCodex(agent: AgentConfig, _config: CouncilConfig): Promise<AgentCheckResult> {
  const command = agent.command ?? "codex";
  const result = await runProcess({
    command,
    args: ["--version"],
    timeoutMs: 15000
  });
  return {
    ok: result.code === 0,
    agent: agent.id,
    adapter: agent.adapter,
    message: result.code === 0 ? result.stdout.trim() || "codex available" : result.stderr.trim() || "codex check failed"
  };
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
    `Codex adapter failed for agent ${agentId}.`,
    `Command: ${commandForDisplay(command, args)}`,
    `Exit: ${result.code}${result.signal ? ` signal ${result.signal}` : ""}${result.timedOut ? " timed out" : ""}`,
    stderr ? `stderr:\n${stderr}` : null,
    stdout ? `stdout:\n${stdout}` : null,
    "If Codex is not authenticated, run `codex` manually and complete login, then retry."
  ].filter(Boolean).join("\n\n");
}
