import readline from "node:readline";
import { createTerminalTheme, formatPrompt, formatQuestionBlock } from "./terminal-ui.js";
import type { AskUserInput, AskUserResult, HumanAnswer } from "./types.js";

export function createHumanPrompter({
  input = process.stdin,
  output = process.stderr
}: {
  input?: NodeJS.ReadableStream & { isTTY?: boolean };
  output?: NodeJS.WritableStream & { isTTY?: boolean };
} = {}) {
  const isInteractive = Boolean(input.isTTY);
  const theme = createTerminalTheme({ color: Boolean(output.isTTY) });
  const rl = readline.createInterface({
    input,
    output: isInteractive ? output : undefined,
    terminal: isInteractive
  });
  const queuedLines: string[] = [];
  const waiting: Array<(line: string) => void> = [];
  let closed = false;

  if (!isInteractive) {
    rl.on("line", (line) => {
      const resolver = waiting.shift();
      if (resolver) resolver(line);
      else queuedLines.push(line);
    });
    rl.on("close", () => {
      closed = true;
      while (waiting.length > 0) {
        const resolve = waiting.shift();
        if (resolve) resolve("");
      }
    });
  }

  async function askLine(prompt: string): Promise<string> {
    if (!isInteractive) {
      output.write(prompt);
      const answer = queuedLines.length > 0
        ? queuedLines.shift() ?? ""
        : closed
          ? ""
          : await new Promise<string>((resolve) => waiting.push(resolve));
      output.write("\n");
      return answer;
    }

    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer));
    });
  }

  async function askQuestions({ title, questions, allowDone = false, defaultToRecommendation = true }: AskUserInput): Promise<AskUserResult> {
    const answers: HumanAnswer[] = [];
    if (title) {
      output.write(`\n${theme.heading(title)}\n`);
      output.write(`${theme.muted("Answer the prompt below. Press Enter to accept the recommendation when one is offered.")}\n`);
    }

    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index];
      output.write(formatQuestionBlock({
        index,
        total: questions.length,
        question,
        allowDone,
        defaultToRecommendation,
        theme
      }));
      const raw = await askLine(formatPrompt({ allowDone, defaultToRecommendation, theme }));
      const trimmed = raw.trim();

      if (allowDone && ["done", "stop", "end"].includes(trimmed.toLowerCase())) {
        return { answers, stopped: true };
      }

      answers.push({
        question: question.question,
        answer: trimmed || (defaultToRecommendation ? question.recommended_answer || "No additional guidance." : ""),
        recommended_answer: question.recommended_answer ?? "",
        why_it_matters: question.why_it_matters ?? "",
        blocking: Boolean(question.blocking),
        source_turn: question.source_turn ?? null,
        source_actor: question.source_actor ?? null
      });
    }

    return { answers, stopped: false };
  }

  function close(): void {
    rl.close();
  }

  return { askQuestions, close };
}
