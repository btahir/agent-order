import path from "node:path";
import { ArtifactStore } from "./artifacts.js";
import { runAgentTurn } from "./adapters/index.js";
import { buildPrompt } from "./protocol/prompts.js";
import { agentTurnSchema } from "./schema.js";
import { writeText } from "./fs-utils.js";
import type {
  AgentConfig,
  AgentTurnResult,
  AskUser,
  CouncilConfig,
  HumanAnswer,
  TurnRecord,
  UserQuestion
} from "./types.js";

interface CouncilState {
  initial: Map<string, TurnRecord>;
  critiques: Map<string, TurnRecord>;
  revisions: Map<string, TurnRecord>;
  synthesis: TurnRecord | null;
  finalReviews: TurnRecord[];
}

interface RunCouncilResult {
  runDir: string;
  finalPath: string;
  turns: TurnRecord[];
}

export async function runCouncil({
  scenarioText,
  config,
  cwd = process.cwd(),
  onEvent = () => {},
  askUser = null
}: {
  scenarioText: string;
  config: CouncilConfig;
  cwd?: string;
  onEvent?: (message: string) => void;
  askUser?: AskUser | null;
}): Promise<RunCouncilResult> {
  const store = new ArtifactStore({ cwd, baseDir: config.output.dir });
  const runDir = await store.init();
  const schemaPath = await store.writeSchema("agent-turn.schema.json", agentTurnSchema);

  await store.appendTrace({
    type: "run.started",
    run_dir: runDir,
    agents: config.agents.map((agent) => ({ id: agent.id, adapter: agent.adapter }))
  });

  const state: CouncilState = {
    initial: new Map(),
    critiques: new Map(),
    revisions: new Map(),
    synthesis: null,
    finalReviews: []
  };

  const maxTurns = config.limits.max_turns;
  const synthesizerId = config.synthesis.agent ?? config.agents[0].id;
  const synthesizer = config.agents.find((agent) => agent.id === synthesizerId);
  if (!synthesizer) throw new Error(`Synthesizer agent not found: ${synthesizerId}`);

  onEvent(`Run directory: ${runDir}`);

  const frozenScenarioText = await maybeRunIntake({
    store,
    config,
    cwd,
    scenarioText,
    schemaPath,
    synthesizer,
    onEvent,
    askUser
  });
  const scenarioPath = await store.writeScenario(frozenScenarioText);
  await store.appendTrace({
    type: "scenario.frozen",
    scenario_path: scenarioPath
  });

  for (const agent of config.agents) {
    if (!canRunBeforeSynthesis(store, maxTurns)) break;
    const turn = await executeAgentTurn({
      store,
      config,
      cwd,
      agent,
      phase: "initial-position",
      scenarioText: frozenScenarioText,
      contextTurns: [],
      schemaPath,
      onEvent
    });
    state.initial.set(agent.id, turn);
  }

  if (canRunCompleteStageBeforeSynthesis(store, maxTurns, config.agents.length)) {
    for (const agent of config.agents) {
      const contextTurns = [...state.initial.values()].filter((turn) => turn.actor !== agent.id);
      const turn = await executeAgentTurn({
        store,
        config,
        cwd,
        agent,
        phase: "critique",
        scenarioText: frozenScenarioText,
        contextTurns,
        schemaPath,
        onEvent
      });
      state.critiques.set(agent.id, turn);
    }
  }

  if (canRunCompleteStageBeforeSynthesis(store, maxTurns, config.agents.length)) {
    for (const agent of config.agents) {
      const contextTurns = [
        ...state.initial.values(),
        ...state.critiques.values()
      ].filter(Boolean);
      const turn = await executeAgentTurn({
        store,
        config,
        cwd,
        agent,
        phase: "revision",
        scenarioText: frozenScenarioText,
        contextTurns,
        schemaPath,
        onEvent
      });
      state.revisions.set(agent.id, turn);
    }
  }

  const clarificationTurns = await maybeAskClarification({
    store,
    config,
    maxTurns,
    phase: "mid-run",
    sourceTurns: [
      ...state.initial.values(),
      ...state.critiques.values(),
      ...state.revisions.values()
    ],
    onEvent,
    askUser
  });

  if (
    clarificationTurns.length > 0 &&
    canRunCompleteStageBeforeSynthesis(store, maxTurns, config.agents.length)
  ) {
    for (const agent of config.agents) {
      const contextTurns = [
        ...state.initial.values(),
        ...state.critiques.values(),
        ...state.revisions.values(),
        ...clarificationTurns
      ].filter(Boolean);
      const turn = await executeAgentTurn({
        store,
        config,
        cwd,
        agent,
        phase: "revision",
        scenarioText: frozenScenarioText,
        contextTurns,
        schemaPath,
        onEvent
      });
      state.revisions.set(`${agent.id}-after-human`, turn);
    }
  }

  const beforeFinalTurns = await maybeAskBeforeFinal({
    store,
    config,
    maxTurns,
    onEvent,
    askUser
  });

  if (canRun(store, maxTurns)) {
    const contextTurns = [
      ...state.initial.values(),
      ...state.critiques.values(),
      ...state.revisions.values(),
      ...clarificationTurns,
      ...beforeFinalTurns
    ];
    state.synthesis = await executeAgentTurn({
      store,
      config,
      cwd,
      agent: synthesizer,
      phase: "synthesis",
      scenarioText: frozenScenarioText,
      contextTurns,
      schemaPath,
      onEvent
    });
  }

  if (
    state.synthesis &&
    config.final_review.enabled !== false &&
    canRunCompleteStage(store, maxTurns, config.agents.length)
  ) {
    for (const agent of config.agents) {
      const turn = await executeAgentTurn({
        store,
        config,
        cwd,
        agent,
        phase: "final-review",
        scenarioText: frozenScenarioText,
        contextTurns: [state.synthesis],
        schemaPath,
        onEvent
      });
      state.finalReviews.push(turn);
    }
  }

  const hasBlockingReview = state.finalReviews.some((turn) => turn.status === "blocked" || turn.blockingIssues.length > 0);
  if (state.synthesis && hasBlockingReview && canRun(store, maxTurns)) {
    state.synthesis = await executeAgentTurn({
      store,
      config,
      cwd,
      agent: synthesizer,
      phase: "synthesis-revision",
      scenarioText: frozenScenarioText,
      contextTurns: [state.synthesis, ...state.finalReviews],
      schemaPath,
      onEvent
    });
  }

  const finalSource = state.synthesis ?? latestTurn(store.turns);
  const finalMarkdown = finalSource
    ? await store.readTurn(finalSource)
    : "# Final Report\n\nNo agent turns completed.\n";
  const finalPath = await store.writeFinalReport(stripFrontmatter(finalMarkdown), finalSource);
  await writeDecisionLog(store, state, finalPath);
  await store.writeIndex(finalPath);

  await store.appendTrace({
    type: "run.completed",
    final_path: finalPath,
    turn_count: store.turns.length,
    max_turns: maxTurns
  });

  return {
    runDir,
    finalPath,
    turns: store.turns
  };
}

async function executeAgentTurn({
  store,
  config,
  cwd,
  agent,
  phase,
  scenarioText,
  contextTurns,
  schemaPath,
  onEvent
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  agent: AgentConfig;
  phase: string;
  scenarioText: string;
  contextTurns: TurnRecord[];
  schemaPath: string;
  onEvent: (message: string) => void;
}): Promise<TurnRecord> {
  const turnNumber = store.nextTurnNumber();
  const turnId = store.turnId(turnNumber);
  const loadedContext: Array<TurnRecord & { content: string }> = [];

  for (const turn of contextTurns) {
    loadedContext.push({
      ...turn,
      content: stripFrontmatter(await store.readTurn(turn))
    });
  }

  const prompt = buildPrompt({
    phase,
    actor: agent.id,
    scenarioText,
    agents: config.agents,
    contextTurns: loadedContext
  });
  const promptPath = await store.writePrompt(turnNumber, agent.id, phase, prompt);
  const rawPath = store.rawPath(turnNumber, agent.id, phase, "json");

  await store.appendTrace({
    type: "turn.started",
    turn: turnId,
    actor: agent.id,
    phase,
    prompt_path: promptPath
  });
  onEvent(`Turn ${turnId}: ${agent.id} ${phase}`);

  if (config.dry_run) {
    const result: AgentTurnResult = {
      status: "ok",
      summary: `Dry run artifact for ${agent.id} ${phase}.`,
      markdown: `# ${agent.id} ${phase}\n\nDry run only. Prompt written to \`${path.relative(store.runDir, promptPath)}\`.`,
      blocking_issues: [],
      questions_for_user: []
    };
    const turn = await store.writeTurn({
      turnNumber,
      actor: agent.id,
      phase,
      inputTurnIds: contextTurns.map((turn) => turn.id),
      result
    });
    await store.appendTrace({ type: "turn.completed", turn: turn.id, dry_run: true });
    return turn;
  }

  const { result, process, raw } = await runAgentTurn({
    agent,
    config,
    prompt,
    schema: agentTurnSchema,
    schemaPath,
    outputPath: rawPath,
    cwd,
    turnNumber,
    phase
  });

  await writeText(rawPath, raw.trim() + "\n");
  const turn = await store.writeTurn({
    turnNumber,
    actor: agent.id,
    phase,
    inputTurnIds: contextTurns.map((turn) => turn.id),
    result
  });

  await store.appendTrace({
    type: "turn.completed",
    turn: turn.id,
    actor: agent.id,
    phase,
    duration_ms: process.durationMs,
    command: process.command,
    status: result.status,
    blocking_issue_count: result.blocking_issues.length,
    question_count: result.questions_for_user.length
  });

  return turn;
}

async function maybeRunIntake({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  synthesizer,
  onEvent,
  askUser
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  synthesizer: AgentConfig;
  onEvent: (message: string) => void;
  askUser: AskUser | null;
}): Promise<string> {
  if (!config.intake.enabled || config.intake.mode === "off") {
    return scenarioText;
  }

  if (config.intake.mode !== "grill") {
    throw new Error(`Unsupported intake mode: ${config.intake.mode}`);
  }

  const facilitatorId = config.intake.facilitator ?? synthesizer.id;
  const facilitator = config.agents.find((agent) => agent.id === facilitatorId);
  if (!facilitator) throw new Error(`Intake facilitator not found: ${facilitatorId}`);

  const seedTurn = await writeSyntheticTurn({
    store,
    actor: "human",
    phase: "seed",
    inputTurnIds: [],
    result: {
      status: "ok",
      summary: "Initial scenario supplied by the user.",
      markdown: `# Seed Scenario\n\n${scenarioText.trim()}`,
      blocking_issues: [],
      questions_for_user: []
    }
  });

  const intakeTurns: TurnRecord[] = [seedTurn];
  const answers: HumanAnswer[] = [];
  let stopped = false;

  for (let index = 0; index < config.intake.max_questions; index += 1) {
    if (!canRunBeforeSynthesis(store, config.limits.max_turns)) break;
    const questionTurn = await executeAgentTurn({
      store,
      config,
      cwd,
      agent: facilitator,
      phase: "intake-question",
      scenarioText: buildScenarioDraft(scenarioText, answers),
      contextTurns: intakeTurns,
      schemaPath,
      onEvent
    });
    intakeTurns.push(questionTurn);

    const questions = withQuestionSources(questionTurn.questionsForUser, questionTurn).slice(0, 1);
    if (questions.length === 0) break;

    const response = askUser
      ? await askUser({
          title: "Intake clarification",
          questions,
          allowDone: true,
          defaultToRecommendation: true
        })
      : { answers: questions.map(defaultAnswerForQuestion), stopped: false };

    if (response.answers.length > 0) {
      answers.push(...response.answers);
      const answerTurn = await writeHumanAnswersTurn({
        store,
        phase: "intake-answer",
        inputTurnIds: [questionTurn.id],
        answers: response.answers,
        summary: "User answered an intake question."
      });
      intakeTurns.push(answerTurn);
    }

    if (response.stopped) {
      stopped = true;
      break;
    }
  }

  const frozenScenario = buildFrozenScenario(scenarioText, answers, stopped);
  const freezeTurn = await writeSyntheticTurn({
    store,
    actor: "orchestrator",
    phase: "scenario-freeze",
    inputTurnIds: intakeTurns.map((turn) => turn.id),
    result: {
      status: "ok",
      summary: "Scenario frozen after intake.",
      markdown: frozenScenario,
      blocking_issues: [],
      questions_for_user: []
    }
  });
  intakeTurns.push(freezeTurn);

  return frozenScenario;
}

async function maybeAskClarification({
  store,
  config,
  maxTurns,
  sourceTurns,
  onEvent,
  askUser
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  maxTurns: number;
  phase: string;
  sourceTurns: TurnRecord[];
  onEvent: (message: string) => void;
  askUser: AskUser | null;
}): Promise<TurnRecord[]> {
  const mode = config.human_input.mode;
  if (!["on_blocking_questions", "interactive"].includes(mode)) {
    return [];
  }

  const questions = collectQuestions(sourceTurns, mode === "on_blocking_questions");
  if (questions.length === 0 || !canRunCompleteStageBeforeSynthesis(store, maxTurns, 2)) {
    return [];
  }

  const selectedQuestions = questions.slice(0, config.human_input.max_questions_per_pause);
  const questionTurn = await writeSyntheticTurn({
    store,
    actor: "orchestrator",
    phase: "user-questions",
    inputTurnIds: [...new Set(selectedQuestions.map((question) => question.source_turn).filter((id): id is string => typeof id === "string"))],
    result: {
      status: "ok",
      summary: "Consolidated questions for the user.",
      markdown: formatQuestionTurn(selectedQuestions),
      blocking_issues: [],
      questions_for_user: selectedQuestions
    }
  });
  onEvent(`Turn ${questionTurn.id}: orchestrator user-questions`);

  const response = askUser
    ? await askUser({
        title: "Clarification requested",
        questions: selectedQuestions,
        allowDone: false,
        defaultToRecommendation: true
      })
    : { answers: selectedQuestions.map(defaultAnswerForQuestion), stopped: false };

  if (response.answers.length === 0) return [questionTurn];

  const answerTurn = await writeHumanAnswersTurn({
    store,
    phase: "user-clarification",
    inputTurnIds: [questionTurn.id],
    answers: response.answers,
    summary: "User answered consolidated council questions."
  });
  onEvent(`Turn ${answerTurn.id}: human user-clarification`);
  return [questionTurn, answerTurn];
}

async function maybeAskBeforeFinal({
  store,
  config,
  maxTurns,
  onEvent,
  askUser
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  maxTurns: number;
  onEvent: (message: string) => void;
  askUser: AskUser | null;
}): Promise<TurnRecord[]> {
  const shouldAsk = config.human_input.mode === "before_final" || config.human_input.mode === "interactive" || config.human_input.ask_before_final;
  if (!shouldAsk || !canRunCompleteStageBeforeSynthesis(store, maxTurns, 2)) return [];

  const question: UserQuestion = {
    question: "Any final guidance before synthesis?",
    why_it_matters: "This is the last chance to add human constraints before the final report is synthesized.",
    recommended_answer: "No additional guidance.",
    blocking: false,
    source_turn: null,
    source_actor: "orchestrator"
  };

  const questionTurn = await writeSyntheticTurn({
    store,
    actor: "orchestrator",
    phase: "before-final-question",
    inputTurnIds: [],
    result: {
      status: "ok",
      summary: "Asked for optional final human guidance.",
      markdown: formatQuestionTurn([question]),
      blocking_issues: [],
      questions_for_user: [question]
    }
  });
  onEvent(`Turn ${questionTurn.id}: orchestrator before-final-question`);

  const response = askUser
    ? await askUser({
        title: "Before final synthesis",
        questions: [question],
        allowDone: false,
        defaultToRecommendation: false
      })
    : { answers: [], stopped: false };

  const realAnswers = response.answers.filter((answer) => answer.answer.trim());
  if (realAnswers.length === 0) return [questionTurn];

  const answerTurn = await writeHumanAnswersTurn({
    store,
    phase: "before-final-answer",
    inputTurnIds: [questionTurn.id],
    answers: realAnswers,
    summary: "User provided final guidance before synthesis."
  });
  onEvent(`Turn ${answerTurn.id}: human before-final-answer`);
  return [questionTurn, answerTurn];
}

async function writeSyntheticTurn({
  store,
  actor,
  phase,
  inputTurnIds,
  result
}: {
  store: ArtifactStore;
  actor: string;
  phase: string;
  inputTurnIds: string[];
  result: AgentTurnResult;
}): Promise<TurnRecord> {
  const turnNumber = store.nextTurnNumber();
  const turn = await store.writeTurn({
    turnNumber,
    actor,
    phase,
    inputTurnIds,
    result
  });
  await store.appendTrace({
    type: "turn.completed",
    turn: turn.id,
    actor,
    phase,
    synthetic: true,
    status: result.status,
    blocking_issue_count: result.blocking_issues.length,
    question_count: result.questions_for_user.length
  });
  return turn;
}

async function writeHumanAnswersTurn({
  store,
  phase,
  inputTurnIds,
  answers,
  summary
}: {
  store: ArtifactStore;
  phase: string;
  inputTurnIds: string[];
  answers: HumanAnswer[];
  summary: string;
}): Promise<TurnRecord> {
  return writeSyntheticTurn({
    store,
    actor: "human",
    phase,
    inputTurnIds,
    result: {
      status: "ok",
      summary,
      markdown: formatHumanAnswers(answers),
      blocking_issues: [],
      questions_for_user: []
    }
  });
}

async function writeDecisionLog(store: ArtifactStore, state: CouncilState, finalPath: string): Promise<void> {
  const lines = [
    "# Decision Log",
    "",
    `Final report: \`${path.relative(store.runDir, finalPath)}\``,
    "",
    "## Inputs",
    ""
  ];

  for (const turn of store.turns) {
    lines.push(`- ${turn.id} ${turn.actor}.${turn.phase}: ${turn.summary}`);
  }

  const blockers = state.finalReviews.flatMap((turn) => turn.blockingIssues.map((issue) => ({ turn, issue })));
  lines.push("", "## Final Review Blockers", "");
  if (blockers.length === 0) {
    lines.push("No blocking issues were reported in final review.");
  } else {
    for (const blocker of blockers) {
      lines.push(`- ${blocker.turn.id} ${blocker.turn.actor}: ${blocker.issue}`);
    }
  }

  await writeText(path.join(store.finalDir, "decision-log.md"), lines.join("\n") + "\n");
}

function buildScenarioDraft(seedScenario: string, answers: HumanAnswer[]): string {
  if (answers.length === 0) return seedScenario;
  return [
    seedScenario.trim(),
    "",
    "## Clarifications So Far",
    "",
    ...answers.flatMap((answer, index) => [
      `${index + 1}. ${answer.question}`,
      `Answer: ${answer.answer}`,
      ""
    ])
  ].join("\n").trim();
}

function buildFrozenScenario(seedScenario: string, answers: HumanAnswer[], stopped: boolean): string {
  const lines = [
    "# Frozen Scenario",
    "",
    "## Original Scenario",
    "",
    seedScenario.trim()
  ];

  lines.push("", "## Human Clarifications", "");
  if (answers.length === 0) {
    lines.push("No additional clarifications were provided.");
  } else {
    for (const [index, answer] of answers.entries()) {
      lines.push(`${index + 1}. ${answer.question}`);
      lines.push(`Answer: ${answer.answer}`);
      if (answer.recommended_answer) lines.push(`Recommended answer: ${answer.recommended_answer}`);
      lines.push("");
    }
  }

  if (stopped) {
    lines.push("## Intake Status", "", "The user ended intake manually.");
  }

  return lines.join("\n").trim();
}

function collectQuestions(turns: TurnRecord[], blockingOnly: boolean): UserQuestion[] {
  const seen = new Set();
  const questions = [];
  for (const turn of turns) {
    for (const question of withQuestionSources(turn.questionsForUser ?? [], turn)) {
      if (blockingOnly && !question.blocking) continue;
      const key = question.question.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(question);
    }
  }
  return questions.sort((left, right) => Number(right.blocking) - Number(left.blocking));
}

function withQuestionSources(questions: UserQuestion[], turn: TurnRecord): UserQuestion[] {
  return questions.map((question) => ({
    ...question,
    source_turn: question.source_turn ?? turn.id,
    source_actor: question.source_actor ?? turn.actor
  }));
}

function defaultAnswerForQuestion(question: UserQuestion): HumanAnswer {
  return {
    question: question.question,
    answer: question.recommended_answer || "No additional guidance.",
    recommended_answer: question.recommended_answer ?? "",
    why_it_matters: question.why_it_matters ?? "",
    blocking: Boolean(question.blocking),
    source_turn: question.source_turn ?? null,
    source_actor: question.source_actor ?? null
  };
}

function formatQuestionTurn(questions: UserQuestion[]): string {
  const lines = ["# User Questions", ""];
  for (const [index, question] of questions.entries()) {
    lines.push(`## ${index + 1}. ${question.question}`);
    if (question.why_it_matters) lines.push("", `Why it matters: ${question.why_it_matters}`);
    if (question.recommended_answer) lines.push("", `Recommended answer: ${question.recommended_answer}`);
    if (question.source_turn) lines.push("", `Source: ${question.source_actor}.${question.source_turn}`);
    lines.push("", `Blocking: ${question.blocking ? "yes" : "no"}`, "");
  }
  return lines.join("\n").trim();
}

function formatHumanAnswers(answers: HumanAnswer[]): string {
  const lines = ["# Human Answers", ""];
  for (const [index, answer] of answers.entries()) {
    lines.push(`## ${index + 1}. ${answer.question}`);
    lines.push("", answer.answer || "No additional guidance.");
    if (answer.recommended_answer) lines.push("", `Recommended answer was: ${answer.recommended_answer}`);
    if (answer.source_turn) lines.push("", `Source: ${answer.source_actor}.${answer.source_turn}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function canRun(store: ArtifactStore, maxTurns: number): boolean {
  return store.turns.length < maxTurns;
}

function canRunBeforeSynthesis(store: ArtifactStore, maxTurns: number): boolean {
  return store.turns.length + 1 < maxTurns;
}

function canRunCompleteStageBeforeSynthesis(store: ArtifactStore, maxTurns: number, stageTurnCount: number): boolean {
  return store.turns.length + stageTurnCount < maxTurns;
}

function canRunCompleteStage(store: ArtifactStore, maxTurns: number, stageTurnCount: number): boolean {
  return store.turns.length + stageTurnCount <= maxTurns;
}

function latestTurn(turns: TurnRecord[]): TurnRecord | null {
  return turns.length ? turns[turns.length - 1] : null;
}

function stripFrontmatter(markdown: string): string {
  const text = markdown.trimStart();
  if (!text.startsWith("---")) return markdown.trim();
  const end = text.indexOf("\n---", 3);
  if (end === -1) return markdown.trim();
  return text.slice(end + 4).trim();
}
