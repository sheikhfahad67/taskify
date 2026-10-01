# Plan doc templates

Skeletons for the numbered `NN-*.md` plan docs. Emit only the ones the task earns — see Sizing in
`SKILL.md`.

**Contents:** shared conventions · 00-overview · 01-target · 02-mapping · 03-changes ·
04-execution-phases · 05-risks

## Shared conventions

These hold for every plan doc:

- **No frontmatter.** Exactly one `#` H1 on line 1, then a 2–5 line orientation paragraph, then `##`
  sections. Frontmatter belongs to specs, not plans.
- **Headings are assertions or nouns, not generic labels.** `## Entity extraction is the highest-risk
  single phase in this plan`, not `## Risks`. Someone scanning only the headings should come away
  with the findings.
- **Bold inline callouts instead of admonition blocks.** `**This document set is planning only.**`,
  `**Mitigation:**`, `**Verify:**`.
- **Cross-doc links are relative, with the filename in backticks**, plus a section pointer in prose:
  `` [`04-execution-phases.md`](./04-execution-phases.md) `` and then `` (`03` §3a) `` inline.
- **`###` only where a section genuinely has sub-cases.** Most docs never need it; a config doc does.
- **Numbered sections take letter suffixes for later insertions** (`## 3a.`, `## 4a.`) rather than
  renumbering everything downstream.

## 00-overview.md — always

```markdown
# <Task Name> — Overview

## Goal

<2–4 sentences: the outcome, and the single invariant it must hold. If this plan derives from an
external blueprint or an earlier design doc, link it and say the relationship — "this is the
concrete, repo-specific plan derived from that blueprint, not a restatement of it".>

**This document set is planning only.** <State what does and does not happen as part of landing
these docs, and which doc the execution runs against.>

## <Findings from the grounding pass>

<If reading the real code contradicted the first draft of the plan, record it. Each row is a design
decision worth being able to trace, not a typo fix. IDs are B1..Bn and get referenced downstream as
"resolves B1".>

| # | Defect | Resolution |
|---|---|---|
| B1 | <what the first draft assumed, and why it is wrong — cite the file that proves it> | <the decision taken, and which doc section carries it> |

## <The central decision, stated as an assertion>

<The main design choice, argued. Name what was considered and rejected, and why. Use a heading that
states the conclusion.>

## <How existing conventions carry over>

<Conventions already in place that this task preserves rather than replaces — numbered, each with
the reason it survives. This is where you prevent an implementer from "helpfully" modernising
something.>

## Document index

| File | Contents |
|---|---|
| [`01-target-architecture.md`](./01-target-architecture.md) | <what it holds> |
```

## 01-target-*.md — when structure changes

```markdown
# Target <Structure Name>

<One paragraph orienting the reader: what this tree/shape is, and what it is not.>

​```
<ASCII tree, one line per entry, with trailing # comments explaining any non-obvious entry>
​```

## Not moved / not included

<Things deliberately left where they are, each with the reason. A reader will assume anything absent
was an oversight unless you say otherwise.>
```

## 02-*-mapping.md — when files or symbols move

A pure table doc. Often no `##` sections at all.

```markdown
# <Task Name> Mapping

<One paragraph: what the table covers, and the rule for reading it.>

| Old path | New path | Notes |
|---|---|---|
| `<old>` | `<new>` | <renames, splits, anything not a straight move> |

<Then any open questions about specific files, called out explicitly rather than left blank.>
```

## 03-*-changes.md — when config, build, or deps change

The copy-paste source of truth. Sections are **numbered**, and this is the one doc where `###`
sub-sections carry real weight — each one usually justifies a decision the section above implies.

```markdown
# <Tooling / Build> Changes

<One paragraph: this doc holds literal file contents; the specs reference it rather than restating
it.>

## 0. `<file>`

​```<lang>
<the literal content, copy-pasteable>
​```

### <A decision this file embodies, stated as an assertion>

<Why it is this way and not the obvious alternative. Cite the blocker ID if it resolves one.>

## 1. `<next file>`
```

## 04-execution-phases.md — when there is more than one task

The doc the specs are derived from. One `##` per phase, each closing with a bold **Verify:**.

```markdown
# Execution Phases

An ordered, incremental rollout — no big-bang single change. Each phase is independently
<mergeable/verifiable> and ends <green/in a known-good state>, and has an explicit verification
command.

<If a phase deliberately combines or splits what an earlier draft did differently, explain it here —
the reader will otherwise try to re-split it.>

## Phase 0 — <name>

<What happens, naming real files and real commands. Where content is specified in `03`, reference
the section rather than restating it.>

**Verify:** <exact commands, and what the observable is. The valuable check is usually a comparison
against something measured before the change — say what the left-hand side is and where it lives.>

## Phase 1 — <name (and, in parentheses, why it is ordered here — "lowest risk, already isolated")>
```

## 05-risks-and-*.md — when the gate found risks or open decisions

One `##` per risk, each headed by the risk **as a claim**, body = the evidence, then
`**Mitigation:**`.

```markdown
# Risks & Open Decisions

<One paragraph: what this doc is for, and the standing rule — a risk here that later turns out to be
wrong gets corrected in place, not deleted.>

## <The risk, stated as a claim — e.g. "Entity extraction is the highest-risk single phase in this plan">

<The evidence: what specifically could break, and the file or measurement that shows the exposure.>

**Mitigation:** <the concrete thing that reduces it, and which phase or task owns it.>

## <Open decision, stated as the question it settles>

<The options, and what the decision hinges on. If it is genuinely unsettled, say who decides and
when — an open question named as open is fine here; a `TBD` anywhere else is not.>
```
