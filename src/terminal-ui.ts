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
  const frames = ["|", "/", "-", "\\"];
  const verbs = ["consulting", "weighing", "challenging", "revising", "synthesizing", "inscribing"];
  let timer: NodeJS.Timeout | null = null;
  let frame = 0;
  let verbIndex = 0;
  let active: { id: string; actor: string; phase: string; startedAt: number } | null = null;
  let lineVisible = false;

  function event(message: string): void {
    if (message.startsWith("Input requested:")) {
      stopSpinner();
      return;
    }

    if (message.startsWith("Run directory:")) {
      stopSpinner();
      const value = message.slice("Run directory:".length).trim();
      writeLine(`${theme.muted("Run")} ${wrapPath(value, width - 4, theme)}`);
      return;
    }

    const turn = message.match(/^Turn\s+([^:]+):\s+(\S+)\s+(.+)$/);
    if (turn) {
      stopSpinner();
      const [, id, actor, phase] = turn;
      active = { id, actor, phase, startedAt: Date.now() };
      if (interactive) {
        renderSpinner();
        timer = setInterval(renderSpinner, 100);
      } else {
        writeLine(formatEvent(message, theme));
      }
      return;
    }

    const done = message.match(/^Done\s+([^:]+):\s+(\S+)\s+(.+)$/);
    if (done) {
      const [, id, actor, phase] = done;
      const elapsed = active && active.id === id ? elapsedSeconds(active.startedAt) : "";
      stopSpinner();
      writeLine(`${theme.success("✓")} ${theme.accent(id)} ${theme.label(actor)} ${theme.muted(formatPhase(phase))}${elapsed ? theme.muted(` ${elapsed}`) : ""}`);
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
    writeLine("");
    writeLine(`${theme.success("Final report")} ${wrapPath(value, width - 13, theme)}`);
  }

  function renderSpinner(): void {
    if (!active) return;
    const currentFrame = frames[frame % frames.length];
    const verb = verbs[Math.floor(verbIndex / 8) % verbs.length];
    frame += 1;
    verbIndex += 1;
    const elapsed = elapsedSeconds(active.startedAt);
    const text = `${theme.accent(currentFrame)} ${theme.label(active.actor)} ${theme.muted(formatPhase(active.phase))} ${theme.accent(verb)} ${theme.muted(elapsed)}`;
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

  return { event, finalPath, finish };
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

function elapsedSeconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function wrapPath(value: string, width: number, theme: TerminalTheme): string {
  if (stripAnsi(value).length <= width) return theme.accent(value);
  const parts = value.split("/");
  const lines: string[] = [];
  let current = "";

  for (const part of parts) {
    const next = current ? joinPathDisplay(current, part) : part || "/";
    if (stripAnsi(next).length > width && current) {
      lines.push(current);
      current = part;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.map((line, index) => index === 0 ? theme.accent(line) : `    ${theme.accent(line)}`).join("\n");
}

function joinPathDisplay(current: string, part: string): string {
  if (current === "/") return `/${part}`;
  return `${current}/${part}`;
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
