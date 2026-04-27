export type AgentStatus = "ok" | "blocked";

export type ClaimKind = "recommendation" | "assumption" | "risk" | "fact" | "decision";

export interface Claim {
  id: string;
  kind: ClaimKind;
  text: string;
  confidence?: number;
}

export type ObjectionSeverity = "blocking" | "major" | "minor";

export interface Objection {
  id: string;
  target_turn?: string | null;
  target_claim_id?: string | null;
  severity: ObjectionSeverity;
  text: string;
  suggested_fix?: string;
}

export interface RubricScore {
  criterion_id: string;
  criterion_text: string;
  pass: boolean;
  evidence: string;
}

export interface CostInfo {
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
}

export interface UserQuestion {
  question: string;
  why_it_matters: string;
  recommended_answer: string;
  blocking: boolean;
  source_turn?: string | null;
  source_actor?: string | null;
}

export interface HumanAnswer {
  question: string;
  answer: string;
  recommended_answer: string;
  why_it_matters: string;
  blocking: boolean;
  source_turn: string | null;
  source_actor: string | null;
}

export interface AgentTurnResult {
  status: AgentStatus;
  summary: string;
  markdown: string;
  blocking_issues: string[];
  questions_for_user: UserQuestion[];
  claims?: Claim[];
  objections?: Objection[];
  rubric_scores?: RubricScore[];
  incorporated_objection_ids?: string[];
}

export interface TurnRecord {
  id: string;
  actor: string;
  phase: string;
  inputTurnIds: string[];
  summary: string;
  status: AgentStatus;
  blockingIssues: string[];
  questionsForUser: UserQuestion[];
  claims: Claim[];
  objections: Objection[];
  rubricScores: RubricScore[];
  incorporatedObjectionIds: string[];
  cost?: CostInfo;
  durationMs?: number;
  anonymousLabel?: string | null;
  path: string;
}

export interface AgentConfig {
  id: string;
  adapter: string;
  command?: string;
  role?: string;
  model?: string;
  extra_args?: string[];
  args?: string[];
  check_args?: string[];
  preset?: string;
  input?: {
    mode?: string;
  };
  output?: {
    mode?: string;
  };
  options?: Record<string, unknown>;
}

export interface SynthesisConfig {
  agent: string | null;
  aggregators?: string[] | null;
  meta_synthesizer?: string | null;
}

export interface CouncilConfig {
  protocol: string;
  agents: AgentConfig[];
  limits: {
    max_turns: number;
  };
  output: {
    dir: string;
  };
  synthesis: SynthesisConfig;
  intake: {
    enabled: boolean;
    mode: string;
    facilitator: string | null;
    max_questions: number;
  };
  human_input: {
    mode: "never" | "on_blocking_questions" | "before_final" | "interactive";
    max_questions_per_pause: number;
    ask_before_final: boolean;
  };
  final_review: {
    enabled: boolean;
  };
  adapters: {
    codex: Record<string, unknown>;
    claude: Record<string, unknown>;
    generic: Record<string, unknown>;
  };
  template?: string | null;
  templates_dir?: string | null;
  council_preset?: string | null;
  cost_warning_usd?: number;
  dry_run?: boolean;
  __configPath?: string | null;
}

export interface CliFlags {
  configPath?: string;
  agents?: string;
  maxTurns?: string;
  outDir?: string;
  synthesizer?: string;
  finalReview?: boolean;
  intake?: string;
  maxQuestions?: string;
  humanInput?: string;
  dryRun?: boolean;
  template?: string;
  council?: string;
  templatesDir?: string;
}

export interface ParsedArgs {
  command: "run" | "init" | "check" | "doctor" | "help" | "grill" | "replay";
  positional: string[];
  flags: CliFlags;
  template?: string;
}

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ProcessResultWithCommand extends ProcessResult {
  command: string;
}

export interface RunProcessInput {
  command: string;
  args?: string[];
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface AgentTurnInvocation {
  agent: AgentConfig;
  config: CouncilConfig;
  prompt: string;
  schema: Record<string, unknown>;
  schemaPath: string;
  outputPath: string;
  cwd: string;
  turnNumber: number;
  phase: string;
}

export interface AdapterTurnOutput {
  result: AgentTurnResult;
  process: ProcessResultWithCommand;
  raw: string;
  cost?: CostInfo;
}

export interface AgentCheckResult {
  ok: boolean;
  agent: string;
  adapter: string;
  message: string;
}

export interface AskUserInput {
  title?: string;
  questions: UserQuestion[];
  allowDone?: boolean;
  defaultToRecommendation?: boolean;
}

export interface AskUserResult {
  answers: HumanAnswer[];
  stopped: boolean;
}

export type AskUser = (input: AskUserInput) => Promise<AskUserResult>;

export type JsonObject = Record<string, unknown>;

export interface RubricCriterion {
  id: string;
  text: string;
  guidance?: string;
}

export interface ArtifactTemplate {
  id: string;
  name: string;
  summary: string;
  scenario_shape?: {
    description?: string;
    required_inputs?: string[];
  };
  synthesis_structure: {
    sections: string[];
    notes?: string;
  };
  rubric: RubricCriterion[];
  intake_questions?: string[];
}

export interface AnonymizationMapping {
  phase: string;
  reveal: Record<string, string>;
  views: Record<string, Record<string, string>>;
}
