# The Order of the Agents

[![Agent Order demo](https://raw.githubusercontent.com/btahir/agent-order/main/docs/assets/demo.gif)](https://youtu.be/KTy2g1cQ2Po)

The Order of the Agents convenes a sworn fellowship of AI agents — Codex, Claude, and other CLIs you trust — around a single question. Each agent takes a position, challenges the others, and revises in turn, until the Order issues a final decree. Every oath, critique, and revision is recorded as Markdown, so the reasoning behind the decision is auditable, shareable, and yours to keep.

```bash
agent-order "Plan a Launch Readiness feature for a project management app. Help teams decide whether a release is ready to ship. Include UX, data model, API, risks, telemetry, and acceptance criteria."
```

You get:

- `final/report.md`: the decree, plan, PRD, memo, or recommendation
- `final/decision-log.md`: what changed and why
- `turns/*.md`: every agent position, critique, and revision
- `index.md`: a shareable run summary

Short version: **stop asking one model for decisions that matter.**

## Showcase

Watch the [one-minute product video](https://youtu.be/KTy2g1cQ2Po).

## Why

Single-model answers can be confident and incomplete. The Order of the Agents makes the disagreement visible before it becomes a final recommendation.

```text
-> codex   initial-position
-> claude  initial-position
-> codex   critique
-> claude  critique
-> codex   revision
-> claude  revision
-> codex   synthesis

final/report.md
```

The product is not another chat wrapper. It is an auditable decision packet: independent positions, missed assumptions, critique, revision, and a final artifact you can share with a team.

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

Then run the linked CLI:

```bash
agent-order "Should we build or buy an internal analytics dashboard?"
```

The Order assumes the agent CLIs you use, such as `codex` and `claude`, are already installed and logged in.

## First Demo

Run the mock demo without calling Codex or Claude:

```bash
npm run demo
```

Or run a real two-agent deliberation:

```bash
agent-order ./examples/build-vs-buy-analytics/scenario.md --agents codex,claude --out ./agent-order-runs
```

Good first scenarios:

```bash
agent-order ./examples/build-vs-buy-analytics/scenario.md
agent-order ./examples/rest-to-trpc/scenario.md
agent-order grill ./examples/review-agent-order-readme/scenario.md
```

## What It Writes

```text
agent-order-runs/<timestamp>/
  scenario.md
  index.md
  trace.jsonl
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

`turns/` is the audit trail. `final/report.md` is the artifact you share.

## Commands

```bash
agent-order <scenario-or-file>
agent-order grill <scenario-or-file>
agent-order init
agent-order check
agent-order doctor
```

Common options:

```bash
agent-order ./scenario.md --agents codex,claude
agent-order ./scenario.md --max-turns 10
agent-order ./scenario.md --human-input never
agent-order ./scenario.md --out ./runs
```

## Human Input

Human input is part of the protocol, not a side channel.

Use `grill` mode when the scenario needs clarification before the Order starts:

```bash
agent-order grill "Should we move our frontend to a monorepo?"
```

This produces human and orchestrator turns:

```text
0001-human.seed.md
0002-codex.intake-question.md
0003-human.intake-answer.md
0004-orchestrator.scenario-freeze.md
0005-codex.initial-position.md
```

During a run, agents can also emit structured questions for the user. The orchestrator deduplicates them and pauses only when configured.

```yaml
human_input:
  mode: on_blocking_questions
  max_questions_per_pause: 3
```

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

  - id: claude
    adapter: claude-cli
    command: claude

limits:
  max_turns: 12

output:
  dir: ./agent-order-runs

synthesis:
  agent: codex

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
```

If no config sets `limits.max_turns`, The Order uses `max(12, agents * 4 + 4)` and reserves room for a synthesis turn.

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
    output:
      mode: stdout
```

The generic adapter can pass prompts through stdin, a prompt file, or templated args like `{{prompt}}`, then reads either JSON matching the agent-turn schema or plain Markdown from stdout.

## Product Positioning

The Order of the Agents is for senior developers, tech leads, staff engineers, and AI-heavy builders who already use terminal AI tools and want better review for consequential decisions:

- architecture choices
- build-vs-buy calls
- migration plans
- security and reliability reviews
- PRD/RFC critique
- incident remediation reviews
- developer-tool product strategy

Use it when the decision is worth a few minutes of critique. Do not use it for every prompt.
