import path from "node:path";
import { ArtifactStore } from "./artifacts.js";
import { runAgentTurn } from "./adapters/index.js";
import { buildPrompt } from "./protocol/prompts.js";
import { agentTurnSchema } from "./schema.js";
import { writeText } from "./fs-utils.js";
import { loadTemplate } from "./templates/index.js";
import { buildAnonymizationView, buildSimpleAnonymization, decorateTurnsWithLabels } from "./anonymize.js";
import { renderHtmlIndex } from "./html-index.js";
import type {
  AgentConfig,
  AgentTurnResult,
  AskUser,
  AskUserInput,
  ArtifactTemplate,
  CostInfo,
  CouncilConfig,
  HumanAnswer,
  Objection,
  TurnRecord,
  UserQuestion
} from "./types.js";

interface CouncilState {
  initial: TurnRecord[];
  critiques: TurnRecord[];
  revisions: TurnRecord[];
  postHumanRevisions: TurnRecord[];
  aggregators: TurnRecord[];
  metaSynthesis: TurnRecord | null;
  synthesis: TurnRecord | null;
  finalReviews: TurnRecord[];
  synthesisRevision: TurnRecord | null;
}

interface RunCouncilResult {
  runDir: string;
  finalPath: string;
  htmlPath: string | null;
  turns: TurnRecord[];
  template: ArtifactTemplate | null;
}

interface PromptContextTurn extends TurnRecord {
  content: string;
  displayLabel?: string;
  displayActor?: string;
}

interface TurnSpec {
  agent: AgentConfig;
  phase: string;
  turnNumber: number;
  contextTurns: PromptContextTurn[];
  template?: ArtifactTemplate | null;
  anonymizeContext?: boolean;
  contextSummary?: string;
  anonymousLabel?: string | null;
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
  const template = config.template ? await loadTemplate(config.template, config.templates_dir ?? null) : null;

  await store.appendTrace({
    type: "run.started",
    run_dir: runDir,
    agents: config.agents.map((agent) => ({ id: agent.id, adapter: agent.adapter, preset: agent.preset })),
    template: template ? template.id : null,
    council_preset: config.council_preset ?? null,
    synthesis: config.synthesis
  });

  const state: CouncilState = {
    initial: [],
    critiques: [],
    revisions: [],
    postHumanRevisions: [],
    aggregators: [],
    metaSynthesis: null,
    synthesis: null,
    finalReviews: [],
    synthesisRevision: null
  };

  const synthesizerId = config.synthesis.agent ?? config.agents[0].id;
  const synthesizer = config.agents.find((agent) => agent.id === synthesizerId);
  if (!synthesizer) throw new Error(`Synthesizer agent not found: ${synthesizerId}`);

  onEvent(`Run directory: ${runDir}`);
  if (template) onEvent(`Template: ${template.id}`);
  if (config.council_preset) onEvent(`Council preset: ${config.council_preset}`);

  const frozenScenarioText = await maybeRunIntake({
    store,
    config,
    cwd,
    scenarioText,
    schemaPath,
    facilitator: synthesizer,
    template,
    onEvent,
    askUser
  });
  await store.writeScenario(frozenScenarioText);
  await store.appendTrace({ type: "scenario.frozen" });

  state.initial = await runInitialPositions({
    store,
    config,
    cwd,
    scenarioText: frozenScenarioText,
    schemaPath,
    template,
    onEvent
  });

  if (state.initial.length > 0) {
    state.critiques = await runCritiques({
      store,
      config,
      cwd,
      scenarioText: frozenScenarioText,
      schemaPath,
      template,
      initialTurns: state.initial,
      onEvent
    });
    summarizeDisagreements(state.critiques, onEvent);
  }

  if (state.critiques.length > 0) {
    state.revisions = await runRevisions({
      store,
      config,
      cwd,
      scenarioText: frozenScenarioText,
      schemaPath,
      template,
      initialTurns: state.initial,
      critiqueTurns: state.critiques,
      onEvent
    });
  }

  const clarificationTurns = await maybeAskClarification({
    store,
    config,
    template,
    sourceTurns: [...state.initial, ...state.critiques, ...state.revisions],
    onEvent,
    askUser
  });

  if (clarificationTurns.length > 0) {
    state.postHumanRevisions = await runRevisions({
      store,
      config,
      cwd,
      scenarioText: frozenScenarioText,
      schemaPath,
      template,
      initialTurns: state.initial,
      critiqueTurns: [...state.critiques, ...clarificationTurns],
      onEvent,
      phase: "revision"
    });
  }

  const beforeFinalTurns = await maybeAskBeforeFinal({ store, config, onEvent, askUser });

  const debateTurns = [
    ...state.initial,
    ...state.critiques,
    ...state.revisions,
    ...state.postHumanRevisions,
    ...clarificationTurns,
    ...beforeFinalTurns
  ];

  const aggregatorTurnCount = Array.isArray(config.synthesis.aggregators)
    ? config.synthesis.aggregators.length + 1
    : 0;
  if (
    Array.isArray(config.synthesis.aggregators) &&
    config.synthesis.aggregators.length > 0 &&
    canReserveTurns(store, config, aggregatorTurnCount)
  ) {
    state.aggregators = await runAggregators({
      store,
      config,
      cwd,
      scenarioText: frozenScenarioText,
      schemaPath,
      template,
      debateTurns,
      onEvent
    });

    if (state.aggregators.length > 0) {
      state.metaSynthesis = await runMetaSynthesis({
        store,
        config,
        cwd,
        scenarioText: frozenScenarioText,
        schemaPath,
        template,
        aggregatorTurns: state.aggregators,
        debateTurns,
        onEvent
      });
      state.synthesis = state.metaSynthesis;
    }
  }

  if (!state.synthesis && canReserveTurns(store, config, 1)) {
    state.synthesis = await executeAgentTurn({
      store,
      config,
      cwd,
      schemaPath,
      onEvent,
      spec: {
        agent: synthesizer,
        phase: "synthesis",
        turnNumber: store.reserveTurn(),
        contextTurns: await loadContextTurns(store, debateTurns),
        template
      }
    });
  }

  if (config.final_review.enabled !== false && state.synthesis) {
    state.finalReviews = await runFinalReviews({
      store,
      config,
      cwd,
      scenarioText: frozenScenarioText,
      schemaPath,
      template,
      synthesis: state.synthesis,
      onEvent
    });
    summarizeRubric(state.finalReviews, template, onEvent);
  }

  const hasBlockingReview = state.finalReviews.some((turn) =>
    turn.status === "blocked" ||
    turn.blockingIssues.length > 0 ||
    hasBlockingObjection(turn) ||
    hasFailedRubricScore(turn)
  );

  if (state.synthesis && hasBlockingReview && canReserveTurns(store, config, 1)) {
    state.synthesisRevision = await executeAgentTurn({
      store,
      config,
      cwd,
      schemaPath,
      onEvent,
      spec: {
        agent: synthesizer,
        phase: "synthesis-revision",
        turnNumber: store.reserveTurn(),
        contextTurns: await loadContextTurns(store, [state.synthesis, ...state.finalReviews]),
        template
      }
    });
    state.synthesis = state.synthesisRevision;
  }

  const finalSource = state.synthesis ?? latestTurn(store.sortedTurns);
  const finalMarkdownRaw = finalSource ? await store.readTurn(finalSource) : "# Final Report\n\nNo agent turns completed.\n";
  const minorityReport = buildMinorityReport(state);
  const finalMarkdownWithMinority = appendMinorityReport(stripFrontmatter(finalMarkdownRaw), minorityReport);
  const finalPath = await store.writeFinalReport(finalMarkdownWithMinority, finalSource);
  await writeDecisionLog(store, state, finalPath, template);

  let htmlPath: string | null = null;
  try {
    const html = renderHtmlIndex({
      runDir,
      cwd,
      scenarioText: frozenScenarioText,
      template,
      councilPreset: config.council_preset ?? null,
      turns: store.sortedTurns,
      state,
      finalPath,
      minorityReport
    });
    htmlPath = await store.writeHtmlIndex(html);
  } catch (error) {
    await store.appendTrace({
      type: "html_index.failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }

  await store.writeIndex(finalPath, htmlPath);

  const totals = aggregateCost(store.turns);
  emitCostSummary(totals, onEvent);
  if (config.cost_warning_usd && config.cost_warning_usd > 0 && totals.totalUsd > config.cost_warning_usd) {
    onEvent(`warning: total cost $${totals.totalUsd.toFixed(2)} exceeded warning threshold $${config.cost_warning_usd.toFixed(2)}`);
  }

  await store.appendTrace({
    type: "run.completed",
    final_path: finalPath,
    html_path: htmlPath,
    turn_count: store.turns.length,
    cost_total_usd: totals.totalUsd
  });

  return {
    runDir,
    finalPath,
    htmlPath,
    turns: store.sortedTurns,
    template
  };
}

async function runInitialPositions({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  template,
  onEvent
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  template: ArtifactTemplate | null;
  onEvent: (message: string) => void;
}): Promise<TurnRecord[]> {
  const availableForInitial = Math.max(0, remainingTurns(store, config) - 1);
  const agents = config.agents.slice(0, Math.min(config.agents.length, availableForInitial));
  if (agents.length === 0) return [];
  const turnNumbers = store.reserveTurns(agents.length);
  const specs: TurnSpec[] = agents.map((agent, index) => ({
    agent,
    phase: "initial-position",
    turnNumber: turnNumbers[index],
    contextTurns: [],
    template
  }));
  return runBatch({ store, config, cwd, scenarioText, schemaPath, onEvent, specs });
}

async function runCritiques({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  template,
  initialTurns,
  onEvent
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  template: ArtifactTemplate | null;
  initialTurns: TurnRecord[];
  onEvent: (message: string) => void;
}): Promise<TurnRecord[]> {
  if (!canReserveBeforeSynthesis(store, config, config.agents.length)) return [];

  const participantIds = initialTurns.map((turn) => turn.actor);
  const reviewerIds = config.agents.map((agent) => agent.id);
  const anonymization = buildAnonymizationView({ participants: participantIds, reviewers: reviewerIds });

  await store.appendTrace({
    type: "phase.anonymization",
    phase: "critique",
    reveal: anonymization.reveal,
    views: anonymization.views
  });

  const turnNumbers = store.reserveTurns(config.agents.length);
  const loaded = await loadContextTurns(store, initialTurns);

  const specs: TurnSpec[] = config.agents.map((critic, index) => {
    const view = anonymization.views[critic.id] ?? {};
    const peerTurns = rotateTurns(
      loaded.filter((turn) => turn.actor !== critic.id),
      index
    );
    const decorated = peerTurns.map((turn) => {
      const label = view[turn.actor];
      if (!label) return turn;
      return { ...turn, displayLabel: `Response ${label}`, displayActor: `Response ${label}` };
    });
    return {
      agent: critic,
      phase: "critique",
      turnNumber: turnNumbers[index],
      contextTurns: decorated,
      template,
      anonymizeContext: true
    };
  });

  return runBatch({ store, config, cwd, scenarioText, schemaPath, onEvent, specs });
}

async function runRevisions({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  template,
  initialTurns,
  critiqueTurns,
  onEvent,
  phase = "revision"
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  template: ArtifactTemplate | null;
  initialTurns: TurnRecord[];
  critiqueTurns: TurnRecord[];
  onEvent: (message: string) => void;
  phase?: string;
}): Promise<TurnRecord[]> {
  if (!canReserveBeforeSynthesis(store, config, config.agents.length)) return [];

  const turnNumbers = store.reserveTurns(config.agents.length);
  const baseContext = await loadContextTurns(store, [...initialTurns, ...critiqueTurns]);
  const specs: TurnSpec[] = config.agents.map((agent, index) => ({
    agent,
    phase,
    turnNumber: turnNumbers[index],
    contextTurns: baseContext,
    template
  }));
  return runBatch({ store, config, cwd, scenarioText, schemaPath, onEvent, specs });
}

async function runAggregators({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  template,
  debateTurns,
  onEvent
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  template: ArtifactTemplate | null;
  debateTurns: TurnRecord[];
  onEvent: (message: string) => void;
}): Promise<TurnRecord[]> {
  const aggregatorIds = config.synthesis.aggregators ?? [];
  const aggregators = aggregatorIds
    .map((id) => config.agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentConfig => Boolean(agent));
  if (aggregators.length === 0) return [];
  if (!canReserveTurns(store, config, aggregators.length)) return [];

  const turnNumbers = store.reserveTurns(aggregators.length);
  const baseContext = await loadContextTurns(store, debateTurns);
  const specs: TurnSpec[] = aggregators.map((agent, index) => ({
    agent,
    phase: "aggregator-synthesis",
    turnNumber: turnNumbers[index],
    contextTurns: baseContext,
    template
  }));
  return runBatch({ store, config, cwd, scenarioText, schemaPath, onEvent, specs });
}

async function runMetaSynthesis({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  template,
  aggregatorTurns,
  debateTurns,
  onEvent
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  template: ArtifactTemplate | null;
  aggregatorTurns: TurnRecord[];
  debateTurns: TurnRecord[];
  onEvent: (message: string) => void;
}): Promise<TurnRecord> {
  const metaId = config.synthesis.meta_synthesizer ?? config.synthesis.agent ?? config.agents[0].id;
  const metaAgent = config.agents.find((agent) => agent.id === metaId);
  if (!metaAgent) throw new Error(`Meta-synthesizer agent not found: ${metaId}`);

  const aggregatorActors = aggregatorTurns.map((turn) => turn.actor);
  const mapping = buildSimpleAnonymization(aggregatorActors);
  await store.appendTrace({ type: "phase.anonymization", phase: "meta-synthesis", reveal: mapping });

  const loadedAggregators = await loadContextTurns(store, aggregatorTurns);
  const decoratedAggregators = decorateTurnsWithLabels(loadedAggregators, mapping);

  const summary = `Council ran ${debateTurns.length} prior turns spanning initial positions, critiques, and revisions. Aggregator drafts above synthesize that debate from different angles.`;

  return executeAgentTurn({
    store,
    config,
    cwd,
    schemaPath,
    onEvent,
    spec: {
      agent: metaAgent,
      phase: "meta-synthesis",
      turnNumber: store.reserveTurn(),
      contextTurns: decoratedAggregators,
      template,
      anonymizeContext: true,
      contextSummary: summary
    }
  });
}

async function runFinalReviews({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  template,
  synthesis,
  onEvent
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  template: ArtifactTemplate | null;
  synthesis: TurnRecord;
  onEvent: (message: string) => void;
}): Promise<TurnRecord[]> {
  if (!canReserveTurns(store, config, config.agents.length)) return [];

  const turnNumbers = store.reserveTurns(config.agents.length);
  const context = await loadContextTurns(store, [synthesis]);
  const specs: TurnSpec[] = config.agents.map((agent, index) => ({
    agent,
    phase: "final-review",
    turnNumber: turnNumbers[index],
    contextTurns: context,
    template
  }));
  return runBatch({ store, config, cwd, scenarioText, schemaPath, onEvent, specs });
}

async function runBatch({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  onEvent,
  specs
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  onEvent: (message: string) => void;
  specs: TurnSpec[];
}): Promise<TurnRecord[]> {
  const results = await Promise.all(
    specs.map((spec) =>
      executeAgentTurn({ store, config, cwd, scenarioText, schemaPath, onEvent, spec })
    )
  );
  return results;
}

async function executeAgentTurn({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  onEvent,
  spec
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText?: string;
  schemaPath: string;
  onEvent: (message: string) => void;
  spec: TurnSpec;
}): Promise<TurnRecord> {
  const turnId = store.turnId(spec.turnNumber);
  const effectiveScenario = scenarioText ?? (await store.readScenario());

  const prompt = buildPrompt({
    phase: spec.phase,
    actor: spec.agent.id,
    scenarioText: effectiveScenario,
    agents: config.agents,
    contextTurns: spec.contextTurns,
    template: spec.template ?? null,
    anonymizeContext: spec.anonymizeContext,
    contextSummary: spec.contextSummary
  });
  const promptPath = await store.writePrompt(spec.turnNumber, spec.agent.id, spec.phase, prompt);
  const rawPath = store.rawPath(spec.turnNumber, spec.agent.id, spec.phase, "json");

  await store.appendTrace({
    type: "turn.started",
    turn: turnId,
    actor: spec.agent.id,
    phase: spec.phase,
    prompt_path: promptPath
  });
  onEvent(`Turn ${turnId}: ${spec.agent.id} ${spec.phase}`);

  if (config.dry_run) {
    const result: AgentTurnResult = {
      status: "ok",
      summary: `Dry run artifact for ${spec.agent.id} ${spec.phase}.`,
      markdown: `# ${spec.agent.id} ${spec.phase}\n\nDry run only. Prompt written to \`${path.relative(store.runDir, promptPath)}\`.`,
      blocking_issues: [],
      questions_for_user: [],
      claims: [],
      objections: [],
      rubric_scores: [],
      incorporated_objection_ids: []
    };
    const turn = await store.writeTurn({
      turnNumber: spec.turnNumber,
      actor: spec.agent.id,
      phase: spec.phase,
      inputTurnIds: spec.contextTurns.map((turn) => turn.id),
      result,
      anonymousLabel: spec.anonymousLabel ?? null
    });
    await store.appendTrace({ type: "turn.completed", turn: turn.id, dry_run: true });
    onEvent(`Done ${turn.id}: ${spec.agent.id} ${spec.phase}`);
    return turn;
  }

  const { result, process, raw, cost } = await runAgentTurn({
    agent: spec.agent,
    config,
    prompt,
    schema: agentTurnSchema,
    schemaPath,
    outputPath: rawPath,
    cwd,
    turnNumber: spec.turnNumber,
    phase: spec.phase
  });

  await writeText(rawPath, raw.trim() + "\n");
  const turn = await store.writeTurn({
    turnNumber: spec.turnNumber,
    actor: spec.agent.id,
    phase: spec.phase,
    inputTurnIds: spec.contextTurns.map((turn) => turn.id),
    result,
    cost,
    durationMs: process.durationMs,
    anonymousLabel: spec.anonymousLabel ?? null
  });

  await store.appendTrace({
    type: "turn.completed",
    turn: turn.id,
    actor: spec.agent.id,
    phase: spec.phase,
    duration_ms: process.durationMs,
    command: process.command,
    status: result.status,
    blocking_issue_count: result.blocking_issues.length,
    objection_count: result.objections?.length ?? 0,
    rubric_score_count: result.rubric_scores?.length ?? 0,
    cost: cost ?? null
  });
  onEvent(`Done ${turn.id}: ${spec.agent.id} ${spec.phase}`);

  return turn;
}

async function loadContextTurns(store: ArtifactStore, turns: TurnRecord[]): Promise<PromptContextTurn[]> {
  const loaded = await Promise.all(
    turns.map(async (turn) => ({ ...turn, content: stripFrontmatter(await store.readTurn(turn)) }))
  );
  return loaded;
}

async function maybeRunIntake({
  store,
  config,
  cwd,
  scenarioText,
  schemaPath,
  facilitator,
  template,
  onEvent,
  askUser
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  cwd: string;
  scenarioText: string;
  schemaPath: string;
  facilitator: AgentConfig;
  template: ArtifactTemplate | null;
  onEvent: (message: string) => void;
  askUser: AskUser | null;
}): Promise<string> {
  if (!config.intake.enabled || config.intake.mode === "off") return scenarioText;
  if (config.intake.mode !== "grill") {
    throw new Error(`Unsupported intake mode: ${config.intake.mode}`);
  }
  if (!canReserveTurns(store, config, 2)) return scenarioText;

  const facilitatorId = config.intake.facilitator ?? facilitator.id;
  const facilitatorAgent = config.agents.find((agent) => agent.id === facilitatorId) ?? facilitator;

  const seedTurnNumber = store.reserveTurn();
  const seedTurn = await writeSyntheticTurn({
    store,
    turnNumber: seedTurnNumber,
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
    if (!canReserveTurns(store, config, 2)) break;
    const questionTurn = await executeAgentTurn({
      store,
      config,
      cwd,
      schemaPath,
      onEvent,
      spec: {
        agent: facilitatorAgent,
        phase: "intake-question",
        turnNumber: store.reserveTurn(),
        contextTurns: await loadContextTurns(store, intakeTurns),
        template
      }
    });
    intakeTurns.push(questionTurn);

    const questions = withQuestionSources(questionTurn.questionsForUser, questionTurn).slice(0, 1);
    if (questions.length === 0) break;

    const response = askUser
      ? await askWithEvent({
          onEvent,
          title: "Intake clarification",
          questions,
          allowDone: true,
          defaultToRecommendation: true,
          askUser
        })
      : { answers: questions.map(defaultAnswerForQuestion), stopped: false };

    if (response.answers.length > 0) {
      answers.push(...response.answers);
      if (canReserveTurns(store, config, 1)) {
        const answerTurn = await writeHumanAnswersTurn({
          store,
          turnNumber: store.reserveTurn(),
          phase: "intake-answer",
          inputTurnIds: [questionTurn.id],
          answers: response.answers,
          summary: "User answered an intake question."
        });
        intakeTurns.push(answerTurn);
      }
    }

    if (response.stopped) {
      stopped = true;
      break;
    }
  }

  const frozenScenario = buildFrozenScenario(scenarioText, answers, stopped, template);
  if (!canReserveTurns(store, config, 1)) return frozenScenario;
  const freezeTurn = await writeSyntheticTurn({
    store,
    turnNumber: store.reserveTurn(),
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
  template,
  sourceTurns,
  onEvent,
  askUser
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  template: ArtifactTemplate | null;
  sourceTurns: TurnRecord[];
  onEvent: (message: string) => void;
  askUser: AskUser | null;
}): Promise<TurnRecord[]> {
  const mode = config.human_input.mode;
  if (!["on_blocking_questions", "interactive"].includes(mode)) return [];

  const questions = collectQuestions(sourceTurns, mode === "on_blocking_questions");
  if (questions.length === 0) return [];
  if (!canReserveBeforeSynthesis(store, config, 2)) return [];

  const selectedQuestions = questions.slice(0, config.human_input.max_questions_per_pause);
  const questionTurn = await writeSyntheticTurn({
    store,
    turnNumber: store.reserveTurn(),
    actor: "orchestrator",
    phase: "user-questions",
    inputTurnIds: [
      ...new Set(
        selectedQuestions.map((question) => question.source_turn).filter((id): id is string => typeof id === "string")
      )
    ],
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
    ? await askWithEvent({
        onEvent,
        title: "Clarification requested",
        questions: selectedQuestions,
        allowDone: false,
        defaultToRecommendation: true,
        askUser
      })
    : { answers: selectedQuestions.map(defaultAnswerForQuestion), stopped: false };

  if (response.answers.length === 0) return [questionTurn];

  const answerTurn = await writeHumanAnswersTurn({
    store,
    turnNumber: store.reserveTurn(),
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
  onEvent,
  askUser
}: {
  store: ArtifactStore;
  config: CouncilConfig;
  onEvent: (message: string) => void;
  askUser: AskUser | null;
}): Promise<TurnRecord[]> {
  const shouldAsk =
    config.human_input.mode === "before_final" ||
    config.human_input.mode === "interactive" ||
    config.human_input.ask_before_final;
  if (!shouldAsk) return [];
  if (!canReserveBeforeSynthesis(store, config, 1)) return [];

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
    turnNumber: store.reserveTurn(),
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
    ? await askWithEvent({
        onEvent,
        title: "Before final synthesis",
        questions: [question],
        allowDone: false,
        defaultToRecommendation: false,
        askUser
      })
    : { answers: [], stopped: false };

  const realAnswers = response.answers.filter((answer) => answer.answer.trim());
  if (realAnswers.length === 0) return [questionTurn];
  if (!canReserveBeforeSynthesis(store, config, 1)) return [questionTurn];

  const answerTurn = await writeHumanAnswersTurn({
    store,
    turnNumber: store.reserveTurn(),
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
  turnNumber,
  actor,
  phase,
  inputTurnIds,
  result,
  cost,
  durationMs
}: {
  store: ArtifactStore;
  turnNumber: number;
  actor: string;
  phase: string;
  inputTurnIds: string[];
  result: AgentTurnResult;
  cost?: CostInfo;
  durationMs?: number;
}): Promise<TurnRecord> {
  const turn = await store.writeTurn({ turnNumber, actor, phase, inputTurnIds, result, cost, durationMs });
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

async function askWithEvent({
  onEvent,
  askUser,
  ...input
}: AskUserInput & {
  onEvent: (message: string) => void;
  askUser: AskUser;
}) {
  onEvent(`Input requested: ${input.title ?? "Human input"}`);
  return askUser(input);
}

async function writeHumanAnswersTurn({
  store,
  turnNumber,
  phase,
  inputTurnIds,
  answers,
  summary
}: {
  store: ArtifactStore;
  turnNumber: number;
  phase: string;
  inputTurnIds: string[];
  answers: HumanAnswer[];
  summary: string;
}): Promise<TurnRecord> {
  return writeSyntheticTurn({
    store,
    turnNumber,
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

function summarizeDisagreements(critiques: TurnRecord[], onEvent: (message: string) => void): void {
  const byTarget = new Map<string, { blocking: number; major: number; minor: number; sources: Set<string> }>();
  for (const critique of critiques) {
    for (const objection of critique.objections ?? []) {
      const target = objection.target_turn ?? "unspecified";
      const entry = byTarget.get(target) ?? { blocking: 0, major: 0, minor: 0, sources: new Set<string>() };
      entry[objection.severity] += 1;
      entry.sources.add(critique.actor);
      byTarget.set(target, entry);
    }
  }
  if (byTarget.size === 0) return;
  for (const [target, entry] of byTarget) {
    if (entry.blocking + entry.major === 0) continue;
    const sources = [...entry.sources].join(", ");
    const severity = entry.blocking > 0 ? "blocking" : "major";
    onEvent(
      `disagreement: target ${target}  ${severity} ${entry.blocking + entry.major}  from ${sources}`
    );
  }
}

function summarizeRubric(
  reviews: TurnRecord[],
  template: ArtifactTemplate | null,
  onEvent: (message: string) => void
): void {
  if (!template || reviews.length === 0) return;
  const map = new Map<string, { criterion_text: string; passed: number; total: number }>();
  for (const review of reviews) {
    for (const score of review.rubricScores ?? []) {
      const entry = map.get(score.criterion_id) ?? {
        criterion_text: score.criterion_text,
        passed: 0,
        total: 0
      };
      entry.total += 1;
      if (score.pass) entry.passed += 1;
      map.set(score.criterion_id, entry);
    }
  }
  if (map.size === 0) return;
  for (const criterion of template.rubric) {
    const entry = map.get(criterion.id);
    if (!entry) continue;
    onEvent(
      `rubric: ${criterion.id}  ${criterion.text}  pass:${entry.passed} fail:${entry.total - entry.passed}`
    );
  }
}

function emitCostSummary(
  totals: { totalUsd: number; totalIn: number; totalOut: number; totalMs: number },
  onEvent: (message: string) => void
): void {
  const cost = totals.totalUsd > 0 ? `$${totals.totalUsd.toFixed(4)}` : "unreported";
  const inK = totals.totalIn ? `${formatTokens(totals.totalIn)} in` : "";
  const outK = totals.totalOut ? `${formatTokens(totals.totalOut)} out` : "";
  const time = `${(totals.totalMs / 1000).toFixed(1)}s wall`;
  onEvent(`cost: ${cost}  ${[inK, outK, time].filter(Boolean).join("  ")}`);
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function buildMinorityReport(state: CouncilState): string | null {
  const incorporated = new Set<string>();
  const collect = (turn: TurnRecord | null) => {
    if (!turn) return;
    for (const id of turn.incorporatedObjectionIds ?? []) incorporated.add(id);
  };
  collect(state.synthesis);
  for (const turn of state.aggregators) collect(turn);
  for (const turn of state.revisions) collect(turn);
  for (const turn of state.postHumanRevisions) collect(turn);

  const candidates: Array<{ source: TurnRecord; objection: Objection }> = [];
  const seen = new Set<string>();
  for (const turn of [...state.critiques, ...state.finalReviews]) {
    for (const objection of turn.objections ?? []) {
      if (objection.severity === "minor") continue;
      const key = `${turn.id}:${objection.id}`;
      if (incorporated.has(objection.id) || incorporated.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ source: turn, objection });
    }
  }

  if (candidates.length === 0) return null;

  const lines = ["## Minority Report", "", "Unincorporated dissent and unresolved blocking issues from the deliberation:", ""];
  for (const { source, objection } of candidates) {
    const target = objection.target_turn
      ? ` (re ${objection.target_turn}${objection.target_claim_id ? `:${objection.target_claim_id}` : ""})`
      : "";
    const fix = objection.suggested_fix ? ` _Suggested fix:_ ${objection.suggested_fix}` : "";
    lines.push(`- **${source.actor} ${objection.severity}**${target} \`${objection.id}\`: ${objection.text}${fix}`);
  }

  return lines.join("\n");
}

function appendMinorityReport(markdown: string, minorityReport: string | null): string {
  if (!minorityReport) return markdown;
  if (markdown.includes("## Minority Report")) return markdown;
  return markdown.trim() + "\n\n" + minorityReport.trim() + "\n";
}

function hasBlockingObjection(turn: TurnRecord): boolean {
  return (turn.objections ?? []).some((obj) => obj.severity === "blocking");
}

function hasFailedRubricScore(turn: TurnRecord): boolean {
  return (turn.rubricScores ?? []).some((score) => !score.pass);
}

function remainingTurns(store: ArtifactStore, config: CouncilConfig): number {
  return Math.max(0, config.limits.max_turns - store.reservedSoFar());
}

function canReserveTurns(store: ArtifactStore, config: CouncilConfig, count: number): boolean {
  return count <= remainingTurns(store, config);
}

function canReserveBeforeSynthesis(store: ArtifactStore, config: CouncilConfig, count: number): boolean {
  return count <= Math.max(0, remainingTurns(store, config) - 1);
}

function rotateTurns<T>(turns: T[], offset: number): T[] {
  if (turns.length === 0) return turns;
  const normalized = offset % turns.length;
  return [...turns.slice(normalized), ...turns.slice(0, normalized)];
}

async function writeDecisionLog(
  store: ArtifactStore,
  state: CouncilState,
  finalPath: string,
  template: ArtifactTemplate | null
): Promise<void> {
  const lines = [
    "# Decision Log",
    "",
    `Final report: \`${path.relative(store.runDir, finalPath)}\``
  ];
  if (template) lines.push(`Template: ${template.id}`);
  lines.push("", "## Inputs", "");

  for (const turn of store.sortedTurns) {
    const cost = turn.cost?.cost_usd ? ` ($${turn.cost.cost_usd.toFixed(4)})` : "";
    lines.push(`- ${turn.id} ${turn.actor}.${turn.phase}: ${turn.summary}${cost}`);
  }

  lines.push("", "## Final Review Rubric", "");
  if (state.finalReviews.length === 0) {
    lines.push("No final-review turns ran.");
  } else {
    const rubricSummary = aggregateRubricScores(state.finalReviews);
    if (rubricSummary.length === 0) {
      lines.push("No rubric scores were reported.");
    } else {
      for (const entry of rubricSummary) {
        const verdict = entry.passed >= Math.ceil(entry.total / 2) ? "pass" : "fail";
        lines.push(`- \`${entry.criterion_id}\` ${entry.criterion_text}: ${entry.passed}/${entry.total} ${verdict}`);
      }
    }
  }

  const blockers = state.finalReviews.flatMap((turn) =>
    turn.blockingIssues.map((issue) => ({ turn, issue }))
  );
  lines.push("", "## Final Review Blockers", "");
  if (blockers.length === 0) {
    lines.push("No blocking issues were reported in final review.");
  } else {
    for (const blocker of blockers) {
      lines.push(`- ${blocker.turn.id} ${blocker.turn.actor}: ${blocker.issue}`);
    }
  }

  const cost = aggregateCost(store.turns);
  lines.push("", "## Cost & Time", "");
  lines.push(`- Total cost: ${cost.totalUsd > 0 ? `$${cost.totalUsd.toFixed(4)}` : "unreported"}`);
  lines.push(`- Total tokens in: ${cost.totalIn || "unreported"}`);
  lines.push(`- Total tokens out: ${cost.totalOut || "unreported"}`);
  lines.push(`- Total wall-clock duration across turns: ${(cost.totalMs / 1000).toFixed(1)}s`);

  await writeText(path.join(store.finalDir, "decision-log.md"), lines.join("\n") + "\n");
}

function aggregateRubricScores(turns: TurnRecord[]) {
  const map = new Map<string, { criterion_id: string; criterion_text: string; passed: number; total: number }>();
  for (const turn of turns) {
    for (const score of turn.rubricScores ?? []) {
      const entry = map.get(score.criterion_id) ?? {
        criterion_id: score.criterion_id,
        criterion_text: score.criterion_text,
        passed: 0,
        total: 0
      };
      entry.total += 1;
      if (score.pass) entry.passed += 1;
      map.set(score.criterion_id, entry);
    }
  }
  return [...map.values()];
}

function aggregateCost(turns: TurnRecord[]): { totalUsd: number; totalIn: number; totalOut: number; totalMs: number } {
  let totalUsd = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalMs = 0;
  for (const turn of turns) {
    if (turn.cost?.cost_usd) totalUsd += turn.cost.cost_usd;
    if (turn.cost?.tokens_in) totalIn += turn.cost.tokens_in;
    if (turn.cost?.tokens_out) totalOut += turn.cost.tokens_out;
    if (turn.durationMs) totalMs += turn.durationMs;
  }
  return { totalUsd, totalIn, totalOut, totalMs };
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

function buildFrozenScenario(
  seedScenario: string,
  answers: HumanAnswer[],
  stopped: boolean,
  template: ArtifactTemplate | null
): string {
  const lines = ["# Frozen Scenario", "", "## Original Scenario", "", seedScenario.trim()];

  if (template) {
    lines.push("", "## Target Artifact", "", `Template: **${template.name}** (\`${template.id}\`)`);
    if (template.synthesis_structure?.sections?.length) {
      lines.push("", "Required sections:");
      for (const section of template.synthesis_structure.sections) lines.push(`- ${section}`);
    }
  }

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

  if (stopped) lines.push("## Intake Status", "", "The user ended intake manually.");

  return lines.join("\n").trim();
}

function collectQuestions(turns: TurnRecord[], blockingOnly: boolean): UserQuestion[] {
  const seen = new Set();
  const questions: UserQuestion[] = [];
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
