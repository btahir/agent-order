import type { AgentConfig } from "../types.js";

export interface AdapterPreset {
  id: string;
  description: string;
  resolve(id: string): AgentConfig;
}

const PRESETS: Record<string, AdapterPreset> = {
  codex: {
    id: "codex",
    description: "Codex CLI (OpenAI). Requires `codex` on PATH and a logged-in session.",
    resolve: (id) => ({
      id,
      adapter: "codex-cli",
      command: "codex",
      preset: "codex"
    })
  },
  claude: {
    id: "claude",
    description: "Claude CLI (Anthropic). Requires `claude` on PATH and a logged-in session.",
    resolve: (id) => ({
      id,
      adapter: "claude-cli",
      command: "claude",
      preset: "claude"
    })
  },
  gemini: {
    id: "gemini",
    description: "Gemini CLI (Google). Requires `gemini` on PATH and a logged-in session.",
    resolve: (id) => ({
      id,
      adapter: "generic-cli",
      command: "gemini",
      preset: "gemini",
      args: ["-p", "{{prompt}}"],
      input: { mode: "arg" },
      output: { mode: "stdout" },
      check_args: ["--version"]
    })
  },
  grok: {
    id: "grok",
    description: "Grok CLI (xAI). Requires `grok` on PATH.",
    resolve: (id) => ({
      id,
      adapter: "generic-cli",
      command: "grok",
      preset: "grok",
      args: ["chat", "{{prompt}}"],
      input: { mode: "arg" },
      output: { mode: "stdout" },
      check_args: ["--version"]
    })
  },
  qwen: {
    id: "qwen",
    description: "Qwen Code CLI. Requires `qwen` on PATH.",
    resolve: (id) => ({
      id,
      adapter: "generic-cli",
      command: "qwen",
      preset: "qwen",
      args: ["-p", "{{prompt}}"],
      input: { mode: "stdin" },
      output: { mode: "stdout" },
      check_args: ["--version"]
    })
  },
  deepseek: {
    id: "deepseek",
    description: "DeepSeek CLI. Requires `deepseek` on PATH.",
    resolve: (id) => ({
      id,
      adapter: "generic-cli",
      command: "deepseek",
      preset: "deepseek",
      args: ["chat", "{{prompt}}"],
      input: { mode: "arg" },
      output: { mode: "stdout" },
      check_args: ["--version"]
    })
  }
};

export function listPresets(): AdapterPreset[] {
  return Object.values(PRESETS);
}

export function getPreset(name: string): AdapterPreset | null {
  return PRESETS[name] ?? null;
}

export function resolvePresetAgent(id: string, presetName?: string): AgentConfig {
  const preset = PRESETS[presetName ?? id];
  if (!preset) {
    return { id, adapter: "generic-cli", command: id };
  }
  return preset.resolve(id);
}
