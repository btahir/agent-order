import readline from "node:readline";
import type { AskUserInput, AskUserResult, HumanAnswer } from "./types.js";

export function createHumanPrompter({
  input = process.stdin,
  output = process.stderr
}: {
  input?: NodeJS.ReadableStream & { isTTY?: boolean };
  output?: NodeJS.WritableStream & { isTTY?: boolean };
} = {}) {
  const isInteractive = Boolean(input.isTTY);
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
      if (queuedLines.length > 0) return queuedLines.shift() ?? "";
      if (closed) return "";
      return new Promise((resolve) => waiting.push(resolve));
    }

    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer));
    });
  }

  async function askQuestions({ title, questions, allowDone = false, defaultToRecommendation = true }: AskUserInput): Promise<AskUserResult> {
    const answers: HumanAnswer[] = [];
    if (title) output.write(`\n${title}\n`);

    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index];
      output.write(`\n${index + 1}. ${question.question}\n`);
      if (question.why_it_matters) output.write(`Why it matters: ${question.why_it_matters}\n`);
      if (question.recommended_answer) output.write(`Recommended: ${question.recommended_answer}\n`);
      const suffix = promptSuffix({ allowDone, defaultToRecommendation });
      const raw = await askLine(`Your answer${suffix}`);
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

function promptSuffix({
  allowDone,
  defaultToRecommendation
}: {
  allowDone: boolean;
  defaultToRecommendation: boolean;
}): string {
  if (allowDone && defaultToRecommendation) return " (blank accepts recommendation, 'done' ends intake): ";
  if (allowDone) return " (blank skips, 'done' ends intake): ";
  if (defaultToRecommendation) return " (blank accepts recommendation): ";
  return " (blank skips): ";
}
