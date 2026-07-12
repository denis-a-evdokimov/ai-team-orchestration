# Code Review — `feature/sync-accepted-ai-team-fixes`

**Date:** 2026-07-11
**Verdict:** **CHANGES-REQUESTED — not ready for public publication**
**Reviewed baseline:** `origin/main` at `54b6837aa16aa9476238e3b7414a01fe3d33f58b`
**Branch HEAD:** `21a1843924df3787d26054ef03f2373ee29327b3`
**Merge base:** `065ac2925242b0b24d6e6846bb4c5ea8926becd8`
**Scope:** two branch commits plus all then-current tracked working-tree changes; 12 files, +496/-227; no untracked files at review start
**Important:** this report and the bootstrapped review profile were created after review and are not part of the reviewed candidate.

## Executive Summary

The redesign has the right strategic direction: QA and independent review are proportionate rather than ceremonial, the candidate freezes at handoff, the Producer/CEO own the merge decision, and immutable evidence need not mean manually copying hashes everywhere. Role boundaries and the shared lifecycle are substantially aligned.

The publication candidate is nevertheless unsafe to release. The blocked-fix path stores its authorization inside the frozen branch, generic PR comments can be mistaken for candidate-bound acceptance, QA can bypass the Producer-controlled reopen, and the public quick start selects gates after implementation. The documented fork setup is incomplete. More seriously, repository-controlled plan values are interpolated into shell commands without a trust boundary, configured plugin paths can escape through a Windows junction while validation passes, and the validator can report green when the primary branch contract is broken.

No live secret or real EUII was found. There is no merge conflict with current `origin/main`, and both full test modes pass. Those strengths do not offset the protocol and validation findings below.

## Review Method

Eight independent read-only reviews covered:

1. Security & Safety
2. Correctness & Reliability
3. Performance & Resources
4. Simplicity, Design & Architecture
5. Maintainability & Readability
6. Modernization & Tech Debt (advisory)
7. Cross-agent protocol integration
8. Publication and Awesome Copilot synchronization

Findings were de-duplicated and independently reproduced where practical.

## Gate Findings

### 1. [MAJOR] The branch-reopen record cannot be written without moving the frozen candidate

**Evidence:** [sprint plan reopen log](../../skills/ai-team/references/sprint-plan-template.md#L34-L40), [canonical freeze/reopen rules](../../skills/ai-team/references/delivery-workflow.md#L32-L35), [Producer reopen responsibility](../../agents/ai-team-producer.agent.md#L37-L40)

The plan says the Producer must add a `Branch Reopen Log` entry before Dev pushes. At that moment the application branch is frozen. Committing the Producer's entry to that branch creates another candidate before Dev's fix, invalidates current verdicts, and diverges from Dev's clone. Keeping it local does not create an executable or durable authorization.

**Failed paths:** QA blocked → scoped fix; independent review blocked → scoped fix; carry-forward of an unaffected verdict.

**Required fix:** Keep only the reopen mechanism in the pre-freeze plan. Post a live **Branch Reopen Packet** outside the application branch—prefer a PR artifact; use a coordination/evidence branch only when a repository file is required. Include prior candidate, blocking evidence, permitted scope, affected checks/gates, carry-forward verdict references and confirmer, required new evidence, and next owner. Dev acts only after receiving that packet.

### 2. [MAJOR] Generic PR comments/descriptions are treated as candidate-bound evidence

**Evidence:** [candidate evidence guidance](../../skills/ai-team/references/delivery-workflow.md#L41-L54), [project handoff evidence](../../skills/ai-team/references/project-brief-template.md#L125-L126), [QA responsibility](../../agents/ai-team-qa.agent.md#L16-L20), [QA sign-off process](../../agents/ai-team-qa.agent.md#L56-L64), [QA template](../../skills/ai-team/references/sprint-plan-template.md#L227-L237)

GitHub reviews and checks can be associated with a commit. A generic PR issue comment or description remains attached to the PR after its head moves. `Ready for merge` posted without an immutable commit/artifact identity can therefore appear to approve newer code.

**Failed path:** QA passes candidate A; an unexpected push creates candidate B; the old PASS comment remains visible.

**Required fix:** Define evidence classes precisely:

- commit-bound review/check: platform association is sufficient;
- generic PR comment/description: must contain an explicit immutable commit or artifact identifier captured when posted;
- evidence report commit: require verified parent/ancestry binding to the tested candidate;
- branch name or bare PR URL: never sufficient.

Require the Producer to compare the stable evidence identity with the current application head before merge.

### 3. [MAJOR] QA can bypass the Producer-controlled reopen

**Evidence:** [QA boundary](../../agents/ai-team-qa.agent.md#L27-L35), [QA sign-off step 4](../../agents/ai-team-qa.agent.md#L60-L64), [canonical ownership return](../../skills/ai-team/references/delivery-workflow.md#L32-L35)

The canonical workflow returns ownership to the Producer after a block. QA instead says twice to return findings directly to Dev, while its next step also reports to the Producer. This creates competing edges and can start implementation before permitted scope and affected gates are recorded.

**Required fix:** QA posts `Blocked`, issues, and evidence to the Producer only. The Producer decides severity/scope and sends the Branch Reopen Packet to Dev. Dev continues to reject direct, unauthorized fix requests.

### 4. [MAJOR] The public Quick Start selects gates after Dev implements and freezes

**Evidence:** [README execution step](../../README.md#L67-L73), [later gate-selection step](../../README.md#L75-L83), [canonical selection timing](../../skills/ai-team/references/delivery-workflow.md#L7-L13)

The README orders plan → execute/freeze → select gates. Canonical policy requires the gate set before implementation handoff; a post-implementation change is a separately recorded risk decision.

**Required fix:** Fold gate selection into “Plan a sprint” or insert it before Execute. Keep the later steps only for running already-selected gates.

### 5. [MAJOR] The advertised fresh-clone fork workflow does not configure both remotes

**Evidence:** [plan remote fields](../../skills/ai-team/references/sprint-plan-template.md#L6-L19), [Dev preflight](../../skills/ai-team/references/sprint-plan-template.md#L85-L98), [multi-repo setup](../../skills/ai-team/references/project-brief-template.md#L142-L174)

The design supports different base and push remotes, but the plan records only remote names and the setup clones one repository without adding or validating the second remote. A normal fork clone has `origin` but not `upstream`; `git fetch --prune upstream` is not executable from the documented fresh setup.

**Required fix:** Record expected base and push remote URLs. Preflight each remote with `git remote get-url`, add a missing remote only from the recorded URL after capability/authorization checks, and stop on URL mismatch. Do this before fetch or push.

### 6. [MAJOR] Repository-controlled plan values are interpolated into shell commands without validation

**Evidence:** [copy-paste Dev commands](../../skills/ai-team/references/sprint-plan-template.md#L85-L98), [Dev preflight contract](../../agents/ai-team-dev.agent.md#L21-L29)

Remote/ref/branch fields are repository content. They are inserted into shell command text. Git accepts shell metacharacters such as `;` in a ref name; an isolated check confirmed such a ref is syntactically valid. A malicious plan can therefore turn a documented Git command into additional PowerShell/shell commands under the agent's authenticated session.

**Required fix:** Treat all plan values as untrusted data. Prefer process APIs that pass arguments separately. Where command strings are unavoidable, validate against a deliberately shell-safe grammar, reject whitespace/control characters/metacharacters and leading-option forms, verify refs/remotes through Git, use option terminators where supported, and quote with the active shell's rules. Add adversarial tests/examples.

### 7. [MAJOR] Configured plugin paths can escape the repository through a junction

**Evidence:** [plugin path validation](../../eng/validate.mjs#L228-L240)

Validation uses lexical containment and `statSync()`, which follows links. An isolated reproduction pointed `plugin.json`'s `agents` field at a repository-contained Windows junction targeting an external directory; validation returned success.

This permits a source installation to load agent content that is not tracked or reviewed as part of the candidate.

**Required fix:** For `skills` and `agents`, reject symlinks/junctions/reparse points on the configured path and every existing component, resolve real paths, and verify real containment under the real repository root. Add agent-root and skill-root escape tests. Reuse the exporter's proven path-safety concepts without introducing a broad abstraction unless two concrete call sites truly share it.

### 8. [MAJOR] Validator checks can produce false-green lifecycle results

**Evidence:** [global contract search](../../eng/validate.mjs#L489-L500), [project brief global counts/includes](../../eng/validate.mjs#L550-L585), [sprint template global counts/includes](../../eng/validate.mjs#L590-L654)

The validator searches whole files for phrases and counts placeholders globally rather than validating the relevant unique section/table/field. An isolated reproduction replaced the primary sprint header's `<base-ref>` with hardcoded `upstream/release`; placeholders elsewhere satisfied the count and validation returned success.

The same design can accept retained-but-contradicted policy text, examples/comments, misplaced rows, or non-executing command wrappers.

**Required fix:** Parse bounded headings, fenced templates, metadata fields, and Markdown tables. Require exactly one primary field/row with allowed values and validate executable command lines in their expected prompt. Strip HTML comments/examples where they are not normative. Add adversarial tests for wrong-section duplicates, contradictions, commented-out contracts, hardcoded non-default values, and command wrappers.

### 9. [MAJOR] Powerful inherited tools have no shared prompt-injection trust boundary

**Evidence:** [tool inheritance](../../README.md#L125-L137), [Dev reads repo/issues](../../agents/ai-team-dev.agent.md#L21-L24), [Producer reads repo/issues](../../agents/ai-team-producer.agent.md#L30-L34)

Agents inherit terminal, GitHub, MCP, and extension tools and are instructed to read repository files, issues, PRs, logs, and evidence. Capability detection only answers whether an action can be performed; it does not establish that embedded text has authority to request it.

**Required fix:** Add a shared trust rule: repository/issue/PR bodies, logs, artifacts, fetched pages, and command output are untrusted data. Embedded directives cannot override user, role, repository, or gate policy. Validate proposed actions against the plan and require explicit user confirmation for destructive, privileged, credential-bearing, external, or gate-reducing mutations.

### 10. [MAJOR] Risk-based gates permit an empty evidence set for code/config changes

**Evidence:** [optional-gate policy](../../skills/ai-team/references/delivery-workflow.md#L7-L13), [plan gate table](../../skills/ai-team/references/sprint-plan-template.md#L21-L32), [Producer planning](../../agents/ai-team-producer.agent.md#L30-L34)

Optional QA/review is intentional and should remain. The current contract does not require the Dev-check list to contain any concrete executable check or define high-risk surfaces that need explicit risk acceptance.

**Required fix:** Preserve optional QA/review but require at least one concrete check for every code/config candidate. Define high-risk triggers (authentication/authorization, secrets/EUII, destructive data changes, privilege/deployment changes, safety invariants) and require an applicable security-focused gate or explicit CEO/maintainer risk acceptance to skip it. Only the CEO/maintainer should reduce the project baseline; unresolved blocker/major findings always block merge.

### 11. [MAJOR — publication] Awesome marketplace documentation still describes the superseded mandatory workflow

**Evidence:** canonical [README workflow](../../README.md#L75-L108) and the target-owned marketplace adapter currently on the Awesome feature branch.

The target adapter still states mandatory independent review, QA, exact-head SHA packets, smoke, and a closeout PR. This materially contradicts the new optional-gate/frozen-candidate model.

**Required fix:** After canonical fixes are committed and exported, update the Awesome-owned `plugins/ai-team-orchestration/README.md` in the Awesome PR. Keep it outside the synchronization manifest. Cover pre-implementation gate selection, optional review/QA/smoke, frozen candidate, safe evidence mechanisms, scoped reopen, and optional archival.

## Minor Findings

### 12. [MINOR] The committed Done template requests candidate data that only exists after its commit

**Evidence:** [Done timing and candidate field](../../skills/ai-team/references/sprint-plan-template.md#L162-L176), [embedded packet](../../skills/ai-team/references/sprint-plan-template.md#L203-L219)

The file is committed before candidate push/freeze but asks for the later candidate association. This recreates pressure to insert stale identity or modify the frozen branch.

**Fix:** Define it strictly as the pre-freeze implementation handoff. Use `not yet handed off; record in the live PR packet after push`, or remove the candidate row and live packet from the committed template.

### 13. [MINOR] Gate selection/status is duplicated across too many artifacts

**Evidence:** [authoritative plan table](../../skills/ai-team/references/sprint-plan-template.md#L21-L32), [progress table](../../skills/ai-team/references/sprint-plan-template.md#L141-L153), [Done table and packet](../../skills/ai-team/references/sprint-plan-template.md#L195-L219)

The plan, progress, Done file, and live packet can disagree about `required` versus `not required`. Post-freeze files cannot safely carry live status anyway.

**Fix:** Make the plan the sole selection authority, keep a concise recovery summary in progress, remove the Done gate table, and let live artifacts own post-freeze state.

### 14. [MINOR] Authoritative status update and optional archive are conflated

**Evidence:** [conditional lifecycle row](../../skills/ai-team/references/delivery-workflow.md#L18-L28), [required Producer update](../../agents/ai-team-producer.agent.md#L41-L45), [project current-state rule](../../skills/ai-team/references/project-brief-template.md#L78-L80)

Updating authoritative Sections 7–8 is required, while a separate archive PR is optional.

**Fix:** Split the lifecycle into an always-required authoritative status update and an optional archive PR.

### 15. [MINOR] Validator policy is brittle duplicated prose

**Evidence:** [duplicated policy literals](../../eng/validate.mjs#L25-L40), [exact row/prose checks](../../eng/validate.mjs#L576-L654)

Editorial text has become an executable API while still failing to validate structure. This increases synchronized-edit cost without guaranteeing behavior.

**Fix:** Validate normalized structural fields and stable contract IDs. Retain only narrowly scoped forbidden-pattern checks. Avoid a speculative general parser.

### 16. [MINOR] The `model`-omission invariant is not enforced

**Evidence:** [agent frontmatter validation](../../eng/validate.mjs#L260-L307), [tools-only regression test](../../eng/validate.test.mjs#L176-L190), [repository invariant](../../AGENTS.md#L8-L13)

Current agents correctly omit both fields, but only `tools` behavior is tested. A model pin could be exported with green validation.

**Fix:** Reject `model` for the three stable canonical agents and add a regression test. Keep the invariant and test coupled if policy later changes.

### 17. [MINOR] Reopen cycles have no convergence budget

**Evidence:** [rerun loop](../../skills/ai-team/references/delivery-workflow.md#L32-L35), [Producer loop](../../agents/ai-team-producer.agent.md#L37-L40)

Repeated blocks can consume unbounded agent, CI, and test resources.

**Fix:** Let the plan set a reopen budget. Escalate repeated identical findings or budget exhaustion to the CEO/maintainer for replanning; review only the permitted delta and regression surface unless scope expands.

### 18. [MINOR] Skill and README diagrams retain stale branch assumptions

**Evidence:** [skill diagram](../../skills/ai-team/SKILL.md#L31-L51), [README clone statement](../../README.md#L112-L120), [parameterized plan](../../skills/ai-team/references/sprint-plan-template.md#L6-L19)

The skill still shows `feature/sprint-N` and `PR head / preview`; README says every team has a feature branch. QA may only check out the frozen candidate and need an evidence branch only when committing evidence.

**Fix:** Use `<working-branch>` and `frozen candidate / immutable preview`; describe separate clones for concurrent sessions and branch requirements per role.

### 19. [NIT] Checks/gates heading vocabulary is unnecessarily fragmented

The public templates use “Delivery & Review Gates,” “Delivery Checks and Gates,” “Delivery Check & Gate Status,” “Selected Gates,” and “Gate Status & Evidence.” The contexts differ, but the variation makes cross-chat references harder.

**Fix:** Standardize on a small family, for example `Delivery Checks & Gates`, `Delivery Checks & Gate Status`, and `QA Gate Evidence`. Use full canonical role/perspective titles in the project brief.

## Advisory Modernization (Never Blocks)

- Re-evaluate the Node.js 20 minimum before publication because it is no longer a supported production baseline by the current review date. Prefer a supported LTS floor and test it explicitly.
- Re-check local plugin metadata length limits against current VS Code/Awesome schemas; current values are valid, so this is schema-drift prevention rather than a release defect.
- Keep plugin version `2.0.0` if these fixes remain part of the still-unreleased v2 Awesome PR. Bump only if v2 is published before this candidate lands.

## Cross-Agent Execution Matrix

| Trace | Result | Reason |
|---|---|---|
| A. Low-risk project, concrete Dev checks only | PASS with policy caveat | Optional gates become `not required`; Producer can proceed to configured final approval. Add the minimum-check/risk rules from finding 10. |
| B. Independent review required, PASS, merge | PASS | Producer commissions a non-author; commit-bound verdict clears the gate; current head is compared before regular merge. |
| C. QA BLOCKED → scoped fix → QA retest | FAIL | QA has a direct-to-Dev edge and the reopen record has no safe post-freeze home. |
| D. Review + QA selected; one verdict carried forward | FAIL | Authority exists, but the carry-forward record is stored on the frozen branch and lacks complete old/new candidate provenance. |
| E. CEO final approval required | PASS | Baseline/override, approval owner, evidence mechanism, and merge guard are defined. |
| F. Missing GitHub/terminal/edit capability | PASS | Roles keep state pending and hand off exact target/payload/actor/evidence without claiming completion. |
| G. QA uses an evidence branch | PASS with clarification | Separate branch avoids moving the application candidate; require verified parent/ancestry identity. |
| H. Unexpected Dev push after PASS | FAIL | Producer head comparison stops merge, but an allowed generic PASS comment may not identify the older candidate. |
| I. Fresh fork clone with separate base/push remotes | FAIL | The second remote URL/configuration step is absent. |
| J. Malicious repository plan value | FAIL | Shell-valid metacharacters can enter copy-paste commands; no shared untrusted-content rule exists. |

## Communication-Path Audit

| Edge | Artifact / transition | Result |
|---|---|---|
| CEO/maintainer → Producer | Project risk policy and final-approval mechanism | Sound |
| Producer → Dev | Sprint plan before implementation | Canonical path sound; README ordering is wrong |
| Dev → Producer | Frozen-candidate handoff packet | Sound once candidate binding is made precise |
| Producer → independent reviewer → Producer | Risk scope and commit-bound verdict | Sound |
| Producer → QA → Producer | Frozen candidate and acceptance packet | Sound except QA's contradictory direct-to-Dev routing |
| Producer → Dev after block | Scoped Branch Reopen Packet | Missing safe artifact/location |
| Gate owner/CEO → Producer | Carry-forward confirmation | Missing complete old/new candidate record |
| Producer ↔ CEO | Final approval / risk acceptance | Sound |
| QA → Producer via evidence branch | Report commit plus verified ancestry | Sound with binding clarification |
| Producer → merge actor | Regular-merge payload or merge result | Sound |
| Selected post-merge owner → Producer | Merged artifact/environment/result | Sound |

## Heading and Terminology Audit

### Aligned

- `## Shared Delivery Lifecycle` is byte-identical across all three agents and validator-enforced.
- The lifecycle sentence is aligned across the agents, skill, canonical workflow, and project brief.
- Sections 12–15 consistently mean Cross-Chat Handoff, Bug & Fix Tracking, Multi-Repo Setup, and Delivery & Review Gates.
- Stable role IDs and Producer/Dev/QA boundaries are consistent.
- `required` / `not required`, `Candidate`, `Ready for merge` / `Blocked`, `regular merge`, and `Producer/CEO merge decision` are used consistently in core workflow text.
- Agent H2 ordering is internally consistent and validator-enforced: shared lifecycle, role workflow/responsibilities, capability protocol, boundaries, communication style.

### Needs alignment

- Gate/status heading variants should be reduced (finding 19).
- Project brief role labels abbreviate canonical role/perspective names.
- `PR head`, `candidate`, `platform-bound head`, and `PR/head association` need one precise immutable-identity vocabulary.
- `Status/archive` should split mandatory authoritative status from optional archive.

## Strengths Verified

- No live secrets, keys, tokens, connection strings, or real EUII were found.
- The complete candidate contains tracked regular files only; no untracked files, submodules, symlink-mode changes, or executable-bit changes were present at review start.
- Exporter provenance defenses remain strong: committed-HEAD source, replacement-ref resistance, clean/attached branch checks, target ancestry, managed-path safety, no-hardlink private clone, checked binary patch, and no commit/push/PR mutations.
- Stable IDs, standalone/target skill-name adaptation, managed plugin fields, and one-way ownership boundaries remain intact.
- Role separation is clear and generally executable.
- Optional QA/review is consistently distinguished from failed or exempt gates.
- Freeze begins at handoff; unauthorized movement suspends merge; affected gates rerun and unaffected gates require explicit carry-forward.
- Parameterized target/base/push/working-branch design is correct once remote setup and argument safety are added.
- A disposable preview of all reviewed changes merged cleanly onto current `origin/main`.

## Validation Evidence

- `git diff --check origin/main`: PASS
- `npm run validate`: PASS
- `npm test`: PASS, 44/44
- `node --test --test-isolation=none`: PASS, 44/44
- Editor diagnostics: none
- Isolated junction probe: validator incorrectly returned PASS (finding 7 confirmed)
- Isolated hardcoded-primary-base probe: validator incorrectly returned PASS (finding 8 confirmed)
- Disposable full-candidate merge preview onto current `origin/main`: PASS

## Publication Checklist

### Required before merge/public release

1. Resolve all MAJOR findings and rerun this independent review against the new frozen candidate.
2. Add targeted regression tests for junction escapes, scoped primary template fields, candidate-bound comments, Producer-only reopen routing, and post-freeze reopen packets.
3. Commit the canonical candidate on this feature branch; ensure the source worktree is clean and capture the final source commit.
4. Run `npm run validate`, `npm test`, and the direct plugin smoke test with all three agents and an inherited MCP/extension tool.
5. Exercise traces A–J above, especially C, D, H, I, and J.
6. Export only from the clean committed canonical source: `awesome:check` → `awesome:write` → final `awesome:check`.
7. Update the Awesome-owned marketplace README in the Awesome PR; do not add it to the synchronization manifest.
8. In Awesome, run dependency install, skill validation, plugin validation, build, line-ending normalization, then skill/plugin validation again.
9. Rerun canonical `awesome:check`, inspect the complete target diff, and avoid hand-editing generated/publication-owned outputs.
10. Record final source URL/SHA, plugin version, all validation/build evidence, and the Awesome README review in the PR.

### Advisory follow-up

- Raise the supported Node floor in a deliberate compatibility change.
- Reduce validator policy-string duplication without introducing a generic schema framework.
- Track delivery-policy duplication and `validateDeliveryWorkflow()` growth in the review profile.
