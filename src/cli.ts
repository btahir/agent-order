import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./args.js";
import { loadConfig, writeDefaultConfig } from "./config.js";
import { pathExists, readText } from "./fs-utils.js";
import { checkAgent } from "./adapters/index.js";
import { runCouncil } from "./orchestrator.js";
import { createHumanPrompter } from "./human-prompter.js";
import { createTerminalReporter } from "./terminal-ui.js";
import { listBuiltInTemplates, TEMPLATE_IDS } from "./templates/index.js";
import { applyCouncilPreset, listCouncilPresets } from "./councils.js";
import { listPresets } from "./adapters/presets.js";
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
    await runChecks(config, parsed.command === "doctor");
    return;
  }

  if (parsed.command === "replay") {
    await runReplay(parsed.positional, config);
    return;
  }

  const scenarioInput = parsed.positional.join(" ").trim();
  if (!scenarioInput) {
    throw new Error("Missing scenario text or scenario file. Run `agent-order --help` for usage.");
  }

  const scenarioText = await resolveScenarioText(scenarioInput);
  const humanPrompter = createHumanPrompter();
  const reporter = createTerminalReporter({ output: process.stderr, color: Boolean(process.stderr.isTTY) });
  let result;
  try {
    result = await runCouncil({
      scenarioText,
      config,
      cwd: process.cwd(),
      onEvent: reporter.event,
      askUser: humanPrompter.askQuestions
    });
  } finally {
    reporter.finish();
    humanPrompter.close();
  }

  if (process.stdout.isTTY) {
    reporter.finalPath(result.finalPath);
    if (result.htmlPath) reporter.htmlPath(result.htmlPath);
  } else {
    console.log(result.finalPath);
    if (result.htmlPath) console.log(result.htmlPath);
  }
}

async function runChecks(config: CouncilConfig, verbose: boolean): Promise<void> {
  let failed = false;
  for (const agent of config.agents) {
    const result = await checkAgent(agent, config);
    const status = result.ok ? "ok" : "failed";
    console.log(`${agent.id} (${agent.adapter}): ${status} - ${result.message}`);
    if (!result.ok) failed = true;
  }

  if (verbose) {
    console.log("");
    console.log("Available adapter presets:");
    for (const preset of listPresets()) {
      console.log(`  ${preset.id} - ${preset.description}`);
    }
    console.log("");
    console.log("Available depth presets:");
    for (const preset of listCouncilPresets()) {
      console.log(`  ${preset.id} - ${preset.description}`);
    }
    console.log("");
    console.log("Available artifact templates:");
    for (const template of listBuiltInTemplates()) {
      console.log(`  ${template.id} - ${template.name}`);
    }
  }

  if (failed) process.exitCode = 1;
}

async function runReplay(positional: string[], config: CouncilConfig): Promise<void> {
  if (positional.length === 0) {
    throw new Error("agent-order replay requires a path to a previous run directory.");
  }
  const sourceDir = path.resolve(process.cwd(), positional[0]);
  if (!(await pathExists(sourceDir))) {
    throw new Error(`Source run directory not found: ${sourceDir}`);
  }
  const scenarioPath = path.join(sourceDir, "scenario.md");
  if (!(await pathExists(scenarioPath))) {
    throw new Error(`Source run is missing scenario.md: ${sourceDir}`);
  }
  const scenarioText = await readText(scenarioPath);
  const inherited = await readSourceTraceMeta(sourceDir);
  if (inherited.template && !config.template) config.template = inherited.template;
  if (inherited.council_preset && !config.council_preset) applyCouncilPreset(config, inherited.council_preset);
  const humanPrompter = createHumanPrompter();
  const reporter = createTerminalReporter({ output: process.stderr, color: Boolean(process.stderr.isTTY) });
  let result;
  try {
    result = await runCouncil({
      scenarioText,
      config,
      cwd: process.cwd(),
      onEvent: reporter.event,
      askUser: humanPrompter.askQuestions
    });
    await fs.writeFile(
      path.join(result.runDir, "replay-source.md"),
      `# Replay source\n\nThis run replayed the scenario frozen at:\n\n\`${path.relative(process.cwd(), sourceDir)}\`\n`,
      "utf8"
    );
  } finally {
    reporter.finish();
    humanPrompter.close();
  }
  if (process.stdout.isTTY) {
    reporter.finalPath(result.finalPath);
    if (result.htmlPath) reporter.htmlPath(result.htmlPath);
  } else {
    console.log(result.finalPath);
    if (result.htmlPath) console.log(result.htmlPath);
  }
}

async function readSourceTraceMeta(sourceDir: string): Promise<{ template: string | null; council_preset: string | null }> {
  const tracePath = path.join(sourceDir, "trace.jsonl");
  if (!(await pathExists(tracePath))) return { template: null, council_preset: null };
  try {
    const text = await readText(tracePath);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed);
      if (event.type === "run.started") {
        return {
          template: typeof event.template === "string" ? event.template : null,
          council_preset: typeof event.council_preset === "string" ? event.council_preset : null
        };
      }
    }
  } catch {
    // ignore
  }
  return { template: null, council_preset: null };
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
  const templates = TEMPLATE_IDS.join(" | ");
  const councils = listCouncilPresets().map((preset) => preset.id).join(" | ");
  console.log(`agent-order

Usage:
  agent-order <scenario text | scenario.md> [options]
  agent-order grill <scenario text | scenario.md> [options]
  agent-order <template> <scenario text | scenario.md> [options]
  agent-order replay <run-dir> [options]
  agent-order init [--config agent-order.config.yaml]
  agent-order check [--config agent-order.config.yaml]
  agent-order doctor [--config agent-order.config.yaml]

Templates:
  ${templates}

Depth presets:
  ${councils}

Options:
  --config <path>           Config file path. Defaults to agent-order.config.yaml if present.
  --depth <name>            Deliberation depth: quick, standard, deep, or cheap.
  --council <name>          Advanced alias for --depth.
  --agents <ids>            Comma-separated agent ids to use from config.
  --template <id>           Use a built-in or user-provided artifact template.
  --templates-dir <path>    Directory of override templates (yaml/json).
  --max-turns <n>           Maximum agent turns before finalizing.
  --out <dir>               Base output directory. Default: ./agent-order-runs.
  --synthesizer <id>        Single-synthesizer agent id (when no aggregator layer).
  --intake <mode>           Optional intake mode. Currently supported: grill.
  --max-questions <n>       Maximum grill-mode intake questions. Default: 6.
  --human-input <mode>      never, on-blocking-questions, before-final, or interactive.
  --no-intake               Disable configured intake.
  --no-human-input          Disable mid-run user clarification pauses.
  --no-final-review         Skip final-review turns.
  --dry-run                 Write prompts/artifacts without invoking agents.
  -h, --help                Show this help.

Default agents:
  codex   adapter codex-cli, command codex
  claude  adapter claude-cli, command claude
`);
}
