import { normalizeAgentOutput } from "../schema.js";
import { commandForDisplay, runProcess } from "../process.js";
import type { AdapterTurnOutput, AgentCheckResult, AgentConfig, AgentTurnInvocation, CouncilConfig, ProcessResult } from "../types.js";

export async function runClaudeTurn({ agent, config, prompt, schema, cwd }: AgentTurnInvocation): Promise<AdapterTurnOutput> {
  const options = {
    ...config.adapters.claude,
    ...(agent.options ?? {})
  } as Record<string, unknown>;
  const command = agent.command ?? "claude";
  const args: string[] = ["-p"];

  args.push("--permission-mode", stringOption(options.permission_mode, "dontAsk"));
  args.push("--tools", stringOption(options.tools, ""));
  args.push("--output-format", stringOption(options.output_format, "json"));
  args.push("--json-schema", JSON.stringify(schema));
  if (options.no_session_persistence !== false) args.push("--no-session-persistence");
  if (options.strict_mcp_config !== false) args.push("--strict-mcp-config");
  if (agent.model) args.push("--model", agent.model);
  if (Array.isArray(agent.extra_args)) args.push(...agent.extra_args);
  args.push("Respond to the deliberation prompt provided on stdin.");

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

  const parsed = parseClaudeJson(processResult.stdout);
  return {
    result: normalizeAgentOutput(parsed),
    process: {
      ...processResult,
      command: commandForDisplay(command, args)
    },
    raw: processResult.stdout
  };
}

function stringOption(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOption(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

export async function checkClaude(agent: AgentConfig, _config: CouncilConfig): Promise<AgentCheckResult> {
  const command = agent.command ?? "claude";
  const result = await runProcess({
    command,
    args: ["--version"],
    timeoutMs: 15000
  });
  return {
    ok: result.code === 0,
    agent: agent.id,
    adapter: agent.adapter,
    message: result.code === 0 ? result.stdout.trim() || "claude available" : result.stderr.trim() || "claude check failed"
  };
}

function parseClaudeJson(stdout: string): unknown {
  const text = stdout.trim();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }

  if (value && typeof value === "object") {
    if (value.structured_output) return value.structured_output;
    if (typeof value.result === "string") {
      try {
        return JSON.parse(value.result);
      } catch {
        return value.result;
      }
    }
  }

  return value;
}

function formatFailure(agentId: string, command: string, args: string[], result: ProcessResult): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  return [
    `Claude adapter failed for agent ${agentId}.`,
    `Command: ${commandForDisplay(command, args)}`,
    `Exit: ${result.code}${result.signal ? ` signal ${result.signal}` : ""}${result.timedOut ? " timed out" : ""}`,
    stderr ? `stderr:\n${stderr}` : null,
    stdout ? `stdout:\n${stdout}` : null,
    "If Claude is not authenticated, run `claude` manually and complete login, then retry."
  ].filter(Boolean).join("\n\n");
}
