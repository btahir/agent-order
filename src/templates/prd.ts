import type { ArtifactTemplate } from "../types.js";

export const prdTemplate: ArtifactTemplate = {
  id: "prd",
  name: "Product Requirements Document",
  summary:
    "A PRD that names the problem, the user, the proposed solution shape, success criteria, scope cuts, and rollout risks. The artifact should be ready for engineering and design review.",
  scenario_shape: {
    description:
      "Describe the product problem, the user(s) you are building for, any known constraints, and what success would look like.",
    required_inputs: [
      "Problem statement",
      "Target user / persona",
      "Known constraints (timeline, platform, dependencies)",
      "Success signal (qualitative or quantitative)"
    ]
  },
  synthesis_structure: {
    sections: [
      "Overview",
      "Problem statement and user",
      "Goals and non-goals",
      "User stories",
      "Proposed solution",
      "Acceptance criteria",
      "Rollout plan and risks",
      "Telemetry and success measurement",
      "Open questions",
      "Decision log"
    ],
    notes:
      "Acceptance criteria must be testable. Rollout plan must call out reversibility and blast radius."
  },
  rubric: [
    {
      id: "problem-named",
      text: "Names a specific user-facing problem and who experiences it.",
      guidance: "Generic 'users want X' does not pass. Must reference an actual user or persona."
    },
    {
      id: "non-goals",
      text: "Explicitly lists non-goals.",
      guidance: "At least one non-goal must be present."
    },
    {
      id: "acceptance-testable",
      text: "Acceptance criteria are testable (an engineer could write a check).",
      guidance: "Vague phrasing like 'feels fast' fails."
    },
    {
      id: "rollout-risks",
      text: "Identifies rollout risks and a mitigation for each."
    },
    {
      id: "telemetry",
      text: "Specifies at least one success signal that can actually be measured.",
      guidance: "The signal must be concrete enough that someone could wire it up."
    },
    {
      id: "scope-cuts",
      text: "Calls out at least one scope cut or trade-off the team chose."
    },
    {
      id: "open-questions",
      text: "Surfaces unresolved questions rather than papering over them."
    },
    {
      id: "decision-log",
      text: "Includes a decision log that explains material trade-offs."
    }
  ],
  intake_questions: [
    "Who is the primary user, and what are they trying to accomplish?",
    "What success signal would tell you this feature is working?",
    "What constraints are non-negotiable (deadline, platform, integration)?",
    "What is explicitly out of scope?",
    "Who are the dependent teams or systems?"
  ]
};
