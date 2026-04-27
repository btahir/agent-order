# Eval harness

The harness measures whether `agent-order` produces better artifacts version-over-version on a fixed set of scenarios scored by a fixed judge.

## Layout

```
docs/evals/
  README.md                    this file
  judge-prompt.md              the judge's system prompt (held constant across runs)
  scenarios/
    <template>/<id>/
      scenario.md              scenario text the agents deliberate on
  results/
    <version>/<timestamp>/
      <template>-<id>/
        artifact.md            copy of final/report.md
        scorecard.json         judge's binary pass/fail per rubric criterion
      summary.json             aggregate scorecard for this version
```

## Running

```bash
# Score the current built CLI
npm run eval -- --version current

# Score a single scenario
npm run eval -- --version current --scenario prd/saved-search

# Score against a specific deliberation depth
npm run eval -- --version current --depth standard

# Score against a non-default agent-order config (mock or override)
npm run eval -- --version current --config path/to/agent-order.config.yaml

# Override the judge command (default: claude)
npm run eval -- --version current --judge-command claude

# Score a named baseline. The executable is required; --version is only a result label.
npm run eval -- --version v0.1 --agent-order /path/to/agent-order-v0.1.js
npm run eval -- --version v0.2 --agent-order ./dist/bin/agent-order.js

# Compare two result dirs
npm run eval -- --compare v0.1 v0.2
```

## Judge

The judge is one model held constant across runs. Default is `claude` via the `claude-cli` adapter; override with `--judge-command`. The judge sees the rubric (built into each template) plus the artifact and returns binary pass/fail with one short evidence quote per item.

Prefer a judge that is not in any measured agent roster. If that is not possible, keep the judge fixed across runs and document the residual self-preference risk.

## Ship gate

A v0.2-tagged build only ships when:
- aggregate rubric pass-rate is up vs v0.1, and
- no template has a material regression, and
- minority-report / unresolved-blocker preservation is non-zero on at least one scenario where v0.1 hid disagreement.
