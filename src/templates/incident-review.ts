import type { ArtifactTemplate } from "../types.js";

export const incidentReviewTemplate: ArtifactTemplate = {
  id: "incident-review",
  name: "Incident Review",
  summary:
    "A blameless incident review that establishes what happened, why, what we got right, what we got wrong, and the specific changes that will prevent recurrence or reduce impact.",
  scenario_shape: {
    description:
      "Describe the incident: what was impacted, when, for how long, and the rough sequence of events.",
    required_inputs: [
      "Impact (users, systems, dollars)",
      "Detection time and resolution time",
      "Rough timeline of events",
      "Known contributing factors"
    ]
  },
  synthesis_structure: {
    sections: [
      "Summary and impact",
      "Timeline",
      "Contributing factors",
      "What went well",
      "What went poorly",
      "Action items (with owners and due dates)",
      "Detection and response improvements",
      "Lessons and patterns",
      "Decision log"
    ],
    notes: "Action items must have owners and concrete acceptance criteria, not 'we should improve X'."
  },
  rubric: [
    {
      id: "impact-quantified",
      text: "Impact is quantified (users, time, dollars, requests)."
    },
    {
      id: "timeline-specific",
      text: "Timeline is specific to the minute where possible, including detection and key decision points."
    },
    {
      id: "blameless",
      text: "Tone is blameless; framing is on systems, not individuals."
    },
    {
      id: "contributing-factors",
      text: "Multiple contributing factors are identified, not a single root cause."
    },
    {
      id: "what-well",
      text: "Includes a 'what went well' section with at least two concrete items."
    },
    {
      id: "actions-owned",
      text: "Every action item has an owner and a due date or trigger."
    },
    {
      id: "detection",
      text: "Includes at least one improvement to detection (metric, alert, dashboard)."
    },
    {
      id: "patterns",
      text: "Surfaces a generalizable pattern or lesson, not just incident-specific fixes."
    }
  ],
  intake_questions: [
    "What was the customer-visible impact, and how long did it last?",
    "How was the incident detected? Could it have been detected sooner?",
    "What was the longest delay in the response, and what caused it?",
    "What near-misses or earlier warnings did we miss?",
    "What pattern from prior incidents shows up here?"
  ]
};
