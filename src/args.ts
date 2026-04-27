import { TEMPLATE_IDS } from "./templates/index.js";
import type { CliFlags, ParsedArgs } from "./types.js";

const NON_TEMPLATE_COMMANDS = ["run", "init", "check", "doctor", "help", "grill", "replay"] as const;

type NonTemplateCommand = (typeof NON_TEMPLATE_COMMANDS)[number];

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "run",
    positional: [],
    flags: {}
  };

  const args = [...argv];
  if (args[0] && !args[0].startsWith("-")) {
    if (isNonTemplateCommand(args[0])) {
      result.command = args.shift() as ParsedArgs["command"];
    } else if (TEMPLATE_IDS.includes(args[0])) {
      result.template = args.shift();
      result.command = "run";
    }
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      result.positional.push(...args.slice(i + 1));
      break;
    }

    if (!arg.startsWith("-")) {
      result.positional.push(arg);
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      result.command = "help";
      continue;
    }

    if (arg === "--no-final-review") {
      result.flags.finalReview = false;
      continue;
    }

    if (arg === "--no-intake") {
      result.flags.intake = "off";
      continue;
    }

    if (arg === "--no-human-input") {
      result.flags.humanInput = "never";
      continue;
    }

    if (arg === "--dry-run") {
      result.flags.dryRun = true;
      continue;
    }

    const [name, inlineValue] = arg.split("=", 2) as [string, string | undefined];
    const key = flagNameToKey(name);
    const value = inlineValue !== undefined ? inlineValue : args[++i];

    if (value === undefined) {
      throw new Error(`Missing value for ${name}`);
    }

    setStringFlag(result.flags, key, value);
  }

  if (result.template && !result.flags.template) {
    result.flags.template = result.template;
  }

  return result;
}

function isNonTemplateCommand(value: string): value is NonTemplateCommand {
  return (NON_TEMPLATE_COMMANDS as readonly string[]).includes(value);
}

function flagNameToKey(name: string): keyof CliFlags {
  switch (name) {
    case "--config":
      return "configPath";
    case "--agents":
      return "agents";
    case "--max-turns":
      return "maxTurns";
    case "--out":
      return "outDir";
    case "--synthesizer":
      return "synthesizer";
    case "--intake":
      return "intake";
    case "--max-questions":
      return "maxQuestions";
    case "--human-input":
      return "humanInput";
    case "--template":
      return "template";
    case "--depth":
      return "council";
    case "--council":
      return "council";
    case "--templates-dir":
      return "templatesDir";
    default:
      throw new Error(`Unknown flag: ${name}`);
  }
}

function setStringFlag(flags: CliFlags, key: keyof CliFlags, value: string): void {
  switch (key) {
    case "configPath":
    case "agents":
    case "maxTurns":
    case "outDir":
    case "synthesizer":
    case "intake":
    case "maxQuestions":
    case "humanInput":
    case "template":
    case "council":
    case "templatesDir":
      flags[key] = value;
      return;
    default:
      throw new Error(`Flag ${String(key)} does not accept a value.`);
  }
}
