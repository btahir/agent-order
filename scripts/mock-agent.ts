#!/usr/bin/env node

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk as Buffer);
}

const prompt = Buffer.concat(chunks).toString("utf8");
const phase = matchSection(prompt, "Phase") ?? "unknown";
const actor = matchSection(prompt, "Current Actor") ?? "mock";
const scenario = matchSection(prompt, "Scenario") ?? "unknown scenario";
const hasFinalReview = phase === "final-review";
const shouldAskQuestion =
  phase === "intake-question" ||
  (process.env.MOCK_AGENT_ASK_QUESTION === "1" && phase === "revision");

const peerTurnIds = extractPeerTurnIds(prompt, actor);
const rubricCriteria = extractRubricCriteria(prompt);

interface Claim {
  id: string;
  kind: string;
  text: string;
}

interface Objection {
  id: string;
  target_turn?: string;
  severity: string;
  text: string;
}

interface RubricScore {
  criterion_id: string;
  criterion_text: string;
  pass: boolean;
  evidence: string;
}

const claims: Claim[] = [];
const objections: Objection[] = [];
const rubric_scores: RubricScore[] = [];
const incorporated_objection_ids: string[] = [];

if (shouldEmitClaims(phase)) {
  claims.push(
    { id: "c1", kind: "recommendation", text: `Mock recommendation for ${phase}: take the obvious path.` },
    { id: "c2", kind: "assumption", text: "Assumed scenario constraints are accurate as stated." },
    { id: "c3", kind: "risk", text: "Mock-detected risk: the deliberation is illustrative, not real." }
  );
}

if (phase === "critique" && peerTurnIds.length > 0) {
  peerTurnIds.forEach((turnId, index) => {
    objections.push({
      id: `o${index + 1}`,
      target_turn: turnId,
      severity: index === 0 ? "blocking" : "major",
      text: `Mock critique of ${turnId}: missing concrete acceptance criterion.`
    });
  });
}

if (phase === "revision" || phase === "aggregator-synthesis" || phase === "meta-synthesis" || phase === "synthesis") {
  for (let i = 1; i <= 2; i += 1) {
    incorporated_objection_ids.push(`o${i}`);
  }
}

if (hasFinalReview && rubricCriteria.length > 0) {
  rubricCriteria.forEach((criterion, index) => {
    rubric_scores.push({
      criterion_id: criterion.id,
      criterion_text: criterion.text,
      pass: index % 4 !== 0,
      evidence: index % 4 !== 0 ? "Mock evidence: criterion satisfied in body." : "not present"
    });
  });
}

const output = {
  status: "ok",
  summary: `${actor} completed ${phase}.`,
  markdown: buildMarkdown({ actor, phase, scenario, claims, objections, rubric_scores }),
  blocking_issues: [],
  questions_for_user: shouldAskQuestion
    ? [
        {
          question:
            phase === "intake-question"
              ? "What outcome should the final report optimize for?"
              : "Should this recommendation optimize for speed or long-term maintainability?",
          why_it_matters:
            phase === "intake-question"
              ? "The answer guides how the council weighs tradeoffs."
              : "The answer changes the preferred path and risk tradeoffs.",
          recommended_answer:
            phase === "intake-question"
              ? "Optimize for a practical recommendation with clear tradeoffs."
              : "Optimize for speed for the first iteration, but preserve a migration path.",
          blocking: phase !== "intake-question"
        }
      ]
    : [],
  claims,
  objections,
  rubric_scores,
  incorporated_objection_ids
};

process.stdout.write(JSON.stringify(output, null, 2));

function shouldEmitClaims(p: string): boolean {
  return [
    "initial-position",
    "revision",
    "synthesis",
    "aggregator-synthesis",
    "meta-synthesis",
    "synthesis-revision"
  ].includes(p);
}

function buildMarkdown({
  actor,
  phase,
  scenario,
  claims,
  objections,
  rubric_scores
}: {
  actor: string;
  phase: string;
  scenario: string;
  claims: Claim[];
  objections: Objection[];
  rubric_scores: RubricScore[];
}): string {
  const lines: string[] = [`# ${actor} ${phase}`, ""];
  if (phase === "final-review") {
    lines.push("Rubric verdict:");
    for (const score of rubric_scores) {
      lines.push(`- \`${score.criterion_id}\`: ${score.pass ? "pass" : "fail"} - ${score.evidence}`);
    }
    if (rubric_scores.length === 0) lines.push("No rubric criteria available.");
    return lines.join("\n");
  }
  lines.push(`Scenario: ${scenario}`, "", "## Recommendation", "");
  for (const claim of claims) {
    if (claim.kind === "recommendation") lines.push(`- ${claim.text}`);
  }
  if (claims.some((claim) => claim.kind === "risk")) {
    lines.push("", "## Risks", "");
    for (const claim of claims) {
      if (claim.kind === "risk") lines.push(`- ${claim.text}`);
    }
  }
  if (objections.length > 0) {
    lines.push("", "## Objections raised", "");
    for (const obj of objections) {
      lines.push(`- (${obj.severity}) re ${obj.target_turn ?? "?"}: ${obj.text}`);
    }
  }
  if (phase === "intake-question") {
    lines.push("", "Mock intake follow-up to gather one decision-relevant fact.");
  }
  return lines.join("\n");
}

function matchSection(text: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(pattern);
  return match ? match[1].trim().split("\n")[0].trim() : null;
}

function extractPeerTurnIds(text: string, selfActor: string): string[] {
  const ids: string[] = [];
  const pattern = /^### (\d{4}) (.+?)\.([\w-]+)$/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const [, id, actorName] = match;
    if (actorName === selfActor) continue;
    ids.push(id);
  }
  return ids;
}

function extractRubricCriteria(text: string): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  const block = text.match(/Rubric \(binary pass\/fail criteria\):\n([\s\S]*?)(?=\n## |\n\n##|$)/);
  if (!block) return out;
  const lines = block[1].split("\n");
  for (const line of lines) {
    const m = line.match(/^- `([^`]+)`:\s+(.+)$/);
    if (m) out.push({ id: m[1], text: m[2].split(" - ")[0] });
  }
  return out;
}
