import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./args.js";
import { loadConfig, writeDefaultConfig } from "./config.js";
import { pathExists, readText } from "./fs-utils.js";
import { checkAgent } from "./adapters/index.js";
import { runCouncil } from "./orchestrator.js";
import { createHumanPrompter } from "./human-prompter.js";
import { createTerminalTheme, formatEvent } from "./terminal-ui.js";
import type { CouncilConfig } from "./types.js";

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.command === "grill") {
    parsed.command = "run";
    parsed.flags.intake = "grill";
  }

  if (parsed.command === "help") {
    printHelp();
    return;
  }

  if (parsed.command === "init") {
    const target = path.resolve(process.cwd(), parsed.flags.configPath ?? "agent-order.config.yaml");
    if (await pathExists(target)) {
      throw new Error(`Config already exists: ${target}`);
    }
    await writeDefaultConfig(target);
    console.log(`Wrote ${target}`);
    return;
  }

  const config = await loadConfig(parsed.flags);

  if (parsed.command === "check" || parsed.command === "doctor") {
    await runChecks(config);
    return;
  }

  const scenarioInput = parsed.positional.join(" ").trim();
  if (!scenarioInput) {
    throw new Error("Missing scenario text or scenario file. Run `agent-order --help` for usage.");
  }

  const scenarioText = await resolveScenarioText(scenarioInput);
  const humanPrompter = createHumanPrompter();
  const theme = createTerminalTheme({ color: Boolean(process.stderr.isTTY) });
  let result;
  try {
    result = await runCouncil({
      scenarioText,
      config,
      cwd: process.cwd(),
      onEvent: (message: string) => console.error(formatEvent(message, theme)),
      askUser: humanPrompter.askQuestions
    });
  } finally {
    humanPrompter.close();
  }

  console.log(result.finalPath);
}

async function runChecks(config: CouncilConfig): Promise<void> {
  let failed = false;
  for (const agent of config.agents) {
    const result = await checkAgent(agent, config);
    const status = result.ok ? "ok" : "failed";
    console.log(`${agent.id} (${agent.adapter}): ${status} - ${result.message}`);
    if (!result.ok) failed = true;
  }
  if (failed) {
    process.exitCode = 1;
  }
}

async function resolveScenarioText(scenarioInput: string): Promise<string> {
  const candidate = path.resolve(process.cwd(), scenarioInput);
  if (await pathExists(candidate)) {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) return readText(candidate);
  }
  return scenarioInput;
}

function printHelp(): void {
  console.log(`agent-order

Usage:
  agent-order <scenario text | scenario.md> [options]
  agent-order grill <scenario text | scenario.md> [options]
  agent-order init [--config agent-order.config.yaml]
  agent-order check [--config agent-order.config.yaml]
  agent-order doctor [--config agent-order.config.yaml]

Options:
  --config <path>       Config file path. Defaults to agent-order.config.yaml if present.
  --agents <ids>        Comma-separated agent ids to use from config.
  --max-turns <n>       Maximum agent turns before finalizing. Default: max(12, agents*4+4).
  --out <dir>           Base output directory. Default: ./agent-order-runs.
  --synthesizer <id>    Agent id that performs synthesis. Default: first configured agent.
  --intake <mode>       Optional intake mode. Currently supported: grill.
  --max-questions <n>   Maximum grill-mode intake questions. Default: 6.
  --human-input <mode>  never, on-blocking-questions, before-final, or interactive.
  --no-intake           Disable configured intake.
  --no-human-input      Disable mid-run user clarification pauses.
  --no-final-review     Skip final-review turns.
  --dry-run             Write prompts/artifacts without invoking agents.
  -h, --help            Show this help.

Default agents:
  codex   adapter codex-cli, command codex
  claude  adapter claude-cli, command claude
`);
}
