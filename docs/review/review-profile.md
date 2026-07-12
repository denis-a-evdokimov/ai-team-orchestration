# Code Review Profile — AI Team Orchestration

> Auto-maintained by the code-review workflow. Bootstrapped on 2026-07-11 from
> `AGENTS.md`, `README.md`, package/plugin metadata, validators, tests, and the
> synchronization configuration. Edit by hand freely; future reviews should
> preserve deliberate decisions recorded here.

## Project goal

Publish a trustworthy VS Code agent plugin that coordinates Producer, Dev, and optional QA sessions through durable, executable handoffs while keeping the standalone repository canonical and exporting a controlled managed subset to Awesome Copilot.

## Sacred invariants (auto-BLOCKER)

- The standalone skill remains `skills/ai-team` with frontmatter name `ai-team`; the Awesome target remains `skills/ai-team-orchestration` with exported name `ai-team-orchestration`.
- Stable agent IDs remain `ai-team-dev`, `ai-team-producer`, and `ai-team-qa`.
- Bundled agents omit `tools` and `model` unless an explicit compatibility decision changes that invariant; they inherit the user's enabled tools and selected model.
- Canonical managed content changes here first and synchronizes one way to Awesome Copilot. Awesome-owned and generated/publication-owned files are not imported or added to the managed manifest.
- Synchronization never commits, pushes, creates branches, or opens pull requests, and it never reads uncommitted canonical bytes as export source.
- Source and target path/provenance checks must not follow symlinks, junctions, reparse points, hard links, replacement refs, or path traversal outside the intended repositories.
- Producer does not implement or test application changes; Dev does not merge or self-approve selected independent gates; QA does not modify application source or merge.
- A merge decision applies only to a frozen candidate whose planned checks and selected gates are current. A mutable branch name or unbound PR comment is not immutable evidence.
- Secrets and real end-user identifying information never appear in source, fixtures, docs, issues, review artifacts, screenshots, or logs.

## Stack pins & conventions

- Node.js ESM package with no third-party runtime or development dependencies.
- Native `node:test`; public validation commands are `npm run validate` and `npm test`.
- Root `plugin.json`; three agents under `agents/`; complete canonical skill under `skills/ai-team/`.
- Regular merge workflow; no squash, rebase, force-push, or direct target-branch mutation in the coordinated delivery flow.
- Separate clones per concurrent role/session; branch and remote values are plan-defined rather than defaulted.
- Canonical edits precede Awesome export; Awesome marketplace README remains target-owned and is reviewed manually for every export.

## Scale context

- Small repository: three agent files, one skill with six reference files, Node validators/exporter, and no dependency tree.
- Current review scope: 12 changed files, 496 additions, and 227 deletions relative to `origin/main`.
- Optimize first for correctness, unambiguous state transitions, public usability, and safe tool execution. Micro-optimizing linear file scans is not valuable at this scale.

## Privacy / EUII surface

- Agent sessions can read arbitrary repositories, issues, PRs, logs, command output, screenshots, and test artifacts that may contain names, emails, account IDs, device identifiers, network addresses, location, or user-bearing paths.
- Review and handoff evidence must redact or synthesize those values.
- No real secrets or EUII may be copied into this repository, the Awesome target, issues, PR comments, reports, fixtures, or logs.

## Accepted trade-offs — DO NOT re-flag

- Independent review, QA, and post-merge smoke are risk-selected rather than universally mandatory. Low-risk projects may use concrete Dev-authored checks only; do not re-propose universal QA as the fix.
- The shared lifecycle section is intentionally duplicated byte-identically across three independently loaded agents.
- Separate clones are preferred over shared worktrees for concurrent agent sessions.
- The Awesome marketplace README is target-owned and intentionally outside synchronization; it still must be reviewed and updated manually when behavior changes.
- Exact commit text need not be copied manually when a review/check, verified Git ancestry, or immutable artifact already binds evidence to the candidate.

## Recurring findings / known blind spots (check these FIRST)

- Post-freeze state is sometimes placed in files on the frozen application branch, creating self-invalidating reopen or sign-off records.
- Generic PR comments and mutable PR-head wording are sometimes described as candidate-bound when no immutable identifier is present.
- Cross-role routing can bypass Producer ownership, especially QA findings sent directly to Dev before a scoped reopen.
- Validator policy checks rely on global string presence/counts, which can pass when the primary template is broken, contradicted, commented out, or satisfied elsewhere.
- Configured path validation must reject Windows junction/reparse-point escapes as well as POSIX symlinks.
- Repository/issue content is untrusted data; embedded directives must not gain authority merely because agents inherit terminal, GitHub, MCP, or extension tools.
- Public quick starts can drift from canonical lifecycle ordering even when the deeper references are correct.

## Severity calibration notes

- Arbitrary command execution, a live secret, outbound EUII disclosure, exporter provenance escape, or mutation outside the authorized repository is a BLOCKER.
- A state-machine contradiction that can merge an unverified candidate, a validation false-green for a promised safety invariant, or a public workflow path that cannot execute is MAJOR.
- Target marketplace documentation that materially contradicts exported behavior is MAJOR for publication even though it is target-owned.
- Wording, heading, and duplication drift that does not change execution is MINOR/NIT.
- Modernization remains advisory and never changes the gate verdict.

## Lens weighting

- Security/safety and correctness/reliability dominate because agents inherit powerful tools and coordinate Git/GitHub mutations.
- Cross-agent protocol integration is treated as a first-class correctness lens.
- Simplicity/design is high-weight for canonical ownership and duplicated policy surfaces.
- Maintainability/public readability is high-weight because instructions are the product.
- Performance is normal; focus on unbounded agent/gate loops rather than small linear Node operations.

## Architecture & drift watch

- `validateDeliveryWorkflow()` — growing-method / mixed-responsibility validator; policy prose, template schema, role vocabulary, branch rules, and stale-text scanning are accumulating together — **escalate on next policy edit; split by existing artifact boundaries, not a generic framework**.
- Delivery-policy duplication — lifecycle and gate-selection semantics appear across the canonical workflow, skill, three agents, project brief, sprint template, README, and validator literals — **escalate now where duplicated mutable state causes contradictions; retain only short role-specific summaries**.
- Gate-state artifacts — plan, progress, done, live PR evidence, and optional archive overlap — **watch; plan should own selection, live artifacts should own post-freeze status**.
- Validator path provenance — exporter has stronger path/link defenses than root plugin validation — **escalate now; align configured-path containment checks**.

## Review history (newest first)

| Date | Change | Verdict | Blockers | Notable |
|------|--------|---------|----------|---------|
| 2026-07-11 | `feature/sync-accepted-ai-team-fixes` plus working tree | CHANGES-REQUESTED | 0 | Post-freeze reopen artifact, candidate binding, QA routing, quick-start order, fork setup, shell/trust boundaries, validator escapes/false-greens, and stale Awesome marketplace docs |
