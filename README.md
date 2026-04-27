# The Order of the Agents

[![Agent Order demo](https://raw.githubusercontent.com/btahir/agent-order/main/docs/assets/demo.gif)](https://youtu.be/KTy2g1cQ2Po)

The Order of the Agents turns a rough scenario into a reviewed PRD, ADR, RFC, memo, or plan. Multiple agents first think independently, then challenge each other without seeing model identities, then mix the strongest ideas into a final decision packet.

```bash
agent-order prd ./scenario.md
```

You get:

- `final/report.md`: the final PRD, ADR, RFC, memo, plan, or recommendation
- `final/decision-log.md`: what happened, rubric outcomes, blockers, cost/time
- `index.html`: a shareable visual run index
- `index.md`: a lightweight run summary
- `turns/*.md`: every agent position, critique, revision, synthesis, and review
- `trace.jsonl`: structured run events for replay, debugging, and evals

Short version: **stop asking one model for decisions that matter.**

## Why

Single-model answers can be confident and incomplete. The Order of the Agents is built for decisions where the disagreement matters: product requirements, architecture choices, RFCs, migration plans, build-vs-buy decisions, and incident follow-ups.

The product is not another chat wrapper. It is a fair fight for good ideas: agents start with their own plans, critique anonymized peer responses, accept what improves their answer, and push back when feedback is weak. The final report is the mix of the best surviving ideas, with dissent preserved when it still matters.

## Quick Start

```bash
agent-order prd ./scenario.md
open agent-order-runs/<latest>/index.html
```

Pick the artifact you want:

```bash
agent-order adr ./decision.md
agent-order rfc ./proposal.md
agent-order build-vs-buy ./analytics.md
```

Pick more deliberation only when you need it:

```bash
agent-order prd ./scenario.md --depth quick
agent-order prd ./scenario.md --depth standard
agent-order prd ./scenario.md --depth deep
```

## Install

Install from npm:

```bash
npm install -g agent-order
```

Then run:

```bash
agent-order "Should we build or buy an internal analytics dashboard?"
```

For zero-install use:

```bash
npx agent-order@latest ./scenario.md
```

For local development from this repo:

```bash
npm install
npm run build
npm link
```

The Order assumes the agent CLIs you use, such as `codex`, `claude`, `gemini`, or other configured commands, are already installed and logged in.

## First Demos

Run the mock demo without calling Codex or Claude:

```bash
npm run demo
```

Run a mock PRD demo using the built-in PRD template:

```bash
npm run demo:prd
```

Run a real two-agent deliberation:

```bash
agent-order ./examples/build-vs-buy-analytics/scenario.md --agents codex,claude --out ./agent-order-runs
```

Good first scenarios:

```bash
agent-order ./examples/build-vs-buy-analytics/scenario.md
agent-order ./examples/rest-to-trpc/scenario.md
agent-order grill ./examples/review-agent-order-readme/scenario.md
agent-order prd ./docs/evals/scenarios/prd/saved-search/scenario.md --depth quick
agent-order adr ./docs/evals/scenarios/adr/rest-vs-trpc/scenario.md --depth quick
agent-order build-vs-buy ./docs/evals/scenarios/build-vs-buy/analytics/scenario.md --depth quick
```

## What It Writes

```text
agent-order-runs/<timestamp>/
  scenario.md
  index.html
  index.md
  trace.jsonl
  schemas/
    agent-turn.schema.json
  prompts/
  raw/
  turns/
    0001-codex.initial-position.md
    0002-claude.initial-position.md
    0003-codex.critique.md
    0004-claude.critique.md
    ...
  final/
    report.md
    decision-log.md
```

`turns/` is the audit trail. `index.html` is the easiest artifact to share. `final/report.md` is the final decision document.

## Commands

```bash
agent-order <scenario text | scenario.md> [options]
agent-order grill <scenario text | scenario.md> [options]
agent-order <template> <scenario text | scenario.md> [options]
agent-order replay <run-dir> [options]
agent-order init [--config agent-order.config.yaml]
agent-order check [--config agent-order.config.yaml]
agent-order doctor [--config agent-order.config.yaml]
```

Templates:

```text
prd | adr | rfc | build-vs-buy | migration-plan | incident-review
```

Common options:

```bash
agent-order ./scenario.md --agents codex,claude
agent-order ./scenario.md --depth quick
agent-order prd ./scenario.md --depth standard
agent-order ./scenario.md --max-turns 10
agent-order ./scenario.md --human-input never
agent-order ./scenario.md --out ./runs
```

## Templates

Templates give the agents a target artifact shape and a binary final-review rubric.

Built-in templates:

- `prd`: product requirements document
- `adr`: architecture decision record
- `rfc`: request for comments
- `build-vs-buy`: build vs buy memo
- `migration-plan`: staged migration plan
- `incident-review`: blameless incident review

Example:

```bash
agent-order prd ./docs/evals/scenarios/prd/launch-readiness/scenario.md --depth quick
```

Override or add templates with YAML/JSON files:

```bash
agent-order --template my-template --templates-dir ./templates ./scenario.md
```

## Depth

Depth controls how much deliberation happens. You can omit it; the default behaves like `quick`.

- `quick`: fast two-agent review, good default for normal work
- `standard`: adds another model family and an aggregator pass
- `deep`: more agents and stronger synthesis for expensive decisions
- `cheap`: open-source-heavy roster for cost-conscious runs

Under the hood, depth presets choose a roster and synthesis strategy. Every external CLI in the preset must be installed locally.

Example:

```bash
agent-order rfc ./scenario.md --depth deep
```

Use `doctor` to see configured agents plus available presets and templates:

```bash
agent-order doctor
```

## Deliberation Flow

The default flow is intentionally simple:

```text
independent plans -> anonymized critique -> revisions -> synthesis -> rubric review
```

In more detail:

```text
initial-position  -> agents produce their own plans before seeing peers
critique          -> agents critique Response A/B/C, not "Claude" or "Codex"
revision          -> agents can accept good feedback or defend their position
synthesis         -> strongest ideas are combined into one artifact
final-review      -> the artifact is scored against the template rubric
synthesis-revision -> runs when blockers or failed rubric criteria need repair
```

Agent outputs include structured data:

- `claims`: recommendations, assumptions, risks, facts, decisions
- `objections`: critique items with target turn/claim and severity
- `rubric_scores`: binary pass/fail review criteria with evidence
- `incorporated_objection_ids`: which objections were accepted or addressed

Unincorporated major/blocking objections can be preserved in a `## Minority Report` section.

## Human Input

Human input is part of the protocol, not a side channel.

Use `grill` mode when the scenario needs clarification before deliberation:

```bash
agent-order grill "Should we move our frontend to a monorepo?"
```

During a run, agents can also emit structured questions for the user. The orchestrator deduplicates them and pauses only when configured.

```yaml
human_input:
  mode: on_blocking_questions
  max_questions_per_pause: 3
```

Disable human pauses:

```bash
agent-order ./scenario.md --human-input never
```

## Replay

Replay reruns a previous frozen scenario with the current config, or with inherited metadata from the source run.

```bash
agent-order replay ./agent-order-runs/2026-04-26-144108
agent-order replay ./agent-order-runs/2026-04-26-144108 --depth deep
```

The new run links back to the source run with `replay-source.md`.

## Eval Harness

The repo includes a small artifact eval harness under `docs/evals/`.

Current branch:

```bash
npm run eval -- --version current --scenario prd/saved-search
```

Named baselines require an explicit executable so version labels cannot accidentally evaluate the same binary:

```bash
npm run eval -- --version v0.1 --agent-order /path/to/agent-order-v0.1.js
npm run eval -- --version v0.2 --agent-order ./dist/bin/agent-order.js
npm run eval -- --compare v0.1 v0.2
```

The judge command defaults to `claude` and must be available on PATH:

```bash
npm run eval -- --version current --judge-command claude
```

See [docs/evals/README.md](docs/evals/README.md) for the harness layout and ship-gate notes.

## Configuration

Create a starter config:

```bash
agent-order init
```

Default shape:

```yaml
protocol: agent-order/v1

agents:
  - id: codex
    adapter: codex-cli
    command: codex
    preset: codex

  - id: claude
    adapter: claude-cli
    command: claude
    preset: claude

limits:
  max_turns: 12

output:
  dir: ./agent-order-runs

synthesis:
  agent: codex
  aggregators: null
  meta_synthesizer: null

intake:
  enabled: false
  mode: off
  facilitator: codex
  max_questions: 6

human_input:
  mode: on_blocking_questions
  max_questions_per_pause: 3
  ask_before_final: false

final_review:
  enabled: true

template: null
templates_dir: null
cost_warning_usd: 0
```

If no config sets `limits.max_turns`, The Order computes a turn budget from the roster, intake settings, and synthesis mode. The budget is enforced even with batched turns.

## Adding Another Agent

Codex and Claude are built in. Any scriptable CLI can participate through `generic-cli`:

```yaml
agents:
  - id: gemini
    adapter: generic-cli
    command: gemini
    args:
      - -p
      - "{{prompt}}"
    input:
      mode: arg
    output:
      mode: stdout
    check_args:
      - --version
```

The generic adapter can pass prompts through stdin, a prompt file, or templated args like `{{prompt}}`, then reads either JSON matching the agent-turn schema or plain Markdown from stdout.

Curated adapter presets exist for:

```text
codex | claude | gemini | grok | qwen | deepseek
```

## Resources

- [docs/evals/README.md](docs/evals/README.md): eval harness usage
- [docs/evals/scenarios/](docs/evals/scenarios/): fixed eval scenarios
- [examples/](examples/): simple starter scenarios and mock config
- [docs/showcase-video/](docs/showcase-video/): source for the showcase video

## Product Positioning

The Order of the Agents is for senior developers, tech leads, staff engineers, PMs, and AI-heavy builders who already use terminal AI tools and want better review for consequential decisions:

- architecture choices
- build-vs-buy calls
- migration plans
- security and reliability reviews
- PRD/RFC critique
- incident remediation reviews
- developer-tool product strategy

Use it when the decision is worth a few minutes of critique. Do not use it for every prompt.
