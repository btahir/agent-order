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
    return `${theme.muted("run")}  ${theme.accent(toRelativePath(value))}`;
  }

  const turn = message.match(/^Turn\s+([^:]+):\s+(\S+)\s+(.+)$/);
  if (turn) {
    const [, id, actor, phase] = turn;
    return `  ${theme.muted("·")}  ${theme.muted(id)}  ${theme.label(actor.padEnd(8))}  ${theme.muted(formatPhase(phase))}`;
  }

  return theme.muted(message);
}

export function createTerminalReporter({
  output = process.stderr,
  color = Boolean(process.stderr.isTTY)
}: {
  output?: NodeJS.WritableStream & { columns?: number; isTTY?: boolean };
  color?: boolean;
} = {}) {
  const theme = createTerminalTheme({ color });
  const interactive = Boolean(output.isTTY);
  const width = Math.max(48, Math.min(output.columns ?? 88, 120));
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const verbs = ["consulting", "weighing", "challenging", "revising", "synthesizing", "inscribing"];
  let timer: NodeJS.Timeout | null = null;
  let frame = 0;
  let verbIndex = 0;
  let active: { id: string; actor: string; phase: string; startedAt: number } | null = null;
  let lineVisible = false;
  let lastPhase: string | null = null;
  const headerIndent = "  ";
  const bodyIndent = "     ";

  function event(message: string): void {
    if (message.startsWith("Input requested:")) {
      stopSpinner();
      lastPhase = null;
      return;
    }

    if (message.startsWith("Run directory:")) {
      stopSpinner();
      const value = message.slice("Run directory:".length).trim();
      writeLine("");
      writeLine(`${headerIndent}${theme.muted("run")}  ${theme.accent(toRelativePath(value))}`);
      return;
    }

    if (message.startsWith("Template:")) {
      stopSpinner();
      const value = message.slice("Template:".length).trim();
      writeLine(`${headerIndent}${theme.muted("template")}  ${theme.accent(value)}`);
      return;
    }

    if (message.startsWith("Council preset:")) {
      stopSpinner();
      const value = message.slice("Council preset:".length).trim();
      writeLine(`${headerIndent}${theme.muted("council")}  ${theme.accent(value)}`);
      return;
    }

    if (message.startsWith("disagreement:")) {
      stopSpinner();
      const value = message.slice("disagreement:".length).trim();
      writeLine(`${bodyIndent}${theme.warning("⚡")}  ${theme.label("disagreement")}  ${theme.muted(value)}`);
      return;
    }

    if (message.startsWith("rubric:")) {
      stopSpinner();
      const value = message.slice("rubric:".length).trim();
      writeLine(`${bodyIndent}${theme.accent("◆")}  ${theme.label("rubric      ")}  ${theme.muted(value)}`);
      return;
    }

    if (message.startsWith("cost:")) {
      stopSpinner();
      const value = message.slice("cost:".length).trim();
      writeLine(`${bodyIndent}${theme.muted("$")}  ${theme.label("cost        ")}  ${theme.muted(value)}`);
      return;
    }

    if (message.startsWith("warning:")) {
      stopSpinner();
      const value = message.slice("warning:".length).trim();
      writeLine(`${bodyIndent}${theme.warning("!")}  ${theme.warning(value)}`);
      return;
    }

    const turn = message.match(/^Turn\s+([^:]+):\s+(\S+)\s+(.+)$/);
    if (turn) {
      stopSpinner();
      const [, id, actor, phase] = turn;
      writePhaseHeaderIfNew(phase);
      active = { id, actor, phase, startedAt: Date.now() };
      if (interactive) {
        renderSpinner();
        timer = setInterval(renderSpinner, 100);
      }
      return;
    }

    const done = message.match(/^Done\s+([^:]+):\s+(\S+)\s+(.+)$/);
    if (done) {
      const [, id, actor, phase] = done;
      const elapsed = active && active.id === id ? elapsedSeconds(active.startedAt) : "";
      stopSpinner();
      writePhaseHeaderIfNew(phase);
      writeLine(`${bodyIndent}${theme.success("✓")}  ${theme.muted(id)}  ${theme.label(actor.padEnd(8))}${elapsed ? `  ${theme.muted(elapsed)}` : ""}`);
      active = null;
      return;
    }

    stopSpinner();
    writeLine(formatEvent(message, theme));
  }

  function finish(): void {
    stopSpinner();
  }

  function finalPath(value: string): void {
    stopSpinner();
    writePhaseHeader("final report");
    writeLine(`${bodyIndent}${theme.accent("→")}  ${theme.accent(toRelativePath(value))}`);
    writeLine("");
  }

  function htmlPath(value: string): void {
    stopSpinner();
    writeLine(`${bodyIndent}${theme.accent("⌬")}  ${theme.accent(toRelativePath(value))}`);
  }

  function writePhaseHeaderIfNew(phase: string): void {
    const label = formatPhase(phase);
    if (label === lastPhase) return;
    lastPhase = label;
    writePhaseHeader(label);
  }

  function writePhaseHeader(label: string): void {
    writeLine("");
    writeLine(`${headerIndent}${theme.accent("▎")} ${theme.label(label)}`);
    writeLine("");
  }

  function renderSpinner(): void {
    if (!active) return;
    const currentFrame = frames[frame % frames.length];
    const verb = verbs[Math.floor(verbIndex / 8) % verbs.length];
    frame += 1;
    verbIndex += 1;
    const elapsed = elapsedSeconds(active.startedAt);
    const text = `${bodyIndent}${theme.accent(currentFrame)}  ${theme.muted(active.id)}  ${theme.label(active.actor.padEnd(8))}  ${theme.muted(verb)}  ${theme.muted(elapsed)}`;
    const line = truncateForTerminal(text, width);
    output.write(`\r\x1b[2K${line}`);
    lineVisible = true;
  }

  function stopSpinner(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (lineVisible) {
      output.write("\r\x1b[2K");
      lineVisible = false;
    }
  }

  function writeLine(line: string): void {
    output.write(`${line}\n`);
  }

  return { event, finalPath, htmlPath, finish };
}

function toRelativePath(value: string): string {
  const cwd = process.cwd();
  if (value === cwd) return ".";
  if (value.startsWith(cwd + "/")) return value.slice(cwd.length + 1);
  return value;
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
    lines.push("");
    lines.push(wrapText(question.why_it_matters, 84));
    lines.push("");
  }

  if (question.recommended_answer) {
    lines.push(`${theme.label("Recommended")}`);
    lines.push("");
    lines.push(wrapText(question.recommended_answer, 84));
    lines.push("");
  }

  if (question.source_turn || question.source_actor) {
    const source = [question.source_actor, question.source_turn].filter(Boolean).join(".");
    lines.push(theme.muted(`Source: ${source}`));
    lines.push("");
  }

  lines.push(theme.muted(helpText({ allowDone, defaultToRecommendation })));
  return lines.join("\n") + "\n";
}

export function formatPrompt({
  allowDone: _allowDone,
  defaultToRecommendation: _defaultToRecommendation,
  theme
}: {
  allowDone: boolean;
  defaultToRecommendation: boolean;
  theme: TerminalTheme;
}): string {
  return `\n${theme.prompt("Your answer")}\n\n${theme.accent(">")} `;
}

function formatPhase(phase: string): string {
  return phase.replace(/-/g, " ");
}

function elapsedSeconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function truncateForTerminal(value: string, width: number): string {
  const visible = stripAnsi(value);
  if (visible.length <= width) return value;
  return visible.slice(0, Math.max(0, width - 1));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
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
