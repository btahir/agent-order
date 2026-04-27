import { normalizeAgentOutput } from "../schema.js";
import { commandForDisplay, runProcess } from "../process.js";
import type {
  AdapterTurnOutput,
  AgentCheckResult,
  AgentConfig,
  AgentTurnInvocation,
  CostInfo,
  CouncilConfig,
  ProcessResult
} from "../types.js";

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

  const { payload, cost } = parseClaudeJson(processResult.stdout);
  return {
    result: normalizeAgentOutput(payload),
    process: {
      ...processResult,
      command: commandForDisplay(command, args)
    },
    raw: processResult.stdout,
    cost
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

function parseClaudeJson(stdout: string): { payload: unknown; cost?: CostInfo } {
  const text = stdout.trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { payload: text };
  }

  let payload: unknown = value;
  let cost: CostInfo | undefined;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    cost = extractCost(obj);
    if (obj.structured_output !== undefined) {
      payload = obj.structured_output;
    } else if (typeof obj.result === "string") {
      try {
        payload = JSON.parse(obj.result);
      } catch {
        payload = obj.result;
      }
    }
  }

  return { payload, cost };
}

function extractCost(obj: Record<string, unknown>): CostInfo | undefined {
  const cost: CostInfo = {};
  const usage = obj.usage as Record<string, unknown> | undefined;
  if (usage) {
    const inputTokens = numberish(usage.input_tokens) ?? numberish(usage.input);
    const outputTokens = numberish(usage.output_tokens) ?? numberish(usage.output);
    if (inputTokens !== undefined) cost.tokens_in = inputTokens;
    if (outputTokens !== undefined) cost.tokens_out = outputTokens;
  }
  const totalCost = numberish(obj.total_cost_usd) ?? numberish(obj.cost_usd);
  if (totalCost !== undefined) cost.cost_usd = totalCost;
  return Object.keys(cost).length > 0 ? cost : undefined;
}

function numberish(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
