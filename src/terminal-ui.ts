import { Chalk } from "chalk";
import type { UserQuestion } from "./types.js";

export interface TerminalTheme {
  heading(value: string): string;
  accent(value: string): string;
  muted(value: string): string;
  label(value: string): string;
  success(value: string): string;
  warning(value: string): string;
  prompt(value: string): string;
  error(value: string): string;
  dim(value: string): string;
}

export function createTerminalTheme({ color = process.stderr.isTTY }: { color?: boolean } = {}): TerminalTheme {
  const chalk = new Chalk({ level: color ? 1 : 0 });
  return {
    heading: chalk.bold.cyan,
    accent: chalk.cyan,
    muted: chalk.gray,
    label: chalk.bold,
    success: chalk.green,
    warning: chalk.yellow,
    prompt: chalk.bold.magenta,
    error: chalk.red,
    dim: chalk.dim
  };
}

export function formatEvent(message: string, theme = createTerminalTheme()): string {
  if (message.startsWith("Run directory:")) {
    const value = message.slice("Run directory:".length).trim();
    return `${theme.muted("Run")} ${theme.accent(value)}`;
  }

  const turn = message.match(/^Turn\s+([^:]+):\s+(\S+)\s+(.+)$/);
  if (turn) {
    const [, id, actor, phase] = turn;
    return `${theme.muted("Turn")} ${theme.accent(id)} ${theme.label(actor)} ${theme.muted(formatPhase(phase))}`;
  }

  return theme.muted(message);
}

export function formatQuestionBlock({
  index,
  total,
  question,
  allowDone,
  defaultToRecommendation,
  theme
}: {
  index: number;
  total: number;
  question: UserQuestion;
  allowDone: boolean;
  defaultToRecommendation: boolean;
  theme: TerminalTheme;
}): string {
  const lines = [
    "",
    theme.muted("─".repeat(64)),
    `${theme.heading(`Question ${index + 1}${total > 1 ? ` of ${total}` : ""}`)}${question.blocking ? ` ${theme.warning("blocking")}` : ""}`,
    "",
    wrapText(question.question, 84),
    ""
  ];

  if (question.why_it_matters) {
    lines.push(`${theme.label("Why it matters")}`);
    lines.push(wrapText(question.why_it_matters, 84, "  "));
    lines.push("");
  }

  if (question.recommended_answer) {
    lines.push(`${theme.label("Recommended")}`);
    lines.push(wrapText(question.recommended_answer, 84, "  "));
    lines.push("");
  }

  if (question.source_turn || question.source_actor) {
    const source = [question.source_actor, question.source_turn].filter(Boolean).join(".");
    lines.push(theme.muted(`Source: ${source}`));
  }

  lines.push(theme.muted(helpText({ allowDone, defaultToRecommendation })));
  return lines.join("\n") + "\n";
}

export function formatPrompt({
  allowDone,
  defaultToRecommendation,
  theme
}: {
  allowDone: boolean;
  defaultToRecommendation: boolean;
  theme: TerminalTheme;
}): string {
  return `${theme.prompt("Your answer")}\n${theme.accent(">")} `;
}

function formatPhase(phase: string): string {
  return phase.replace(/-/g, " ");
}

function helpText({
  allowDone,
  defaultToRecommendation
}: {
  allowDone: boolean;
  defaultToRecommendation: boolean;
}): string {
  if (allowDone && defaultToRecommendation) return "blank accepts recommendation, type 'done' to end intake";
  if (allowDone) return "blank skips, type 'done' to end intake";
  if (defaultToRecommendation) return "blank accepts recommendation";
  return "blank skips";
}

function wrapText(text: string, width: number, indent = ""): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(indent + current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(indent + current);
  return lines.join("\n");
}
