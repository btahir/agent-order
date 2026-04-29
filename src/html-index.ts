import path from "node:path";
import { collectDeliberationHighlights } from "./deliberation-highlights.js";
import type { ArtifactTemplate, Objection, RubricScore, TurnRecord } from "./types.js";

export interface HtmlIndexInput {
  runDir: string;
  cwd: string;
  scenarioText: string;
  template: ArtifactTemplate | null;
  councilPreset: string | null;
  turns: TurnRecord[];
  state: HtmlIndexState;
  finalPath: string;
  minorityReport: string | null;
}

export interface HtmlIndexState {
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

export function renderHtmlIndex(input: HtmlIndexInput): string {
  const css = baseCss();
  const header = renderHeader(input);
  const scenario = renderScenario(input.scenarioText, input.template);
  const highlights = renderDeliberationHighlights(input.turns);
  const initial = renderInitialPositions(input.state.initial);
  const critiques = renderCritiqueMatrix(input.state.critiques, input.state.initial);
  const revisions = renderRevisions(input.state.initial, [
    ...input.state.revisions,
    ...input.state.postHumanRevisions
  ]);
  const synthesis = renderSynthesis(input.state);
  const rubric = renderRubricScorecard(input.state.finalReviews, input.template);
  const minority = renderMinorityReport(input.minorityReport);
  const cost = renderCostFooter(input.turns);
  const turnsTable = renderTurnsTable(input.turns, input.runDir);

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Order of the Agents Run</title>`,
    `<style>${css}</style>`,
    "</head>",
    "<body>",
    `<main class="run">`,
    header,
    scenario,
    highlights,
    initial,
    critiques,
    revisions,
    synthesis,
    rubric,
    minority,
    cost,
    turnsTable,
    "</main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function renderHeader(input: HtmlIndexInput): string {
  const finalRel = path.relative(input.runDir, input.finalPath);
  const lines = [
    `<header>`,
    `<h1>Order of the Agents Run</h1>`,
    `<p class="muted">Run dir: <code>${escapeHtml(path.relative(input.cwd, input.runDir))}</code></p>`
  ];
  if (input.template) {
    lines.push(
      `<p class="muted">Template: <strong>${escapeHtml(input.template.name)}</strong> (<code>${escapeHtml(input.template.id)}</code>)</p>`
    );
  }
  if (input.councilPreset) {
    lines.push(`<p class="muted">Council preset: <code>${escapeHtml(input.councilPreset)}</code></p>`);
  }
  lines.push(`<p>Final report: <a href="${escapeHtml(finalRel)}"><code>${escapeHtml(finalRel)}</code></a></p>`);
  lines.push(`</header>`);
  return lines.join("\n");
}

function renderDeliberationHighlights(turns: TurnRecord[]): string {
  const highlights = collectDeliberationHighlights(turns, { perTurn: 2, max: 18 });
  if (highlights.length === 0) {
    return section("Deliberation highlights", "<p class='muted'>No structured highlights were reported.</p>");
  }
  const items = highlights
    .map(
      (highlight) =>
        `<li><span class="highlight-kind kind-${escapeHtml(highlight.kind)}">${escapeHtml(highlight.kind)}</span><span><code>${escapeHtml(highlight.turnId)}</code> <strong>${escapeHtml(highlight.actor)}</strong> <span class="muted">${escapeHtml(highlight.phase)}</span><br>${escapeHtml(highlight.text)}</span></li>`
    )
    .join("");
  return section("Deliberation highlights", `<ol class="highlights">${items}</ol>`);
}

function renderScenario(scenarioText: string, template: ArtifactTemplate | null): string {
  return section(
    "Scenario",
    `<div class="scenario">${markdownToHtml(scenarioText)}</div>` +
      (template
        ? `<details><summary>Template: ${escapeHtml(template.name)}</summary><div class="muted small">${escapeHtml(template.summary)}</div></details>`
        : "")
  );
}

function renderInitialPositions(turns: TurnRecord[]): string {
  if (turns.length === 0) return section("Initial positions", "<p class='muted'>No initial-position turns.</p>");
  const cards = turns
    .map(
      (turn) => `
        <article class="card">
          <header>
            <h3>${escapeHtml(turn.actor)}</h3>
            <span class="badge">${escapeHtml(turn.id)}</span>
          </header>
          <p class="muted">${escapeHtml(turn.summary)}</p>
          ${renderClaims(turn)}
        </article>`
    )
    .join("\n");
  return section("Initial positions", `<div class="grid">${cards}</div>`);
}

function renderClaims(turn: TurnRecord): string {
  if (!turn.claims?.length) return "";
  const items = turn.claims
    .map(
      (claim) =>
        `<li><span class="kind kind-${escapeHtml(claim.kind)}">${escapeHtml(claim.kind)}</span> <code>${escapeHtml(claim.id)}</code> ${escapeHtml(claim.text)}</li>`
    )
    .join("");
  return `<details><summary>Claims (${turn.claims.length})</summary><ul class="claims">${items}</ul></details>`;
}

function renderCritiqueMatrix(critiques: TurnRecord[], initial: TurnRecord[]): string {
  if (critiques.length === 0) return section("Critique matrix", "<p class='muted'>No critique turns.</p>");
  const rows = critiques
    .map((critique) => {
      const objections = critique.objections ?? [];
      const grouped = new Map<string, Objection[]>();
      for (const obj of objections) {
        const target = obj.target_turn ?? "unspecified";
        if (!grouped.has(target)) grouped.set(target, []);
        grouped.get(target)!.push(obj);
      }
      const cells = initial
        .map((target) => {
          if (target.actor === critique.actor) return `<td class="self">self</td>`;
          const items = grouped.get(target.id) ?? [];
          if (items.length === 0) return `<td class="muted">no objections</td>`;
          const list = items
            .map(
              (obj) =>
                `<li><span class="severity sev-${escapeHtml(obj.severity)}">${escapeHtml(obj.severity)}</span> ${escapeHtml(obj.text)}</li>`
            )
            .join("");
          return `<td><ul class="objections">${list}</ul></td>`;
        })
        .join("");
      return `<tr><th scope="row">${escapeHtml(critique.actor)}</th>${cells}</tr>`;
    })
    .join("");
  const headerCells = initial.map((turn) => `<th scope="col">${escapeHtml(turn.actor)}</th>`).join("");
  return section(
    "Critique matrix",
    `<table class="matrix"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function renderRevisions(initial: TurnRecord[], revisions: TurnRecord[]): string {
  if (revisions.length === 0) return section("Revisions", "<p class='muted'>No revision turns.</p>");
  const initialByActor = new Map(initial.map((turn) => [turn.actor, turn]));
  const cards = revisions
    .map((rev) => {
      const orig = initialByActor.get(rev.actor);
      const incorporated = (rev.incorporatedObjectionIds ?? []).map((id) => `<code>${escapeHtml(id)}</code>`).join(", ");
      const summary = rev.summary ? `<p class="muted">${escapeHtml(rev.summary)}</p>` : "";
      const incorporatedBlock = incorporated
        ? `<p class="small">Incorporated: ${incorporated}</p>`
        : `<p class="small muted">No objections explicitly incorporated.</p>`;
      const initialSummary = orig ? `<p class="muted small">Initial summary: ${escapeHtml(orig.summary)}</p>` : "";
      return `
        <article class="card">
          <header>
            <h3>${escapeHtml(rev.actor)} ${escapeHtml(rev.phase)}</h3>
            <span class="badge">${escapeHtml(rev.id)}</span>
          </header>
          ${summary}
          ${initialSummary}
          ${incorporatedBlock}
          ${renderClaims(rev)}
        </article>`;
    })
    .join("\n");
  return section("Revisions", `<div class="grid">${cards}</div>`);
}

function renderSynthesis(state: HtmlIndexState): string {
  const aggregatorsBlock = state.aggregators.length
    ? `<details><summary>Aggregator drafts (${state.aggregators.length})</summary>${state.aggregators
        .map(
          (turn) =>
            `<article class="card"><header><h4>${escapeHtml(turn.actor)} aggregator-synthesis <span class="badge">${escapeHtml(turn.id)}</span></h4></header><p class="muted">${escapeHtml(turn.summary)}</p>${renderClaims(turn)}</article>`
        )
        .join("\n")}</details>`
    : "";
  const final = state.synthesisRevision ?? state.synthesis;
  const finalBlock = final
    ? `<article class="card"><header><h3>Final synthesis: ${escapeHtml(final.actor)} ${escapeHtml(final.phase)} <span class="badge">${escapeHtml(final.id)}</span></h3></header><p class="muted">${escapeHtml(final.summary)}</p>${renderClaims(final)}</article>`
    : "<p class='muted'>No synthesis turn ran.</p>";
  return section("Synthesis", `${aggregatorsBlock}${finalBlock}`);
}

function renderRubricScorecard(finalReviews: TurnRecord[], template: ArtifactTemplate | null): string {
  if (!template || finalReviews.length === 0) {
    return section("Rubric scorecard", "<p class='muted'>No template rubric was scored for this run.</p>");
  }
  const reviewerById = new Map(finalReviews.map((turn) => [turn.actor, turn]));
  const reviewers = [...reviewerById.keys()];
  const headerCells = reviewers.map((id) => `<th scope="col">${escapeHtml(id)}</th>`).join("");
  const rows = template.rubric
    .map((criterion) => {
      const cells = reviewers
        .map((id) => {
          const turn = reviewerById.get(id);
          const score = turn?.rubricScores?.find((s) => s.criterion_id === criterion.id);
          if (!score) return `<td class="muted">missing</td>`;
          return `<td class="${score.pass ? "pass" : "fail"}" title="${escapeHtml(score.evidence)}">${score.pass ? "pass" : "fail"}</td>`;
        })
        .join("");
      return `<tr><th scope="row" title="${escapeHtml(criterion.guidance ?? "")}"><code>${escapeHtml(criterion.id)}</code> ${escapeHtml(criterion.text)}</th>${cells}</tr>`;
    })
    .join("");
  return section(
    "Rubric scorecard",
    `<table class="matrix scorecard"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function renderMinorityReport(report: string | null): string {
  if (!report) return section("Minority report", "<p class='muted'>No unincorporated dissent above minor severity.</p>");
  return section("Minority report", `<div class="minority">${markdownToHtml(report)}</div>`);
}

function renderCostFooter(turns: TurnRecord[]): string {
  let totalUsd = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalMs = 0;
  const perActor = new Map<string, { usd: number; in: number; out: number; ms: number }>();
  for (const turn of turns) {
    const entry = perActor.get(turn.actor) ?? { usd: 0, in: 0, out: 0, ms: 0 };
    if (turn.cost?.cost_usd) {
      totalUsd += turn.cost.cost_usd;
      entry.usd += turn.cost.cost_usd;
    }
    if (turn.cost?.tokens_in) {
      totalIn += turn.cost.tokens_in;
      entry.in += turn.cost.tokens_in;
    }
    if (turn.cost?.tokens_out) {
      totalOut += turn.cost.tokens_out;
      entry.out += turn.cost.tokens_out;
    }
    if (turn.durationMs) {
      totalMs += turn.durationMs;
      entry.ms += turn.durationMs;
    }
    perActor.set(turn.actor, entry);
  }
  const rows = [...perActor.entries()]
    .map(
      ([actor, entry]) =>
        `<tr><th scope="row">${escapeHtml(actor)}</th><td>${entry.usd > 0 ? `$${entry.usd.toFixed(4)}` : "—"}</td><td>${entry.in || "—"}</td><td>${entry.out || "—"}</td><td>${(entry.ms / 1000).toFixed(1)}s</td></tr>`
    )
    .join("");
  const totals = `<tr class="totals"><th scope="row">Total</th><td>${totalUsd > 0 ? `$${totalUsd.toFixed(4)}` : "—"}</td><td>${totalIn || "—"}</td><td>${totalOut || "—"}</td><td>${(totalMs / 1000).toFixed(1)}s</td></tr>`;
  return section(
    "Cost & time",
    `<table class="matrix"><thead><tr><th></th><th>Cost</th><th>Tokens in</th><th>Tokens out</th><th>Wall time</th></tr></thead><tbody>${rows}${totals}</tbody></table>`
  );
}

function renderTurnsTable(turns: TurnRecord[], runDir: string): string {
  const rows = turns
    .map((turn) => {
      const rel = path.relative(runDir, turn.path);
      const label = turn.anonymousLabel ? ` <span class="badge">${escapeHtml(turn.anonymousLabel)}</span>` : "";
      return `<tr><td><code>${escapeHtml(turn.id)}</code></td><td>${escapeHtml(turn.actor)}${label}</td><td>${escapeHtml(turn.phase)}</td><td><a href="${escapeHtml(rel)}">${escapeHtml(rel)}</a></td></tr>`;
    })
    .join("");
  return section(
    "All turns",
    `<table class="matrix"><thead><tr><th>Turn</th><th>Actor</th><th>Phase</th><th>File</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

function section(title: string, body: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const html: string[] = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push("");
      continue;
    }
    if (trimmed.startsWith("# ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h3>${inlineMarkdown(trimmed.slice(2))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h4>${inlineMarkdown(trimmed.slice(3))}</h4>`);
      continue;
    }
    if (trimmed.startsWith("### ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h5>${inlineMarkdown(trimmed.slice(4))}</h5>`);
      continue;
    }
    if (trimmed.startsWith("- ")) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${inlineMarkdown(trimmed.slice(2))}</li>`);
      continue;
    }
    if (inList) { html.push("</ul>"); inList = false; }
    html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }
  if (inList) html.push("</ul>");
  return html.join("\n");
}

function inlineMarkdown(value: string): string {
  let out = escapeHtml(value);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/_([^_]+)_/g, "<em>$1</em>");
  return out;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function baseCss(): string {
  return `
:root {
  color-scheme: light dark;
  --bg: #fafafa;
  --fg: #111;
  --muted: #6b7280;
  --accent: #2563eb;
  --pass: #16a34a;
  --fail: #dc2626;
  --border: #e5e7eb;
  --card: #ffffff;
  --code: #f3f4f6;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#0f172a; --fg:#e5e7eb; --muted:#94a3b8; --accent:#60a5fa; --pass:#22c55e; --fail:#f87171; --border:#1f2937; --card:#111827; --code:#1f2937; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.5; }
main.run { max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-size: 1.75rem; margin: 0 0 0.5rem; }
h2 { font-size: 1.25rem; margin: 2rem 0 0.75rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.05rem; margin: 0.5rem 0; }
h4 { font-size: 1rem; margin: 0.5rem 0; }
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
header p { margin: 0.15rem 0; }
section { margin-top: 1.25rem; }
code { background: var(--code); padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.92em; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
.card header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-bottom: 0.5rem; }
.badge { background: var(--code); color: var(--muted); padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.78rem; font-family: ui-monospace, Menlo, monospace; }
ul.claims { list-style: none; padding: 0; margin: 0.4rem 0 0; }
ul.claims li { padding: 0.25rem 0; border-bottom: 1px dashed var(--border); font-size: 0.9rem; }
ul.objections { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; }
ul.objections li { padding: 0.2rem 0; }
.highlights { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.55rem; }
.highlights li { display: grid; grid-template-columns: 8.5rem 1fr; gap: 0.75rem; align-items: start; padding: 0.65rem 0; border-bottom: 1px dashed var(--border); }
.highlight-kind { width: max-content; font-size: 0.72rem; padding: 0.12rem 0.45rem; border-radius: 999px; background: var(--code); color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.kind { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 999px; background: var(--code); color: var(--muted); margin-right: 0.4rem; text-transform: uppercase; letter-spacing: 0.04em; }
.kind-recommendation { background: rgba(37, 99, 235, 0.12); color: var(--accent); }
.kind-decision { background: rgba(37, 99, 235, 0.12); color: var(--accent); }
.kind-risk { background: rgba(220, 38, 38, 0.12); color: var(--fail); }
.kind-disagreement, .kind-rubric { background: rgba(220, 38, 38, 0.12); color: var(--fail); }
.kind-assumption { background: rgba(245, 158, 11, 0.15); color: #b45309; }
.kind-revision { background: rgba(22, 163, 74, 0.12); color: var(--pass); }
.severity { font-size: 0.72rem; padding: 0.05rem 0.35rem; border-radius: 999px; margin-right: 0.35rem; font-weight: 600; }
.sev-blocking { background: rgba(220, 38, 38, 0.18); color: var(--fail); }
.sev-major { background: rgba(245, 158, 11, 0.18); color: #b45309; }
.sev-minor { background: rgba(107, 114, 128, 0.18); color: var(--muted); }
table.matrix { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
table.matrix th, table.matrix td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; font-size: 0.88rem; }
table.matrix th[scope="col"] { background: var(--code); }
table.matrix td.self { background: var(--code); color: var(--muted); }
table.matrix td.pass { background: rgba(22, 163, 74, 0.12); color: var(--pass); font-weight: 600; }
table.matrix td.fail { background: rgba(220, 38, 38, 0.12); color: var(--fail); font-weight: 600; }
table.matrix tr.totals th, table.matrix tr.totals td { font-weight: 600; background: var(--code); }
.scenario { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
.minority { background: rgba(220, 38, 38, 0.06); border-left: 3px solid var(--fail); padding: 1rem; border-radius: 4px; }
details > summary { cursor: pointer; }
a { color: var(--accent); }
header:first-child { padding-bottom: 1rem; border-bottom: 1px solid var(--border); margin-bottom: 0.5rem; }
`;
}
