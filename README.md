# AI Team Orchestration Plugin

A lightweight VS Code agent plugin for role-separated AI development. It provides a Producer, a stack-adaptive Dev Team, optional QA, and concise templates for planning, brainstorming, and context recovery.

## What's Inside

| Agent | Use it for | Boundary |
|---|---|---|
| `@ai-team-producer` | Scope, planning, coordination, triage, and merge | Never implements application code |
| `@ai-team-dev` | Features, fixes, tests, self-review, and pull requests | Never merges or claims independent approval |
| `@ai-team-qa` | Optional behavioral testing and fix verification | Reports problems; never fixes application source |

Nova, Sage, and Milo are adaptive perspectives inside the Dev agent, not mandatory project layers or separate sessions.

The `ai-team` skill includes:

- a concise project brief template;
- a proportional work-plan template;
- brainstorm guidance with distinct perspectives;
- practical anti-patterns learned from multi-agent projects.

## Default Workflow

```text
Plan -> Implement -> Test -> optional review or QA -> Merge -> update project state
```

Use the lightest process that fits the work:

- proceed directly for small, clear changes;
- create a short plan for substantial or cross-cutting work;
- add independent review or QA when risk, uncertainty, or repository policy warrants it;
- rely on repository branch protection, required checks, permissions, and merge policy.

## Install

### From source

1. Run **Chat: Install Plugin From Source** in VS Code.
2. Enter `https://github.com/denis-a-evdokimov/ai-team-orchestration.git`.
3. Select one of the bundled agents in Chat.

### Manual development checkout

```json
"chat.pluginLocations": {
  "/path/to/ai-team-orchestration": true
}
```

## Quick Start

### New or existing project

```text
@ai-team-producer Help me define the next useful outcome for this project.
Use the ai-team skill. Keep planning proportional to the work.
```

### Implement

```text
@ai-team-dev Read the repository instructions and active plan or issue.
Implement the requested outcome, run relevant checks, self-review the diff,
and prepare the pull request. Do not merge.
```

### Optional QA

```text
@ai-team-qa Test the pull request against its acceptance criteria.
Focus on important behavior and regressions. Report Ready, Ready with minor
follow-ups, or Blocked with reproducible findings.
```

## Flexible Tools and Models

The bundled agents intentionally omit `tools` and `model` frontmatter.

- Built-in, MCP, and extension-provided tools enabled by the developer remain available.
- The developer keeps control of model selection.
- Agent roles are enforced by instructions plus normal trust, authentication, permission, and approval controls.

If too many tools are enabled, deselect irrelevant tools or MCP servers, or configure `github.copilot.chat.virtualTools.threshold`. Do not copy a machine-specific tool list into the plugin.

## Customization

Keep the stable agent IDs:

- `ai-team-producer`
- `ai-team-dev`
- `ai-team-qa`

Adapt role personalities and project perspectives as needed. QA and independent review are optional unless repository policy or risk makes them necessary.

## Version 2

Version 2:

- keeps the stable `ai-team-*` agent IDs;
- inherits the user's enabled tools and selected model;
- makes roles stack-adaptive;
- replaces the formal delivery protocol with a lightweight, risk-proportionate default workflow.

The standalone skill remains `ai-team`. The Awesome Copilot export adapts only its frontmatter name to `ai-team-orchestration`.

## Maintainers

This repository is canonical. See [AGENTS.md](./AGENTS.md) for ownership rules and [CONTRIBUTING.md](./CONTRIBUTING.md) for validation and Awesome Copilot export instructions.

```text
npm run validate
npm test
npm run awesome:check -- --target <awesome-copilot-checkout>
npm run awesome:prepare -- --target <awesome-copilot-checkout> --output <patch-file>
```

## Origin

The original workflow grew from [Arcade After Dark](https://github.com/denis-a-evdokimov/guess-and-get), a multi-agent project built with distinct planning, implementation, design, and QA perspectives.

## License

MIT
