import { runClaudeTurn, checkClaude } from "./claude.js";
import { runCodexTurn, checkCodex } from "./codex.js";
import { runGenericTurn, checkGeneric } from "./generic.js";
import type { AdapterTurnOutput, AgentCheckResult, AgentConfig, AgentTurnInvocation, CouncilConfig } from "../types.js";

export async function runAgentTurn(args: AgentTurnInvocation): Promise<AdapterTurnOutput> {
  switch (args.agent.adapter) {
    case "codex-cli":
      return runCodexTurn(args);
    case "claude-cli":
      return runClaudeTurn(args);
    case "generic-cli":
      return runGenericTurn(args);
    default:
      throw new Error(`Unsupported adapter "${args.agent.adapter}" for agent ${args.agent.id}.`);
  }
}

export async function checkAgent(agent: AgentConfig, config: CouncilConfig): Promise<AgentCheckResult> {
  switch (agent.adapter) {
    case "codex-cli":
      return checkCodex(agent, config);
    case "claude-cli":
      return checkClaude(agent, config);
    case "generic-cli":
      return checkGeneric(agent, config);
    default:
      return {
        ok: false,
        agent: agent.id,
        adapter: agent.adapter,
        message: `Unsupported adapter "${agent.adapter}".`
      };
  }
}
