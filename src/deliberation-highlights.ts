import type { TurnRecord } from "./types.js";

export type DeliberationHighlightKind =
  | "summary"
  | "decision"
  | "recommendation"
  | "risk"
  | "disagreement"
  | "rubric"
  | "revision";

export interface DeliberationHighlight {
  kind: DeliberationHighlightKind;
  turnId: string;
  actor: string;
  phase: string;
  text: string;
}

export function highlightsForTurn(turn: TurnRecord, limit = 3): DeliberationHighlight[] {
  const highlights: DeliberationHighlight[] = [];

  if (turn.summary) {
    highlights.push({
      kind: "summary",
      turnId: turn.id,
      actor: turn.actor,
      phase: turn.phase,
      text: snippet(turn.summary)
    });
  }

  const decision = turn.claims.find((claim) => claim.kind === "decision");
  if (decision) {
    highlights.push({
      kind: "decision",
      turnId: turn.id,
      actor: turn.actor,
      phase: turn.phase,
      text: snippet(decision.text)
    });
  } else {
    const recommendation = turn.claims.find((claim) => claim.kind === "recommendation");
    if (recommendation) {
      highlights.push({
        kind: "recommendation",
        turnId: turn.id,
        actor: turn.actor,
        phase: turn.phase,
        text: snippet(recommendation.text)
      });
    }
  }

  const seriousObjection = turn.objections.find(
    (objection) => objection.severity === "blocking" || objection.severity === "major"
  );
  if (seriousObjection) {
    const target = seriousObjection.target_turn ? `target ${seriousObjection.target_turn}: ` : "";
    highlights.push({
      kind: "disagreement",
      turnId: turn.id,
      actor: turn.actor,
      phase: turn.phase,
      text: snippet(`${seriousObjection.severity} ${target}${seriousObjection.text}`)
    });
  }

  const risk = turn.claims.find((claim) => claim.kind === "risk");
  if (risk) {
    highlights.push({
      kind: "risk",
      turnId: turn.id,
      actor: turn.actor,
      phase: turn.phase,
      text: snippet(risk.text)
    });
  }

  const failedRubric = turn.rubricScores.find((score) => !score.pass);
  if (failedRubric) {
    highlights.push({
      kind: "rubric",
      turnId: turn.id,
      actor: turn.actor,
      phase: turn.phase,
      text: snippet(`failed ${failedRubric.criterion_id}: ${failedRubric.evidence}`)
    });
  }

  if (turn.incorporatedObjectionIds.length > 0) {
    const ids = turn.incorporatedObjectionIds.slice(0, 4).join(", ");
    const suffix = turn.incorporatedObjectionIds.length > 4 ? ", ..." : "";
    highlights.push({
      kind: "revision",
      turnId: turn.id,
      actor: turn.actor,
      phase: turn.phase,
      text: `incorporated objections ${ids}${suffix}`
    });
  }

  return prioritize(highlights, turn.phase).slice(0, limit);
}

export function collectDeliberationHighlights(
  turns: TurnRecord[],
  { perTurn = 2, max = 16 }: { perTurn?: number; max?: number } = {}
): DeliberationHighlight[] {
  const highlights = turns.flatMap((turn) => highlightsForTurn(turn, perTurn));
  return highlights.slice(0, max);
}

export function formatHighlightEvent(highlight: DeliberationHighlight): string {
  return `highlight: ${highlight.turnId} ${highlight.actor} ${highlight.phase} | ${highlight.kind} | ${highlight.text}`;
}

function prioritize(highlights: DeliberationHighlight[], phase: string): DeliberationHighlight[] {
  const order =
    phase === "critique"
      ? ["disagreement", "summary", "risk", "recommendation", "decision", "rubric", "revision"]
      : phase === "final-review"
        ? ["rubric", "summary", "disagreement", "risk", "decision", "recommendation", "revision"]
        : phase.includes("revision")
          ? ["revision", "decision", "recommendation", "summary", "risk", "disagreement", "rubric"]
          : phase.includes("synthesis")
            ? ["decision", "recommendation", "summary", "risk", "disagreement", "rubric", "revision"]
            : ["decision", "recommendation", "summary", "risk", "disagreement", "rubric", "revision"];

  return [...highlights].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

function snippet(value: string, maxLength = 150): string {
  const compact = value
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= maxLength) return compact;
  return compact.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}
