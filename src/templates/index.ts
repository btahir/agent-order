import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { pathExists } from "../fs-utils.js";
import type { ArtifactTemplate, RubricCriterion } from "../types.js";
import { prdTemplate } from "./prd.js";
import { adrTemplate } from "./adr.js";
import { rfcTemplate } from "./rfc.js";
import { buildVsBuyTemplate } from "./build-vs-buy.js";
import { migrationPlanTemplate } from "./migration-plan.js";
import { incidentReviewTemplate } from "./incident-review.js";

const BUILT_IN_TEMPLATES: ArtifactTemplate[] = [
  prdTemplate,
  adrTemplate,
  rfcTemplate,
  buildVsBuyTemplate,
  migrationPlanTemplate,
  incidentReviewTemplate
];

export const TEMPLATE_IDS = BUILT_IN_TEMPLATES.map((template) => template.id);

export function listBuiltInTemplates(): ArtifactTemplate[] {
  return BUILT_IN_TEMPLATES.map((template) => structuredClone(template));
}

export function getBuiltInTemplate(id: string): ArtifactTemplate | null {
  const found = BUILT_IN_TEMPLATES.find((template) => template.id === id);
  return found ? structuredClone(found) : null;
}

export async function loadTemplate(id: string, templatesDir: string | null = null): Promise<ArtifactTemplate | null> {
  if (templatesDir) {
    const override = await tryLoadFromDir(id, templatesDir);
    if (override) return override;
  }
  return getBuiltInTemplate(id);
}

async function tryLoadFromDir(id: string, dir: string): Promise<ArtifactTemplate | null> {
  for (const ext of [".yaml", ".yml", ".json"]) {
    const candidate = path.join(dir, `${id}${ext}`);
    if (await pathExists(candidate)) {
      const content = await fs.readFile(candidate, "utf8");
      const parsed = ext === ".json" ? JSON.parse(content) : YAML.parse(content);
      return validateTemplate(parsed);
    }
  }
  return null;
}

function validateTemplate(value: unknown): ArtifactTemplate {
  if (!value || typeof value !== "object") {
    throw new Error("Template must be a non-empty object.");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id.trim()) throw new Error("Template missing `id`.");
  if (typeof obj.name !== "string" || !obj.name.trim()) throw new Error("Template missing `name`.");
  if (typeof obj.summary !== "string") throw new Error("Template missing `summary`.");
  const synthesisStructure = obj.synthesis_structure as Record<string, unknown> | undefined;
  if (!synthesisStructure || !Array.isArray(synthesisStructure.sections)) {
    throw new Error("Template `synthesis_structure.sections` must be an array.");
  }
  const rubric = Array.isArray(obj.rubric) ? obj.rubric.map(validateCriterion) : [];

  return {
    id: obj.id,
    name: obj.name,
    summary: obj.summary,
    scenario_shape: obj.scenario_shape as ArtifactTemplate["scenario_shape"],
    synthesis_structure: {
      sections: synthesisStructure.sections.filter((value): value is string => typeof value === "string"),
      notes: typeof synthesisStructure.notes === "string" ? synthesisStructure.notes : undefined
    },
    rubric,
    intake_questions: Array.isArray(obj.intake_questions)
      ? obj.intake_questions.filter((value): value is string => typeof value === "string")
      : undefined
  };
}

function validateCriterion(value: unknown): RubricCriterion {
  if (!value || typeof value !== "object") throw new Error("Rubric criterion must be an object.");
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id.trim()) throw new Error("Rubric criterion missing `id`.");
  if (typeof obj.text !== "string" || !obj.text.trim()) throw new Error("Rubric criterion missing `text`.");
  return {
    id: obj.id,
    text: obj.text,
    guidance: typeof obj.guidance === "string" ? obj.guidance : undefined
  };
}

export function templateScenarioShapeMarkdown(template: ArtifactTemplate): string | null {
  const shape = template.scenario_shape;
  if (!shape || (!shape.description && (!shape.required_inputs || shape.required_inputs.length === 0))) {
    return null;
  }
  const lines: string[] = [];
  if (shape.description) lines.push(shape.description.trim());
  if (shape.required_inputs?.length) {
    lines.push("", "Required inputs:");
    for (const input of shape.required_inputs) lines.push(`- ${input}`);
  }
  return lines.join("\n");
}
