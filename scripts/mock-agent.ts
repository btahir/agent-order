#!/usr/bin/env node

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const prompt = Buffer.concat(chunks).toString("utf8");
const phase = matchSection(prompt, "Phase") ?? "unknown";
const actor = matchSection(prompt, "Current Actor") ?? "mock";
const scenario = matchSection(prompt, "Scenario") ?? "unknown scenario";
const hasFinalReview = phase === "final-review";
const shouldAskQuestion = phase === "intake-question" || (process.env.MOCK_AGENT_ASK_QUESTION === "1" && phase === "revision");

const output = {
  status: "ok",
  summary: `${actor} completed ${phase}.`,
  markdown: [
    `# ${actor} ${phase}`,
    "",
    hasFinalReview ? "No blocking issues." : `Scenario: ${scenario}`,
    "",
    "## Notes",
    "",
    `This is deterministic mock output for ${phase}.`
  ].join("\n"),
  blocking_issues: [],
  questions_for_user: shouldAskQuestion
    ? [
        {
          question: phase === "intake-question"
            ? "What outcome should the final report optimize for?"
            : "Should this recommendation optimize for speed or long-term maintainability?",
          why_it_matters: phase === "intake-question"
            ? "The answer guides how the council weighs tradeoffs."
            : "The answer changes the preferred path and risk tradeoffs.",
          recommended_answer: phase === "intake-question"
            ? "Optimize for a practical recommendation with clear tradeoffs."
            : "Optimize for speed for the first iteration, but preserve a migration path.",
          blocking: phase !== "intake-question"
        }
      ]
    : []
};

process.stdout.write(JSON.stringify(output, null, 2));

function matchSection(text: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(pattern);
  return match ? match[1].trim().split("\n")[0].trim() : null;
}
