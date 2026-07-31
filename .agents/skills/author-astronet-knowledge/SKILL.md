---
name: author-astronet-knowledge
description: Create, expand, correct, rename, merge, delete, or reconcile canonical Astronet worldbuilding knowledge in repository XML and assets. Use when a task needs knowledge organization, gap questions, confirmed gap filling, entity resolution, links to existing knowledge, semantic contradiction detection, or coordinated multi-agent content authoring under plan-docs/03-content-authoring.md.
---

# Author Astronet Knowledge

Treat this as a development-time authoring workflow. Keep the deployed Astro application read-only and write canonical knowledge only through repository XML and assets.

## Establish authority

1. Read `AGENTS.md`, `plan-docs/03-content-authoring.md`, and `content/README.md` completely.
2. Read `content/astronet.xsd`, the relevant examples, and the parser or compiler code when syntax or validation behavior is material.
3. Read [references/handoff-contracts.md](references/handoff-contracts.md) before delegating.
4. Inspect `git status --short` and preserve unrelated user changes.
5. Treat XML under `content/documents/**` and `content/boards/**` plus explicit user decisions as canon inputs. Treat `content/examples/**`, generated artifacts, weak graph edges, related-document rankings, hidden tags, agent consensus, and external web material as non-canonical evidence.

Do not add draft state, claim status, summaries, categories, or type-specific metadata to canonical XML. Keep the working claim ledger in the conversation or disposable scratch context only.

## Route the task

Classify the requested operation as `create`, `update`, `rename`, `merge`, or `delete` before editing.

- Handle a mechanical typo or formatting-only change locally without spawning agents.
- For factual creation or expansion, use `knowledge-mapper` and `canon-gap-analyst`.
- For identity, reference, rename, merge, or deletion work, also use `knowledge-integrator`.
- For any change that can alter facts, chronology, identity, terminology, or relationships, use `consistency-auditor` before finalizing.
- Use `web-researcher` only when the user requests external research or when real-world, time-sensitive facts are explicitly in scope. External findings remain proposals until the user adopts them as canon.

Prefer read-heavy delegation. Keep every analysis agent read-only and give it a bounded topic, raw input, relevant paths, and the required handoff shape. Do not make one agent's conclusion the hidden premise of another agent's independent check.

If a named agent is unavailable or concurrency is exhausted, execute its handoff contract sequentially in the primary context. Do not skip the evidence, question, or approval gate merely because parallelism is unavailable.

## Build the evidence dossier

1. Ask `knowledge-mapper` to find candidate documents, aliases, sections, references, manual connections, board memberships, backreferences, and atomic claims. Require file and line evidence.
2. Ask `canon-gap-analyst` to identify missing decisions across definition, identity, chronology, causality, relationships, scope, exceptions, and reader comprehension.
3. Run both in parallel only when each can inspect the raw input independently without duplicating an unbounded corpus scan. Otherwise run the mapper first and pass its cited dossier—not its unsupported conclusions—to the gap analyst.
4. Consolidate their results into this ephemeral state set:
   - `existing`: directly supported by current canonical XML.
   - `confirmed`: explicitly supplied or approved by the user for this change.
   - `proposed`: an agent suggestion or external finding awaiting approval.
   - `unknown`: required information that is absent.
   - `conflicted`: two canon candidates cannot yet be reconciled.
   - `rejected`: explicitly declined or disproven for this change.

Only `existing` and `confirmed` claims may become assertive canonical prose.

## Resolve gaps with the user

Auto-fill only mechanical gaps that cannot create canon: XML structure, NFC normalization, section ordering, visible reference labels, necessary stable section IDs, and prose transitions that add no factual assertion.

For factual or identity gaps:

1. Rank questions by downstream impact and dependency.
2. Ask the highest-impact branching question first. Batch at most three questions only when they are independent.
3. Explain why the answer matters and give a recommended option when a defensible one exists.
4. Preserve unanswered items as `unknown`; do not quietly turn recommendations into facts.
5. If the user explicitly authorizes creative filling, present the proposed canon delta and obtain approval before writing it.

Do not ask the user for information discoverable from the repository.

## Plan compatibility and links

After material questions are resolved, ask `knowledge-integrator` for an identity and impact plan. Require it to:

- Choose among keeping an existing document, creating a document, renaming, merging, or deleting.
- Preserve published immutable IDs and compute every affected source path.
- Distinguish natural body references from intentional manual connections and board grouping.
- Identify all inbound and outbound references, connections, board entries, stable-section targets, and media relationships affected by the change.
- Use titles and aliases only for discovery; use immutable IDs for authored targets.
- Avoid treating lexical similarity, tags, or graph proximity as factual relationships.

When creating a document or board, run:

```bash
node .agents/skills/author-astronet-knowledge/scripts/new-content-id.mjs document
node .agents/skills/author-astronet-knowledge/scripts/new-content-id.mjs board
```

Use the returned ID and hash-sharded path. The helper prints data only and must not write source files.

## Detect and adjudicate contradictions

Ask `consistency-auditor` to compare the proposed delta with both the relevant canonical neighborhood and its backreferences. Require both sides of every finding with exact evidence.

Resolve findings as follows:

- Fix deterministic schema, reference, ID, NFC, or path violations directly.
- Add time, place, scope, measurement, or viewpoint qualifiers when apparently different statements can coexist.
- Preserve deliberate ambiguity, unreliable narration, and historical supersession when the prose intends them.
- Apply an explicit user correction when the target and replacement are unambiguous.
- Ask the user before changing unresolved canon, merging ambiguous identities, deleting knowledge, or choosing between equally supported claims.
- Never use agent majority or confidence language as a truth rule.

Record the adjudication in the working summary as `accept`, `reject`, `unresolved`, or `needs-user`. Do not persist this workflow metadata in XML.

## Apply the canonical change

Use one writer for an integrated change set. The primary agent is the curator and writer by default; a single worker may write only when given exact, non-overlapping file ownership and the frozen decisions. Analysis agents remain read-only.

Follow the operation-specific rules in `plan-docs/03-content-authoring.md`:

- Create one article per correctly sharded XML file.
- Update only the facts and prose in scope.
- Rename by changing the title while retaining the document ID; add an alias only when useful for discovery.
- Merge into the surviving ID and update all references before removing the retired source.
- Delete only after removing or replacing every inbound reference, connection, board entry, and media relationship.

Use `apply_patch` for source edits. Never run a source-rewriting migration, edit generated output, or rewrite unrelated XML.

## Verify and review

1. Inspect `git diff --check` and the complete scoped diff.
2. Run `consistency-auditor` again on substantial or cross-document diffs. Give it the diff and source evidence, not the intended answer.
3. Apply only confirmed findings and re-run the audit when a correction changes canon materially.
4. Run `npm run build` as the required integrity gate. Diagnose failures from their source path and root cause.
5. Review the rendered article, table of contents, footnotes, boards, media, search result, related documents, and focused graph entry when applicable.
6. Remove disposable analysis files or temporary checks. Do not add a permanent test harness or commit unless the user asks.

Finish with the operation performed, decisions applied, files changed, links or contradictions resolved, unresolved questions, and build result.
