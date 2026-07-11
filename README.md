# AI Team Orchestration Plugin

An agent plugin for VS Code that bootstraps and runs a multi-agent AI development team. Plan sprints, run brainstorms with distinct agent voices, and coordinate parallel dev/QA workflows — all from VS Code chat.

## What's Inside

### Agents

| Agent | Chat mention | Role | Operating boundary |
|-------|-------------|------|-------------|
| **Producer** (Remy) | `@ai-team-producer` | Planning, status, independent-review commissioning, regular merge | Coordination only; no implementation or test execution |
| **Dev Team** | `@ai-team-dev` | Stack-adaptive implementation, tests, self-review, fixes | Implements but never independently approves or merges its work |
| **QA** (Ivy) | `@ai-team-qa` | PR-head acceptance, test automation, bug verification, smoke checks | May edit tests/QA docs, never application source |

These are the plugin's **three real custom agents**. Nova, Sage, and Milo are collaborating engineering/design perspectives simulated inside the single Dev Team agent, not separate chat sessions. Kira (product) and Dash (delivery/operations) are optional planning perspectives invoked when the project needs them; they are not additional bundled custom agents.

### Skill

Use the `ai-team` skill to access templates for:
- **PROJECT_BRIEF.md** — single source of truth across all chats
- **Brainstorm format** — multi-agent debate with distinct voices
- **Sprint plans** — prioritized tasks, progress trackers, handoff docs
- **Delivery workflow** — independent review, PR-head QA, merge, and smoke gates
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
Run a team consilium to validate the plan.
```

### 3. Execute (in a separate VS Code window)

```
@ai-team-dev Read PROJECT_BRIEF.md, then docs/sprint-1/plan.md. Execute Sprint 1.
Preflight a clean worktree, then use the target branch, base remote/ref, push remote, and working branch recorded in the sprint plan. Never substitute a default branch for those plan values.
Implement, test, self-review, then open the PR and hand off its exact head SHA.
```

### 4. Run the independent review gate

```
@ai-team-producer Review Sprint 1 PR #[number]. Confirm the Dev self-review, then commission a fresh non-author reviewer against the exact PR head SHA. Return blocker/major findings to Dev on the same branch.
```

### 5. Run QA acceptance on the PR head (in another VS Code window)

```text
@ai-team-qa Test Sprint 1 PR #[number] at head SHA [sha] or its immutable preview before merge. Record the environment, file bugs, verify fixes on each new head, and post a SHA-bound PR acceptance packet with Ready for merge or Blocked.
```

### 6. Merge and smoke-check

```text
@ai-team-producer Confirm independent review and QA acceptance both apply to the current PR head, then regular-merge the PR. Send the merge/deploy SHA to QA for a smoke check, then create a docs-only closeout PR to archive evidence and update PROJECT_BRIEF.md Sections 7 and 8.
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

- **@ai-team-producer** edits coordination docs, commissions independent analysis, and merges; it never implements or runs tests
- **@ai-team-qa** edits tests and QA docs, accepts the exact PR head, and never fixes application source
- **@ai-team-dev** builds with Nova (interaction/presentation), Sage (core/services/security), and Milo (experience/design) perspectives adapted to the discovered stack
- Each team works in a **separate clone** on its own feature branch

## Customization

You may adapt role personalities and project perspectives without changing the three stable agent IDs. Topology changes—renaming IDs, removing QA, or adding bundled agents—are fork-only changes that also require updates to the manifest, all invocation references, synchronization mapping, validation expectations, and tests.

### Tool availability

The bundled agents intentionally omit the optional `tools` and `model` frontmatter fields. They inherit all tools available in the user's environment, including built-in tools and enabled tools from MCP servers and extensions, and leave model selection to the developer so each session can use its best available model. Selecting an AI Team agent therefore does not replace the user's tool configuration with a plugin-defined allowlist.

Role boundaries are enforced by each agent's instructions and by the editor's normal trust, authentication, approval, and permission controls—not by hiding capabilities. An agent must still detect unavailable or unauthenticated capabilities and hand off exact actions instead of claiming they happened.

To create a restricted fork, add an explicit `tools` list. Omitting `tools` or using `tools: ['*']` enables all available tools; `tools: []` disables all tools; a non-empty list acts as an allowlist. A prompt file with its own `tools` field takes precedence over the selected agent.

VS Code permits at most 128 enabled tools per request. In tool-heavy environments, deselect irrelevant tools or MCP servers in the tool picker, or configure `github.copilot.chat.virtualTools.threshold` so VS Code manages a large tool set through virtual tools.

## Maintainers / Awesome Copilot synchronization

This repository is the canonical source. See [AGENTS.md](./AGENTS.md) for ownership rules and [CONTRIBUTING.md](./CONTRIBUTING.md) for the complete export and validation workflow.

```text
npm run awesome:check -- --target <awesome-copilot-checkout>
npm run awesome:write -- --target <awesome-copilot-checkout>
```

Write mode requires a clean Awesome Copilot feature branch and never commits or pushes.

## Origin

This plugin codifies the workflow that shipped [Arcade After Dark](https://github.com/denis-a-evdokimov/guess-and-get) — a 30-game birthday gift app built entirely by 7 AI agents in 5 days. Zero lines of human-written code.

## License

MIT
