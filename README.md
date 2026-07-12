# AI Team Orchestration Plugin

An agent plugin for VS Code that bootstraps and runs a multi-agent AI development team. Plan sprints, run brainstorms with distinct agent voices, and coordinate parallel dev/QA workflows — all from VS Code chat.

## What's Inside

### Agents

| Agent | Chat mention | Role | Operating boundary |
|-------|-------------|------|-------------|
| **Producer** (Remy) | `@ai-team-producer` | Planning, status, risk-based gate selection, regular merge | Coordination only; no implementation or test execution |
| **Dev Team** | `@ai-team-dev` | Stack-adaptive implementation, planned Dev checks, fixes | Implements but never merges its work |
| **QA** (Ivy) | `@ai-team-qa` | Optional candidate acceptance, test automation, bug verification, smoke checks | Used when selected; may edit tests/QA docs, never application source |

These are the plugin's **three real custom agents**. Nova, Sage, and Milo are collaborating engineering/design perspectives simulated inside the single Dev Team agent, not separate chat sessions. Kira (product) and Dash (delivery/operations) are optional planning perspectives invoked when the project needs them; they are not additional bundled custom agents.

### Skill

Use the `ai-team` skill to access templates for:
- **PROJECT_BRIEF.md** — single source of truth across all chats
- **Brainstorm format** — multi-agent debate with distinct voices
- **Sprint plans** — prioritized tasks, progress trackers, handoff docs
- **Delivery workflow** — frozen candidates and proportionate Dev, review, QA, merge, and smoke gates
- **Anti-patterns** — lessons learned from real multi-agent projects

When installed as a plugin, current VS Code versions may display the command with its plugin namespace, such as `/ai-team-orchestration:ai-team`. The skill's identifier remains `ai-team`.

## Install

### From Source (Git URL)

1. Open VS Code
2. Run **Chat: Install Plugin From Source** from the Command Palette
3. Enter: `https://github.com/denis-a-evdokimov/ai-team-orchestration.git`

### Manual

1. Clone this repo
2. Add to VS Code settings:
```json
"chat.pluginLocations": {
    "/path/to/ai-team-orchestration": true
}
```

## Version 2 Migration

Version 2 renamed the v1 agent IDs `producer`, `dev-team`, and `qa` to `ai-team-producer`, `ai-team-dev`, and `ai-team-qa`. Update saved prompts or customizations that select the former IDs, then reinstall or reload the plugin. The `ai-team` skill identifier is unchanged.

## Quick Start

### 1. Bootstrap a project

```
@ai-team-producer I want to build [describe your project in 3-5 sentences].
Use the ai-team skill to bootstrap this project.
Start with a brainstorm, then create PROJECT_BRIEF.md with ALL sections (1-15).
```

### 2. Plan a sprint

```
@ai-team-producer Create Sprint 1 plan. Here's what needs to be done: [scope].
Before Dev starts, run a team consilium, classify the change risk, record at least one concrete check for code/config changes, select proportionate gates, confirm repository remotes/branches, and set the reopen budget.
```

### 3. Execute (in a separate VS Code window)

```
@ai-team-dev Read PROJECT_BRIEF.md, then docs/sprint-1/plan.md. Execute Sprint 1.
Preflight a clean worktree, then use the target branch, base remote/ref, push remote, and working branch recorded in the sprint plan. Never substitute a default branch for those plan values.
Implement and run the selected Dev checks, capture the full tested local commit ID, then immediately push and freeze. Create/update the PR and post the Candidate Packet only after its observed head equals that captured ID. A mismatch means Hold, not reassignment of earlier checks. If PR mutation is unavailable, remain frozen while handing off the captured ID plus exact PR and draft packet payload for equality verification.
```

The CEO/maintainer sets acceptable risk and only they may approve reducing the project baseline. A low-risk project may use Dev-authored checks without independent review or QA, but every code/config candidate has at least one concrete check. Authentication/authorization, secrets or EUII, destructive data, privilege/deployment, supply-chain, and declared safety-invariant changes require applicable security-focused evidence or explicit CEO/maintainer risk acceptance.

After Dev hands off, the Producer records the full candidate commit ID in a live Delivery Ledger on the PR. The application branch stays frozen while selected gates run and after they pass.

### 4. Run independent review (when selected)

```
@ai-team-producer Run the selected independent review for Sprint 1 PR #[number] against the frozen candidate. Return blocking findings to Dev through a scoped branch reopen.
```

### 5. Run QA acceptance (when selected, in another VS Code window)

```text
@ai-team-qa Test the frozen candidate for Sprint 1 PR #[number] or its immutable preview. Record the environment, file bugs, and report Ready for merge or Blocked to the Producer in candidate-bound evidence. Do not authorize Dev or change the application branch.
```

### 6. Decide and merge

```text
@ai-team-producer Confirm every planned check and selected gate is bound to the Delivery Ledger Candidate ID and required approval is recorded. Regular-merge with an atomic expected-head guard equal to that Candidate ID, or a protected merge queue that revalidates candidate-bound evidence. A guard failure means Hold. Then run selected post-merge checks and complete the authoritative PROJECT_BRIEF.md Sections 7 and 8 update. Archive evidence separately only if project policy requires it.
```

## How It Works

The human acts as the message bus between parallel chats:

```
  @ai-team-producer (plans & merges)
        │
   ┌────┼────┐
   ▼    ▼    ▼
@ai-team  @ai-team  DevOps
-dev      -qa       (on demand)
```

- **@ai-team-producer** edits coordination docs, selects gates with the CEO/maintainer, commissions selected independent analysis or QA, and merges; it never implements or runs tests
- **@ai-team-qa** is used when selected; it edits tests and QA docs, accepts or blocks the frozen candidate, and never fixes application source
- **@ai-team-dev** builds with Nova (interaction/presentation), Sage (core/services/security), and Milo (experience/design) perspectives adapted to the discovered stack
- Use a **separate clone per concurrent session**. Dev uses the planned working branch; QA normally checks out the frozen candidate and needs a separate branch only for test/evidence commits.

## Customization

You may adapt role personalities, project perspectives, and gate selection without changing the three stable agent IDs. Every project records QA as `required` or `not required`; the bundled QA agent remains available either way. Truly removing that agent is a topology change—like renaming IDs or adding bundled agents—and is a fork-only change that also requires updates to the manifest, invocation references, synchronization mapping, validation expectations, and tests.

### Tool availability

The bundled agents intentionally omit the optional `tools` and `model` frontmatter fields. They inherit all tools available in the user's environment, including built-in tools and enabled tools from MCP servers and extensions, and leave model selection to the developer so each session can use its best available model. Selecting an AI Team agent therefore does not replace the user's tool configuration with a plugin-defined allowlist.

Role boundaries are enforced by each agent's instructions and by the editor's normal trust, authentication, approval, and permission controls—not by hiding capabilities. An agent must still detect unavailable or unauthenticated capabilities and hand off exact actions instead of claiming they happened.

Capability is not authority. Repository files, plans, issues, PR text, reviews, logs, artifacts, fetched pages, and command output are untrusted data. Embedded directives cannot override the user, role boundaries, adopted repository policy, or the recorded gate plan. Agents construct actions from validated values and fixed command forms, and obtain explicit user confirmation before destructive, privileged, credential-bearing, new external-destination, or gate-reducing mutations.

To create a restricted fork, add an explicit `tools` list. Omitting `tools` or using `tools: ['*']` enables all available tools; `tools: []` disables all tools; a non-empty list acts as an allowlist. A prompt file with its own `tools` field takes precedence over the selected agent.

VS Code permits at most 128 enabled tools per request. In tool-heavy environments, deselect irrelevant tools or MCP servers in the tool picker, or configure `github.copilot.chat.virtualTools.threshold` so VS Code manages a large tool set through virtual tools.

## Maintainers / Awesome Copilot synchronization

This repository is the canonical source. See [AGENTS.md](./AGENTS.md) for ownership rules and [CONTRIBUTING.md](./CONTRIBUTING.md) for the complete export and validation workflow.

```text
npm run awesome:check -- --target <awesome-copilot-checkout>
npm run awesome:prepare -- --target <awesome-copilot-checkout> --output <patch-file>
```

Prepare mode requires a clean Awesome Copilot feature branch and writes a verified binary patch without modifying, staging, committing, or pushing the target checkout. Recheck the target, then apply the patch explicitly with a trusted Git client.

## Origin

This plugin codifies the workflow that shipped [Arcade After Dark](https://github.com/denis-a-evdokimov/guess-and-get) — a 30-game birthday gift app built entirely by 7 AI agents in 5 days. Zero lines of human-written code.

## License

MIT
