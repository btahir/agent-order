import type { AgentTurnResult, Claim, ClaimKind, Objection, ObjectionSeverity, RubricScore, UserQuestion } from "./types.js";

const CLAIM_KINDS: ClaimKind[] = ["recommendation", "assumption", "risk", "fact", "decision"];
const OBJECTION_SEVERITIES: ObjectionSeverity[] = ["blocking", "major", "minor"];

export const agentTurnSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["ok", "blocked"]
    },
    summary: {
      type: "string"
    },
    markdown: {
      type: "string"
    },
    blocking_issues: {
      type: "array",
      items: {
        type: "string"
      }
    },
    questions_for_user: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          why_it_matters: { type: "string" },
          recommended_answer: { type: "string" },
          blocking: { type: "boolean" }
        },
        required: ["question", "why_it_matters", "recommended_answer", "blocking"],
        additionalProperties: false
      }
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: CLAIM_KINDS },
          text: { type: "string" },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 }
        },
        required: ["id", "kind", "text", "confidence"],
        additionalProperties: false
      }
    },
    objections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          target_turn: { type: ["string", "null"] },
          target_claim_id: { type: ["string", "null"] },
          severity: { type: "string", enum: OBJECTION_SEVERITIES },
          text: { type: "string" },
          suggested_fix: { type: ["string", "null"] }
        },
        required: ["id", "target_turn", "target_claim_id", "severity", "text", "suggested_fix"],
        additionalProperties: false
      }
    },
    rubric_scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion_id: { type: "string" },
          criterion_text: { type: "string" },
          pass: { type: "boolean" },
          evidence: { type: "string" }
        },
        required: ["criterion_id", "criterion_text", "pass", "evidence"],
        additionalProperties: false
      }
    },
    incorporated_objection_ids: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "status",
    "summary",
    "markdown",
    "blocking_issues",
    "questions_for_user",
    "claims",
    "objections",
    "rubric_scores",
    "incorporated_objection_ids"
  ],
  additionalProperties: false
};

export function normalizeAgentOutput(value: unknown): AgentTurnResult {
  if (typeof value === "string") {
    return {
      status: "ok",
      summary: firstSentence(value),
      markdown: value,
      blocking_issues: [],
      questions_for_user: [],
      claims: [],
      objections: [],
      rubric_scores: [],
      incorporated_objection_ids: []
    };
  }

  if (!value || typeof value !== "object") {
    throw new Error("Agent output must be a JSON object or markdown string.");
  }

  const output = value as Record<string, unknown>;
  const status = output.status === "blocked" ? "blocked" : "ok";
  const markdown = typeof output.markdown === "string" ? output.markdown.trim() : "";
  if (!markdown) {
    throw new Error("Agent output is missing a non-empty markdown field.");
  }

  const summary =
    typeof output.summary === "string" && output.summary.trim()
      ? output.summary.trim()
      : firstSentence(markdown);

  const blockingIssues = Array.isArray(output.blocking_issues)
    ? output.blocking_issues
        .filter((issue): issue is string => typeof issue === "string" && Boolean(issue.trim()))
        .map((issue) => issue.trim())
    : [];

  const questionsForUser = Array.isArray(output.questions_for_user)
    ? output.questions_for_user
        .map(normalizeQuestion)
        .filter((question): question is UserQuestion => Boolean(question))
    : [];

  const claims = Array.isArray(output.claims)
    ? output.claims.map(normalizeClaim).filter((claim): claim is Claim => Boolean(claim))
    : [];

  const objections = Array.isArray(output.objections)
    ? output.objections.map(normalizeObjection).filter((obj): obj is Objection => Boolean(obj))
    : [];

  const rubricScores = Array.isArray(output.rubric_scores)
    ? output.rubric_scores
        .map(normalizeRubricScore)
        .filter((score): score is RubricScore => Boolean(score))
    : [];

  const incorporatedObjectionIds = Array.isArray(output.incorporated_objection_ids)
    ? output.incorporated_objection_ids
        .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        .map((id) => id.trim())
    : [];

  return {
    status,
    summary,
    markdown,
    blocking_issues: blockingIssues,
    questions_for_user: questionsForUser,
    claims,
    objections,
    rubric_scores: rubricScores,
    incorporated_objection_ids: incorporatedObjectionIds
  };
}

function normalizeQuestion(value: unknown): UserQuestion | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) return null;
  return {
    question,
    why_it_matters: typeof input.why_it_matters === "string" ? input.why_it_matters.trim() : "",
    recommended_answer: typeof input.recommended_answer === "string" ? input.recommended_answer.trim() : "",
    blocking: Boolean(input.blocking)
  };
}

function normalizeClaim(value: unknown): Claim | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const kindRaw = typeof input.kind === "string" ? input.kind.trim() : "";
  if (!id || !text) return null;
  const kind: ClaimKind = (CLAIM_KINDS as string[]).includes(kindRaw) ? (kindRaw as ClaimKind) : "fact";
  const confidence = typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1
    ? input.confidence
    : undefined;
  return { id, kind, text, ...(confidence !== undefined ? { confidence } : {}) };
}

function normalizeObjection(value: unknown): Objection | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!id || !text) return null;
  const severityRaw = typeof input.severity === "string" ? input.severity.trim() : "minor";
  const severity: ObjectionSeverity = (OBJECTION_SEVERITIES as string[]).includes(severityRaw)
    ? (severityRaw as ObjectionSeverity)
    : "minor";
  const targetTurn = typeof input.target_turn === "string" && input.target_turn.trim() ? input.target_turn.trim() : null;
  const targetClaim = typeof input.target_claim_id === "string" && input.target_claim_id.trim()
    ? input.target_claim_id.trim()
    : null;
  const suggestedFix = typeof input.suggested_fix === "string" && input.suggested_fix.trim()
    ? input.suggested_fix.trim()
    : undefined;
  return {
    id,
    target_turn: targetTurn,
    target_claim_id: targetClaim,
    severity,
    text,
    ...(suggestedFix ? { suggested_fix: suggestedFix } : {})
  };
}

function normalizeRubricScore(value: unknown): RubricScore | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const criterionId = typeof input.criterion_id === "string" ? input.criterion_id.trim() : "";
  const criterionText = typeof input.criterion_text === "string" ? input.criterion_text.trim() : "";
  const evidence = typeof input.evidence === "string" ? input.evidence.trim() : "";
  if (!criterionId) return null;
  return {
    criterion_id: criterionId,
    criterion_text: criterionText || criterionId,
    pass: Boolean(input.pass),
    evidence
  };
}

function firstSentence(text: string): string {
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const match = compact.match(/^(.{1,180}?)([.!?]\s|$)/);
  return (match ? match[1] : compact.slice(0, 180)).trim();
}
