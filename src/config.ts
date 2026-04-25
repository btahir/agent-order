import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { pathExists } from "./fs-utils.js";
import type { AgentConfig, CliFlags, CouncilConfig } from "./types.js";

const DEFAULT_CONFIG_NAMES = [
  "agent-order.config.yaml",
  "agent-order.config.yml",
  "agent-order.config.json",
  ".agent-order.yaml",
  ".agent-order.yml",
  ".agent-order.json"
];

export const defaultConfig: CouncilConfig = {
  protocol: "agent-order/v1",
  agents: [
    { id: "codex", adapter: "codex-cli", command: "codex" },
    { id: "claude", adapter: "claude-cli", command: "claude" }
  ],
  limits: {
    max_turns: 12
  },
  output: {
    dir: "./agent-order-runs"
  },
  synthesis: {
    agent: null
  },
  intake: {
    enabled: false,
    mode: "off",
    facilitator: null,
    max_questions: 6
  },
  human_input: {
    mode: "on_blocking_questions",
    max_questions_per_pause: 3,
    ask_before_final: false
  },
  final_review: {
    enabled: true
  },
  adapters: {
    codex: {
      timeout_ms: 600000,
      sandbox: "read-only",
      approval_policy: "never",
      skip_git_repo_check: true,
      ephemeral: true
    },
    claude: {
      timeout_ms: 600000,
      permission_mode: "dontAsk",
      tools: "",
      output_format: "json",
      no_session_persistence: true,
      strict_mcp_config: true
    },
    generic: {
      timeout_ms: 600000
    }
  }
};

export async function loadConfig(flags: CliFlags, cwd = process.cwd()): Promise<CouncilConfig> {
  const discovered = flags.configPath
    ? path.resolve(cwd, flags.configPath)
    : await discoverConfigPath(cwd);

  const loaded = discovered ? await readConfig(discovered) : {};
  const explicitMaxTurns = flags.maxTurns !== undefined || loaded?.limits?.max_turns !== undefined;
  const config = mergeConfig(defaultConfig, loaded);

  if (flags.agents) {
    const selected = flags.agents.split(",").map((id) => id.trim()).filter(Boolean);
    config.agents = config.agents.filter((agent) => selected.includes(agent.id));
    for (const id of selected) {
      if (!config.agents.some((agent) => agent.id === id)) {
        config.agents.push(inferAgentConfig(id));
      }
    }
    if (!flags.synthesizer && config.synthesis.agent && !selected.includes(config.synthesis.agent)) {
      config.synthesis.agent = selected[0] ?? null;
    }
  }

  if (flags.maxTurns !== undefined) {
    const maxTurns = Number.parseInt(flags.maxTurns, 10);
    if (!Number.isFinite(maxTurns) || maxTurns < 1) {
      throw new Error("--max-turns must be a positive integer.");
    }
    config.limits.max_turns = maxTurns;
  }

  if (flags.outDir) config.output.dir = flags.outDir;
  if (flags.synthesizer) config.synthesis.agent = flags.synthesizer;
  if (flags.intake) {
    config.intake.mode = flags.intake === "off" ? "off" : flags.intake;
    config.intake.enabled = flags.intake !== "off";
  }
  if (flags.maxQuestions !== undefined) {
    const maxQuestions = Number.parseInt(flags.maxQuestions, 10);
    if (!Number.isFinite(maxQuestions) || maxQuestions < 1) {
      throw new Error("--max-questions must be a positive integer.");
    }
    config.intake.max_questions = maxQuestions;
  }
  if (flags.humanInput) {
    config.human_input.mode = normalizeHumanInputMode(flags.humanInput);
  }
  if (flags.finalReview === false) config.final_review.enabled = false;
  if (flags.dryRun) config.dry_run = true;
  if (!explicitMaxTurns) {
    const intakeTurns = config.intake.enabled ? config.intake.max_questions * 2 + 2 : 0;
    config.limits.max_turns = Math.max(12 + intakeTurns, config.agents.length * 4 + 4 + intakeTurns);
  }

  validateConfig(config);
  config.__configPath = discovered;
  return config;
}

export async function writeDefaultConfig(targetPath: string): Promise<void> {
  const config = {
    protocol: "agent-order/v1",
    agents: [
      {
        id: "codex",
        adapter: "codex-cli",
        command: "codex"
      },
      {
        id: "claude",
        adapter: "claude-cli",
        command: "claude"
      }
    ],
    limits: {
      max_turns: 12
    },
    output: {
      dir: "./agent-order-runs"
    },
    synthesis: {
      agent: "codex"
    },
    intake: {
      enabled: false,
      mode: "off",
      facilitator: "codex",
      max_questions: 6
    },
    human_input: {
      mode: "on_blocking_questions",
      max_questions_per_pause: 3,
      ask_before_final: false
    },
    final_review: {
      enabled: true
    }
  };

  await fs.writeFile(targetPath, YAML.stringify(config), "utf8");
}

async function discoverConfigPath(cwd: string): Promise<string | null> {
  for (const name of DEFAULT_CONFIG_NAMES) {
    const candidate = path.join(cwd, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function readConfig(configPath: string): Promise<Partial<CouncilConfig>> {
  const content = await fs.readFile(configPath, "utf8");
  if (configPath.endsWith(".json")) return JSON.parse(content);
  return YAML.parse(content) ?? {};
}

function mergeConfig<T>(base: T, override: unknown): T {
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override === undefined ? clone(base) : clone(override)) as T;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? clone(base) : clone(override)) as T;
  }

  const merged: Record<string, unknown> = { ...(clone(base) as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergeConfig((base as Record<string, unknown>)[key], value);
  }
  return merged as T;
}

function inferAgentConfig(id: string): AgentConfig {
  if (id === "codex") return { id, adapter: "codex-cli", command: "codex" };
  if (id === "claude") return { id, adapter: "claude-cli", command: "claude" };
  return { id, adapter: "generic-cli", command: id };
}

function validateConfig(config: CouncilConfig): void {
  if (config.protocol !== "agent-order/v1") {
    throw new Error(`Unsupported protocol: ${config.protocol}`);
  }

  if (!Array.isArray(config.agents) || config.agents.length === 0) {
    throw new Error("Config must define at least one agent.");
  }

  const seen = new Set();
  for (const agent of config.agents) {
    if (!agent.id || typeof agent.id !== "string") {
      throw new Error("Every agent must have a string id.");
    }
    if (seen.has(agent.id)) {
      throw new Error(`Duplicate agent id: ${agent.id}`);
    }
    seen.add(agent.id);
    if (!agent.adapter) {
      throw new Error(`Agent ${agent.id} is missing adapter.`);
    }
  }

  const synthesizer = config.synthesis.agent ?? config.agents[0].id;
  if (!seen.has(synthesizer)) {
    throw new Error(`Synthesizer agent "${synthesizer}" is not in the agent roster.`);
  }

  if (config.intake.enabled || config.intake.mode !== "off") {
    if (config.intake.mode !== "grill") {
      throw new Error(`Unsupported intake mode: ${config.intake.mode}`);
    }
    const facilitator: string = config.intake.facilitator ?? synthesizer;
    if (!seen.has(facilitator)) {
      throw new Error(`Intake facilitator "${facilitator}" is not in the agent roster.`);
    }
  }

  config.human_input.mode = normalizeHumanInputMode(config.human_input.mode ?? "on_blocking_questions");
}

function normalizeHumanInputMode(mode: unknown): CouncilConfig["human_input"]["mode"] {
  const normalized = String(mode).replaceAll("-", "_");
  switch (normalized) {
    case "never":
    case "on_blocking_questions":
    case "before_final":
    case "interactive":
      return normalized;
    default:
      throw new Error(`Unsupported human input mode: ${mode}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
