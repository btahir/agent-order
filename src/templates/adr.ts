import type { ArtifactTemplate } from "../types.js";

export const adrTemplate: ArtifactTemplate = {
  id: "adr",
  name: "Architecture Decision Record",
  summary:
    "An ADR that records the context, the decision, the alternatives that were rejected, and the consequences. Optimized for future readers who need to understand why, not what.",
  scenario_shape: {
    description: "Describe the architectural decision under discussion, the system context, and any constraints.",
    required_inputs: [
      "The decision in one sentence",
      "System context (the surrounding architecture)",
      "Constraints (performance, cost, team skill, regulatory)"
    ]
  },
  synthesis_structure: {
    sections: [
      "Title and status",
      "Context",
      "Decision",
      "Alternatives considered",
      "Consequences (positive and negative)",
      "Reversibility and migration path",
      "Open questions",
      "Decision log"
    ],
    notes: "Each rejected alternative must include the specific reason it was rejected, not just 'less good'."
  },
  rubric: [
    {
      id: "context-clear",
      text: "Context section explains what forced this decision now."
    },
    {
      id: "decision-specific",
      text: "The decision is specific enough that two engineers would implement the same thing.",
      guidance: "'Use a queue' fails. 'Use SQS standard with 30-second visibility timeout' passes."
    },
    {
      id: "alternatives-3",
      text: "At least three alternatives are evaluated, including 'do nothing' or status quo where applicable."
    },
    {
      id: "rejection-reasons",
      text: "Every rejected alternative has a concrete reason for rejection."
    },
    {
      id: "consequences-both",
      text: "Consequences include both positive and negative effects."
    },
    {
      id: "reversibility",
      text: "States how reversible the decision is and what the migration path looks like."
    },
    {
      id: "operational-impact",
      text: "Calls out operational impact (oncall, observability, deploys)."
    },
    {
      id: "decision-log",
      text: "Decision log captures who pushed back and how it was resolved."
    }
  ],
  intake_questions: [
    "What is the one-sentence decision under discussion?",
    "What forced this decision now (deadline, incident, constraint)?",
    "What alternatives are already on the table?",
    "What is the cost of being wrong?",
    "Who has veto rights on this decision?"
  ]
};
