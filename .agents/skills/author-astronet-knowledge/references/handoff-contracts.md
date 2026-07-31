# Knowledge Authoring Handoff Contracts

Use these contracts for subagent prompts and returns. Keep reports in the agent handoff; do not commit them as canonical content.

## Shared rules

- Cite repository facts from `content/documents/**` or `content/boards/**` with document ID, source path, and the narrowest useful line or section.
- Treat `content/examples/**` as non-canonical syntax examples.
- Separate direct evidence from interpretation.
- Use external sources only as proposals until the user adopts them as canon.
- Do not equate multiple-agent agreement, model confidence, graph proximity, shared tags, or lexical similarity with truth.
- Do not modify XML, assets, plans, configuration, or generated files.
- Return `none found` for an empty category instead of inventing coverage.

Represent an atomic working claim with:

```text
claim_key: local report identifier
statement: one independently assessable assertion
subject / predicate / object: normalized comparison form
qualifiers: time, place, scope, measurement, or viewpoint
status: existing | confirmed | proposed | unknown | conflicted | rejected
evidence: source path + document ID + line/section + supports/opposes
```

The normalized fields are analysis aids. They are not a new Astronet schema.

## `knowledge-mapper`

Return:

1. Scope and search terms used.
2. Candidate entities and documents, including exact title/alias matches and ambiguity.
3. Atomic existing claims with evidence.
4. Outbound references, manual connections, board memberships, and stable-section targets.
5. Inbound references, connections, and board entries to each candidate.
6. Coverage gaps and disconnected concepts without proposing canon.
7. Files inspected and explicit search limits.

Rank candidates for review, but do not choose an identity when more than one plausible document exists.

## `canon-gap-analyst`

Return:

1. Confirmed inputs copied from the user request.
2. Existing facts verified from source XML.
3. Proposed facts clearly separated from both.
4. Questions ordered by downstream impact.
5. For each question: affected claims/documents, why it blocks or improves the article, mutually exclusive options when useful, and one recommendation with rationale.
6. Mechanical gaps safe to fill without asking.
7. Dependencies between questions.

Do not ask the user directly. The primary agent owns the conversation and decision ledger.

## `knowledge-integrator`

Return:

1. Identity decision: `keep`, `create`, `rename`, `merge`, `delete`, or `needs-user`.
2. Evidence for the decision and competing identity candidates.
3. Surviving immutable IDs and exact affected source files.
4. Proposed body references with target IDs and visible wording.
5. Proposed manual connections only when the relationship does not belong naturally in prose.
6. Board changes only when reusable navigation or intentional group affinity warrants them.
7. Complete inbound-reference and media impact for rename, merge, or deletion.
8. Ordered, single-writer change plan.

Never use title, alias, slug, tag, weak edge, or generated URL as an authored relationship target.

## `consistency-auditor`

Return findings ordered by severity:

```text
severity: blocking | material | advisory
type: structural | identity | chronology | cardinality | terminology | relationship | scope | provenance
new_claim: proposed statement and evidence
existing_claim: current statement and evidence
compatibility: contradiction | compatible-with-qualifier | intentional-ambiguity | insufficient-evidence
impact: affected documents, references, and reader behavior
resolution: smallest evidence-preserving correction or needs-user
```

Inspect these contradiction classes:

- The same canonical subject and predicate have mutually exclusive values in overlapping time and scope.
- One name appears to identify multiple entities, or multiple documents appear to identify one entity.
- Dates, durations, ages, ordering, or causal sequences cannot coexist.
- Counts, membership, ownership, location, status, or relationship direction conflict.
- A renamed, merged, or deleted document leaves stale references, aliases, boards, or media relationships.
- Terms drift in a way that changes identity or meaning rather than merely varying prose.
- A statement is presented as universal while existing canon limits it by time, place, faction, narrator, or measurement.

Do not report a contradiction merely because wording differs. Prefer qualification over deletion for historical change, scoped truth, or viewpoint-dependent accounts. Leave unsupported resolutions as `needs-user`.

## Curator adjudication

The primary agent compares reports against source evidence and assigns one disposition:

- `accept`: evidence and user authority support the change.
- `reject`: evidence or an explicit decision rules it out.
- `unresolved`: information is insufficient but the change can proceed without asserting it.
- `needs-user`: the decision changes canon, identity, or destructive scope and blocks a safe edit.

Only accepted `existing` or `confirmed` claims may be written as canonical assertions.
