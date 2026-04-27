import type { ArtifactTemplate } from "../types.js";

export const buildVsBuyTemplate: ArtifactTemplate = {
  id: "build-vs-buy",
  name: "Build vs Buy Memo",
  summary:
    "A memo that compares building in-house against buying or adopting an existing solution, with a defensible recommendation grounded in cost, risk, time-to-value, and strategic fit.",
  scenario_shape: {
    description:
      "Describe the capability under consideration, the candidate vendors or open-source options, and the team's constraints.",
    required_inputs: [
      "Capability under consideration",
      "Known vendors or candidate solutions",
      "Team capacity and skill",
      "Budget envelope and timeline"
    ]
  },
  synthesis_structure: {
    sections: [
      "Recommendation in one sentence",
      "Capability and success criteria",
      "Build option (scope, cost, timeline, ongoing burden)",
      "Buy options (per vendor: scope fit, cost, lock-in, exit cost)",
      "Risk comparison",
      "Strategic and team-fit considerations",
      "Recommendation rationale",
      "Decision log"
    ],
    notes: "Costs must include ongoing maintenance, not just initial build/license."
  },
  rubric: [
    {
      id: "recommendation-clear",
      text: "Single, unambiguous recommendation in the first paragraph."
    },
    {
      id: "build-tco",
      text: "Build option includes total cost of ownership over at least 3 years (build + maintenance)."
    },
    {
      id: "buy-options",
      text: "At least two buy options are evaluated, or absence of viable options is justified."
    },
    {
      id: "lock-in",
      text: "Vendor lock-in and exit cost are explicitly addressed."
    },
    {
      id: "risk-comparison",
      text: "Risks are compared on the same axes for build and buy (no apples-to-oranges)."
    },
    {
      id: "team-fit",
      text: "Team capacity and skill match are weighed against the build option."
    },
    {
      id: "strategic-fit",
      text: "Strategic fit (core vs commodity, differentiation) is addressed."
    },
    {
      id: "decision-log",
      text: "Decision log captures dissent and how it was resolved."
    }
  ],
  intake_questions: [
    "Is this capability core to the business or commodity?",
    "What is the realistic team capacity for ongoing maintenance?",
    "What is the cost of being wrong by 2x on either timeline or price?",
    "Are there compliance or data-residency constraints that rule out vendors?",
    "Who has signoff on the budget?"
  ]
};
