import type { ArtifactTemplate } from "../types.js";

export const migrationPlanTemplate: ArtifactTemplate = {
  id: "migration-plan",
  name: "Migration Plan",
  summary:
    "A migration plan that names the source and target states, the staged path between them, the rollback story at every stage, and the validation gates between stages.",
  scenario_shape: {
    description:
      "Describe what is being migrated, the source state, the target state, scale, and the timing pressure.",
    required_inputs: [
      "Source state (system, version, scale)",
      "Target state (system, version, scale)",
      "Why now (forcing function, deadline)",
      "Acceptable downtime if any"
    ]
  },
  synthesis_structure: {
    sections: [
      "Summary and forcing function",
      "Source state and target state",
      "Migration stages with entry and exit criteria",
      "Rollback strategy per stage",
      "Validation and testing strategy",
      "Cutover plan",
      "Risks and mitigations",
      "Observability and oncall plan",
      "Communication plan",
      "Decision log"
    ],
    notes: "Each stage must have an explicit rollback, not 'we revert if it breaks'."
  },
  rubric: [
    {
      id: "stages-defined",
      text: "Migration is broken into named stages, not a single big-bang cutover (or big-bang is explicitly justified)."
    },
    {
      id: "entry-exit",
      text: "Each stage has explicit entry and exit criteria."
    },
    {
      id: "rollback-per-stage",
      text: "Each stage has a concrete rollback plan, including data."
    },
    {
      id: "validation",
      text: "Validation strategy includes data integrity checks, not just functional tests."
    },
    {
      id: "blast-radius",
      text: "Blast radius is named per stage (which users / systems are affected)."
    },
    {
      id: "oncall",
      text: "Oncall and escalation plan is specified."
    },
    {
      id: "comms",
      text: "Communication plan addresses both internal stakeholders and any affected users."
    },
    {
      id: "decision-log",
      text: "Decision log captures any rejected alternatives (e.g., big-bang vs phased) with reasons."
    }
  ],
  intake_questions: [
    "What is the forcing function for this migration?",
    "What is the worst case if a stage has to be rolled back mid-flight?",
    "Who is on call during each stage?",
    "Are there data integrity checks that must pass before cutover?",
    "What does success look like one quarter after the migration ends?"
  ]
};
