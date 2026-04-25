import { spawn } from "node:child_process";
import type { ProcessResult, RunProcessInput } from "./types.js";

export function runProcess({
  command,
  args = [],
  cwd = process.cwd(),
  input = "",
  env = {},
  timeoutMs = 600000
}: RunProcessInput): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000).unref();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      resolve({ code, signal, stdout, stderr, durationMs, timedOut });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

export function commandForDisplay(command: string, args: string[]): string {
  return [
    shellQuote(command),
    ...args.map((arg, index) => shellQuote(displayArg(arg, index, args)))
  ].join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function displayArg(value: string, index: number, args: string[]): string {
  if (args[index - 1] === "--json-schema") {
    return `<json-schema:${value.length} chars>`;
  }
  if (value.length <= 240) return value;
  return `${value.slice(0, 120)}...<${value.length - 240} chars omitted>...${value.slice(-120)}`;
}
