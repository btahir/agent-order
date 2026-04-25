import type { AgentTurnResult, UserQuestion } from "./types.js";

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
          question: {
            type: "string"
          },
          why_it_matters: {
            type: "string"
          },
          recommended_answer: {
            type: "string"
          },
          blocking: {
            type: "boolean"
          }
        },
        required: ["question", "why_it_matters", "recommended_answer", "blocking"],
        additionalProperties: false
      }
    }
  },
  required: ["status", "summary", "markdown", "blocking_issues", "questions_for_user"],
  additionalProperties: false
};

export function normalizeAgentOutput(value: unknown): AgentTurnResult {
  if (typeof value === "string") {
    return {
      status: "ok",
      summary: firstSentence(value),
      markdown: value,
      blocking_issues: [],
      questions_for_user: []
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
    ? output.blocking_issues.filter((issue): issue is string => typeof issue === "string" && Boolean(issue.trim())).map((issue) => issue.trim())
    : [];

  const questionsForUser = Array.isArray(output.questions_for_user)
    ? output.questions_for_user.map(normalizeQuestion).filter((question): question is UserQuestion => Boolean(question))
    : [];

  return {
    status,
    summary,
    markdown,
    blocking_issues: blockingIssues,
    questions_for_user: questionsForUser
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

function firstSentence(text: string): string {
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const match = compact.match(/^(.{1,180}?)([.!?]\s|$)/);
  return (match ? match[1] : compact.slice(0, 180)).trim();
}
