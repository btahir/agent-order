import type { AgentConfig, TurnRecord } from "../types.js";

interface PromptContextTurn extends TurnRecord {
  content: string;
}

export function buildPrompt({
  phase,
  actor,
  scenarioText,
  agents,
  contextTurns
}: {
  phase: string;
  actor: string;
  scenarioText: string;
  agents: AgentConfig[];
  contextTurns: PromptContextTurn[];
}): string {
  const roster = agents.map((agent) => `- ${agent.id}${agent.role ? `: ${agent.role}` : ""}`).join("\n");
  const context = contextTurns.length
    ? contextTurns.map(formatContextTurn).join("\n\n")
    : "No prior turns.";

  return [
    "# The Order of the Agents Turn",
    "",
    "You are participating in a turn-based multi-agent deliberation.",
    "The scenario may ask for a specification, technical plan, policy judgment, strategic recommendation, critique, or any other reasoned decision artifact.",
    "Do not write files, do not call external tools unless the CLI wrapper already provides them, and do not ask for interactive input.",
    "Your entire answer must be JSON that matches the provided schema. Put the user-facing content in the `markdown` field.",
    "",
    "## Output Contract",
    "",
    "- `status`: `ok` unless this turn identifies unresolved blocking issues.",
    "- `summary`: one concise sentence.",
    "- `markdown`: complete Markdown artifact for this turn.",
    "- `blocking_issues`: empty array unless blockers remain.",
    "- `questions_for_user`: empty array unless user clarification would materially improve or unblock the result.",
    "- Each user question must include `question`, `why_it_matters`, `recommended_answer`, and `blocking`.",
    "",
    "## Agent Roster",
    "",
    roster,
    "",
    "## Current Actor",
    "",
    actor,
    "",
    "## Phase",
    "",
    phase,
    "",
    "## Scenario",
    "",
    scenarioText.trim(),
    "",
    "## Prior Turn Artifacts",
    "",
    context,
    "",
    "## Turn Instructions",
    "",
    instructionsForPhase(phase, actor)
  ].join("\n");
}

function formatContextTurn(turn: PromptContextTurn): string {
  return [
    `### ${turn.id} ${turn.actor}.${turn.phase}`,
    "",
    "```md",
    turn.content.trim(),
    "```"
  ].join("\n");
}

function instructionsForPhase(phase: string, actor: string): string {
  switch (phase) {
    case "initial-position":
      return [
        "Create an independent position for the scenario.",
        "Do not defer to other agents; there are no prior positions in this phase.",
        "Match the scenario's requested form. If it asks for a specification, produce a specification. If it asks for a decision, produce a decision memo. If it asks for a plan, produce a plan.",
        "Include the key assumptions, recommendation, reasoning, risks, edge cases, and open questions that matter for this scenario."
      ].join("\n");
    case "intake-question":
      return [
        "Ask exactly one high-leverage clarification question for the scenario.",
        "Walk down the decision tree one dependency at a time. Do not ask a list of questions.",
        "Include your recommended answer and why the answer matters.",
        "Put the same question in `questions_for_user` with `blocking` set to false unless the council cannot proceed without it.",
        "If no further clarification is useful, set `questions_for_user` to an empty array and explain that the scenario is ready."
      ].join("\n");
    case "critique":
      return [
        "Critique the other agents' latest positions.",
        "Focus on missing context, weak assumptions, reasoning gaps, risks, ambiguities, and decisions that should be challenged.",
        "Do not rewrite the full answer. Produce actionable critique."
      ].join("\n");
    case "revision":
      return [
        "Revise your position using the critiques and prior positions.",
        "Keep the strongest parts of your original position, accept valid criticism, and explicitly reject weak criticism with rationale.",
        "Produce a revised answer in the form best suited to the scenario."
      ].join("\n");
    case "synthesis":
      return [
        `${actor} is the synthesizer for this turn.`,
        "Merge the strongest ideas into one final report.",
        "Include a decision log explaining major tradeoffs and any unresolved issues.",
        "Do not decide by vote; choose the best-supported direction for the scenario."
      ].join("\n");
    case "final-review":
      return [
        "Review the synthesized report for blocking issues only.",
        "If there are no blockers, set `status` to `ok`, use an empty `blocking_issues` array, and keep the markdown short.",
        "If there are blockers, set `status` to `blocked` and list concrete fixes."
      ].join("\n");
    case "synthesis-revision":
      return [
        `${actor} is revising the synthesized report after final reviews.`,
        "Apply valid blocking feedback, reject invalid feedback in the decision log, and produce the final report.",
        "The result should be ready to promote to `final/report.md`."
      ].join("\n");
    default:
      return "Produce the requested deliberation artifact.";
  }
}
