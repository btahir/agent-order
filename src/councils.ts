import { resolvePresetAgent } from "./adapters/presets.js";
import type { AgentConfig, CouncilConfig } from "./types.js";

export interface CouncilPreset {
  id: string;
  description: string;
  agents: string[];
  synthesis: {
    aggregators?: string[] | null;
    meta_synthesizer?: string | null;
    agent?: string | null;
  };
  final_review: boolean;
}

const PRESETS: Record<string, CouncilPreset> = {
  quick: {
    id: "quick",
    description: "Two agents, single synthesis, no aggregator. Cheap and fast. Closest to v0.1 default.",
    agents: ["codex", "claude"],
    synthesis: { agent: "codex", aggregators: null, meta_synthesizer: null },
    final_review: true
  },
  standard: {
    id: "standard",
    description: "Three agents across families, anonymized critique, single aggregator pass.",
    agents: ["codex", "claude", "gemini"],
    synthesis: { agent: null, aggregators: ["claude"], meta_synthesizer: "codex" },
    final_review: true
  },
  deep: {
    id: "deep",
    description: "Four agents across families, MoA aggregator layer with two aggregators plus meta-synthesis.",
    agents: ["codex", "claude", "gemini", "grok"],
    synthesis: { agent: null, aggregators: ["claude", "gemini"], meta_synthesizer: "codex" },
    final_review: true
  },
  cheap: {
    id: "cheap",
    description: "Open-source heavy roster with one frontier model for synthesis.",
    agents: ["qwen", "deepseek", "claude"],
    synthesis: { agent: null, aggregators: ["deepseek"], meta_synthesizer: "claude" },
    final_review: true
  }
};

export function listCouncilPresets(): CouncilPreset[] {
  return Object.values(PRESETS);
}

export function getCouncilPreset(name: string): CouncilPreset | null {
  return PRESETS[name] ?? null;
}

export function applyCouncilPreset(config: CouncilConfig, presetName: string): CouncilConfig {
  const preset = getCouncilPreset(presetName);
  if (!preset) {
    throw new Error(
      `Unknown council preset: ${presetName}. Known: ${Object.keys(PRESETS).join(", ")}.`
    );
  }

  const agents: AgentConfig[] = preset.agents.map((id) => resolvePresetAgent(id));
  config.agents = agents;
  config.synthesis = {
    agent: preset.synthesis.agent ?? null,
    aggregators: preset.synthesis.aggregators ?? null,
    meta_synthesizer: preset.synthesis.meta_synthesizer ?? null
  };
  config.final_review.enabled = preset.final_review;
  config.council_preset = preset.id;
  return config;
}
