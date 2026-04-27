import type { ArtifactTemplate } from "../types.js";

export const rfcTemplate: ArtifactTemplate = {
  id: "rfc",
  name: "Request for Comments",
  summary:
    "A technical RFC that proposes a design and invites structured critique. Longer than an ADR; expected to enumerate trade-offs, design alternatives, and migration plan in detail.",
  scenario_shape: {
    description: "Describe the technical proposal, the problem it solves, and the surrounding system.",
    required_inputs: [
      "What is being proposed",
      "What problem it solves",
      "Affected systems and teams",
      "Timeline if known"
    ]
  },
  synthesis_structure: {
    sections: [
      "Summary",
      "Motivation",
      "Detailed design",
      "Alternatives considered",
      "Migration and rollout",
      "Risks and mitigations",
      "Observability and operability",
      "Open questions and call for comments",
      "Decision log"
    ],
    notes:
      "Detailed design must be concrete enough to estimate against. Migration must call out backwards-compatibility commitments."
  },
  rubric: [
    {
      id: "motivation-grounded",
      text: "Motivation references a specific problem, incident, or constraint, not 'we should improve X'."
    },
    {
      id: "design-detailed",
      text: "Detailed design is specific enough for an engineer to estimate effort."
    },
    {
      id: "alternatives-evaluated",
      text: "At least two real alternatives are evaluated with named trade-offs."
    },
    {
      id: "migration-plan",
      text: "Migration plan identifies who has to do what and in what order."
    },
    {
      id: "backcompat",
      text: "Backwards-compatibility commitments are explicit (or absence is justified)."
    },
    {
      id: "risks-named",
      text: "Each risk has a named mitigation, owner, or trigger condition."
    },
    {
      id: "observability",
      text: "Observability and operability are addressed (metrics, alerts, rollback path)."
    },
    {
      id: "open-questions",
      text: "Open questions are surfaced, not buried."
    }
  ],
  intake_questions: [
    "What is the smallest version of this proposal that still solves the problem?",
    "Who absolutely must sign off?",
    "What's the timeline pressure?",
    "What is the single biggest risk if this is wrong?",
    "What constraints are real (compliance, contract) vs. preferences?"
  ]
};
