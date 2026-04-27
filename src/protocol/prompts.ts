import type { AgentConfig, ArtifactTemplate, RubricCriterion, TurnRecord } from "../types.js";

interface PromptContextTurn extends TurnRecord {
  content: string;
  displayLabel?: string;
  displayActor?: string;
}

export interface BuildPromptInput {
  phase: string;
  actor: string;
  scenarioText: string;
  agents: AgentConfig[];
  contextTurns: PromptContextTurn[];
  template?: ArtifactTemplate | null;
  anonymizeContext?: boolean;
  contextSummary?: string;
}

export function buildPrompt(input: BuildPromptInput): string {
  const {
    phase,
    actor,
    scenarioText,
    agents,
    contextTurns,
    template,
    anonymizeContext = false,
    contextSummary
  } = input;

  const roster = agents.map((agent) => `- ${agent.id}${agent.role ? `: ${agent.role}` : ""}`).join("\n");

  const renderedContext = contextTurns.length
    ? contextTurns.map((turn) => formatContextTurn(turn, anonymizeContext)).join("\n\n")
    : "No prior turns.";

  const sections: string[] = [
    "# The Order of the Agents Turn",
    "",
    "You are participating in a turn-based multi-agent deliberation that produces a written decision artifact.",
    "Do not write files, do not call external tools unless the CLI wrapper provides them, and do not ask for interactive input.",
    "Your entire answer must be JSON that matches the provided schema. Put the user-facing content in the `markdown` field.",
    "",
    "## Output Contract",
    "",
    outputContractText(),
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
    phase
  ];

  if (template) {
    sections.push("", "## Artifact Template", "", templateBlock(template, phase));
  }

  sections.push("", "## Scenario", "", scenarioText.trim());

  if (anonymizeContext) {
    sections.push(
      "",
      "## Anonymization Notice",
      "",
      "Peer responses below are presented as `Response A`, `Response B`, etc. The mapping from labels to agents is intentionally hidden.",
      "Do not guess which model wrote which response. Critique the substance, not the source."
    );
  }

  if (contextSummary) {
    sections.push("", "## Context Summary", "", contextSummary.trim());
  }

  sections.push("", "## Prior Turn Artifacts", "", renderedContext);
  sections.push("", "## Turn Instructions", "", instructionsForPhase(phase, actor, template));

  return sections.join("\n");
}

function outputContractText(): string {
  return [
    "Required fields:",
    "- `status`: `ok` unless this turn identifies unresolved blocking issues.",
    "- `summary`: one concise sentence describing the turn output.",
    "- `markdown`: complete Markdown artifact for this turn.",
    "- `blocking_issues`: array of short strings; empty unless blockers remain.",
    "- `questions_for_user`: empty array unless user clarification would materially improve the result. Each question must include `question`, `why_it_matters`, `recommended_answer`, and `blocking`.",
    "",
    "Structured fields are always present; leave arrays empty unless the phase calls for them:",
    "- `claims`: array of `{id, kind, text, confidence}` objects. `kind` is one of `recommendation`, `assumption`, `risk`, `fact`, `decision`. `id` is short and stable within this turn (e.g., `c1`, `c2`). Set `confidence` to a number from 0 to 1, or `null` when not useful.",
    "- `objections`: array of `{id, target_turn, target_claim_id, severity, text, suggested_fix}` objects. `severity` is one of `blocking`, `major`, `minor`. `target_turn` is a prior turn id like `0003`, or `null`. `target_claim_id` references a claim id from the targeted turn (e.g., `c2`), or `null`. Use `suggested_fix: null` when no specific fix is needed.",
    "- `rubric_scores`: array of `{criterion_id, criterion_text, pass, evidence}` objects. Use only when scoring against a template rubric.",
    "- `incorporated_objection_ids`: array of objection ids from prior turns that this turn addresses or accepts."
  ].join("\n");
}

function templateBlock(template: ArtifactTemplate, phase: string): string {
  const lines = [
    `Template: **${template.name}** (\`${template.id}\`)`,
    "",
    template.summary
  ];

  if (template.synthesis_structure?.sections?.length) {
    lines.push("", "Required sections in the synthesized artifact:");
    for (const section of template.synthesis_structure.sections) {
      lines.push(`- ${section}`);
    }
    if (template.synthesis_structure.notes) {
      lines.push("", template.synthesis_structure.notes);
    }
  }

  if (showRubric(phase) && template.rubric?.length) {
    lines.push("", "Rubric (binary pass/fail criteria):");
    for (const criterion of template.rubric) {
      lines.push(formatRubricCriterion(criterion));
    }
  }

  return lines.join("\n");
}

function formatRubricCriterion(criterion: RubricCriterion): string {
  const guidance = criterion.guidance ? ` - ${criterion.guidance}` : "";
  return `- \`${criterion.id}\`: ${criterion.text}${guidance}`;
}

function showRubric(phase: string): boolean {
  return [
    "synthesis",
    "synthesis-revision",
    "aggregator-synthesis",
    "meta-synthesis",
    "final-review"
  ].includes(phase);
}

function formatContextTurn(turn: PromptContextTurn, anonymized: boolean): string {
  const headerActor = anonymized
    ? turn.displayLabel ?? turn.anonymousLabel ?? "Anonymous"
    : turn.displayActor ?? turn.actor;
  const claimsBlock = turn.claims?.length
    ? "Claims:\n" + turn.claims.map((claim) => `- \`${claim.id}\` (${claim.kind}): ${claim.text}`).join("\n")
    : "";
  const objectionsBlock = turn.objections?.length
    ? "Objections raised:\n" +
      turn.objections
        .map((obj) => {
          const target = obj.target_turn
            ? ` -> ${obj.target_turn}${obj.target_claim_id ? `:${obj.target_claim_id}` : ""}`
            : "";
          return `- \`${obj.id}\` ${obj.severity}${target}: ${obj.text}`;
        })
        .join("\n")
    : "";

  const summaryLine = turn.summary ? `Summary: ${turn.summary}` : "";

  const blocks = [
    `### ${turn.id} ${headerActor}.${turn.phase}`,
    "",
    summaryLine,
    claimsBlock,
    objectionsBlock,
    summaryLine || claimsBlock || objectionsBlock ? "" : "",
    "```md",
    turn.content.trim(),
    "```"
  ].filter((block) => block !== "");
  return blocks.join("\n");
}

function instructionsForPhase(phase: string, actor: string, template: ArtifactTemplate | null | undefined): string {
  const templateName = template ? `${template.name} (${template.id})` : null;

  switch (phase) {
    case "initial-position":
      return [
        "Create an independent position for the scenario.",
        "Do not defer to other agents; you have no prior peer context in this phase.",
        templateName
          ? `The artifact you produce should be a draft ${templateName}, structured around the template's required sections.`
          : "Match the scenario's requested form (specification, decision memo, plan, etc.).",
        "Include the key assumptions, recommendation, reasoning, risks, edge cases, and open questions that matter for this scenario.",
        "Populate `claims` with at minimum your top recommendations, key assumptions, and identified risks. Do not include trivial facts.",
        "Leave `objections`, `rubric_scores`, and `incorporated_objection_ids` empty in this phase."
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");

    case "intake-question":
      return [
        "Ask exactly one high-leverage clarification question for the scenario.",
        "Walk down the decision tree one dependency at a time. Do not ask a list of questions.",
        "Include your recommended answer and why it matters.",
        "Put the same question in `questions_for_user` with `blocking` set to false unless the agents cannot proceed without it.",
        "If no further clarification is useful, set `questions_for_user` to an empty array and explain that the scenario is ready.",
        "Leave `claims`, `objections`, `rubric_scores`, and `incorporated_objection_ids` empty in this phase."
      ].join("\n");

    case "critique":
      return [
        "Critique the peer responses shown above.",
        "Focus on missing context, weak assumptions, reasoning gaps, risks, ambiguities, and decisions that should be challenged.",
        "Do not rewrite the full answer. Produce actionable critique.",
        "Populate `objections` for every concrete issue you raise. Set `target_turn` to the peer's turn id, and `target_claim_id` to the specific claim id when applicable. Use `severity` `blocking` only for issues that would prevent the artifact from shipping.",
        "Leave `claims`, `rubric_scores`, and `incorporated_objection_ids` empty in this phase."
      ].join("\n");

    case "revision":
      return [
        "Revise your position using the critiques and prior peer positions.",
        "Keep the strongest parts of your original position, accept valid criticism, and explicitly reject weak criticism with rationale.",
        "Populate `claims` with the updated set of recommendations, assumptions, and risks (these may overlap with your initial-position claim ids; reuse ids when the claim is unchanged in substance).",
        "Populate `incorporated_objection_ids` with the objection ids from prior turns that you accepted or addressed.",
        "Use `objections` only to push back on critiques you reject; cite the objection id you are rejecting in `target_claim_id` style as `o<n>`."
      ].join("\n");

    case "synthesis":
      return [
        `${actor} is the synthesizer for this turn.`,
        templateName
          ? `Produce the final ${templateName} by merging the strongest ideas from the peer agents.`
          : "Merge the strongest ideas into one final report.",
        "Include a decision log section explaining major tradeoffs and any unresolved issues.",
        "Do not decide by vote; choose the best-supported direction for the scenario.",
        templateName
          ? "Conform to the template's required sections."
          : "",
        "Populate `claims` for the final recommendations, key assumptions, risks, and decisions in the synthesized artifact.",
        "Populate `incorporated_objection_ids` with every objection id you accepted from earlier turns.",
        "Leave `rubric_scores` empty here; final-review will produce them."
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");

    case "aggregator-synthesis":
      return [
        `${actor} is producing one of multiple aggregator outputs that will feed a meta-synthesis.`,
        templateName
          ? `Produce a candidate ${templateName} that integrates the peer agents' deliberation.`
          : "Produce a candidate synthesis integrating the peer agents' deliberation.",
        "Be opinionated. The meta-synthesizer will reconcile differences across aggregators.",
        "Populate `claims` for your recommended decisions, assumptions, and risks.",
        "Populate `incorporated_objection_ids` with the objection ids from prior turns you accepted.",
        "Leave `rubric_scores` empty here."
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");

    case "meta-synthesis":
      return [
        `${actor} is producing the final artifact by reconciling multiple anonymized aggregator outputs.`,
        templateName
          ? `Produce the final ${templateName} that conforms to the template's required sections.`
          : "Produce the final synthesized artifact.",
        "Aggregator outputs are presented anonymously. Do not guess which model wrote which.",
        "Resolve disagreements on substance, not source. Where reasonable consensus exists, adopt it; where strong dissent exists and is well-supported, surface it explicitly in a `## Minority Report` section.",
        "Include a `## Decision Log` section explaining major tradeoffs.",
        "Populate `claims` for the final decisions, assumptions, and risks.",
        "Populate `incorporated_objection_ids` with every objection id from earlier turns that you accepted."
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");

    case "final-review":
      return [
        "Review the synthesized report.",
        templateName
          ? "Score the report against every rubric criterion shown in the Artifact Template section above. Use binary pass/fail. Cite a short evidence quote (or note its absence) for each criterion in the `evidence` field."
          : "Identify blocking issues. Set `status` to `blocked` and list concrete fixes if blockers exist; otherwise return `ok` with an empty `blocking_issues` array.",
        "Populate `rubric_scores` with one entry per template rubric criterion. Set `pass` to true only if the report clearly satisfies the criterion.",
        "Populate `objections` for any issues with severity `blocking` or `major`. Reference the synthesized report's turn id in `target_turn` and the relevant claim id in `target_claim_id` when possible.",
        "Set `status` to `blocked` if any rubric criterion fails or any blocking objection is raised.",
        "Keep the `markdown` short: a list of pass/fail rubric outcomes and a short rationale per failure."
      ].join("\n");

    case "synthesis-revision":
      return [
        `${actor} is revising the synthesized report after final reviews.`,
        "Apply valid blocking feedback, reject invalid feedback in the decision log with rationale, and produce the final report.",
        "Populate `claims` for the updated final decisions, assumptions, and risks.",
        "Populate `incorporated_objection_ids` with the objection ids from final-review that you accepted."
      ].join("\n");

    default:
      return "Produce the requested deliberation artifact.";
  }
}
