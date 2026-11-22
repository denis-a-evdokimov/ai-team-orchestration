# AI Team Orchestration Plugin

A lightweight agent plugin for role-separated AI development with GitHub Copilot. It provides a Producer, a stack-adaptive Dev Team, optional QA, and concise templates for planning, brainstorming, and context recovery.

The plugin package is in [`plugins/ai-team-orchestration`](./plugins/ai-team-orchestration/). It is an [Agent Plugins 1.0](https://agent-plugins.org/) package, and its [README](./plugins/ai-team-orchestration/README.md) is the marketplace description.

## What's Inside

| Agent | Use it for | Boundary |
|---|---|---|
| `@ai-team-producer` | Scope, planning, coordination, triage, and merge | Never implements application code |
| `@ai-team-dev` | Features, fixes, tests, self-review, and pull requests | Never merges or claims independent approval |
| `@ai-team-qa` | Optional behavioral testing and fix verification | Reports problems; never fixes application source |

Nova, Sage, and Milo are adaptive perspectives inside the Dev agent, not mandatory project layers or separate sessions.

The `ai-team-orchestration` skill includes:

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

### Copilot CLI

The `awesome-copilot` marketplace is registered by default. Install the plugin from it:

```text
copilot plugin install ai-team-orchestration@awesome-copilot
copilot plugin update ai-team-orchestration
```

The second command updates an existing installation. Until the `awesome-copilot` entry points to this repository, it serves version 2.0.0 from its own copy. That copy has the same skill guidance as version 2.1.2. Its agents do not have the `include-custom-instructions: true` setting from version 2.1.0. See [Installing and Using Plugins](https://github.com/github/awesome-copilot/blob/f10fdb8b2660ce85c98f220b2f1ca24653768a5c/website/src/content/docs/learning-hub/installing-and-using-plugins.md) for the marketplace commands.

### VS Code

The [Awesome Copilot documentation](https://github.com/github/awesome-copilot/blob/f10fdb8b2660ce85c98f220b2f1ca24653768a5c/website/src/content/docs/learning-hub/installing-and-using-plugins.md#browsing-in-vs-code) states that VS Code also has the `awesome-copilot` marketplace by default. Search for `@agentPlugins` in the Extensions view, or run **Chat: Plugins**. This repository has not verified VS Code with the version 2.1.2 package.

### Local development

Load the plugin root from a checkout for one Copilot CLI session:

```text
copilot --plugin-dir ./plugins/ai-team-orchestration
```

In that session, `/plugin list` shows the plugin under **External Plugins**. Version 2.1.1 moved the plugin root into `plugins/ai-team-orchestration`. A route that points at the repository root does not find the plugin.

## Quick Start

Each prompt starts with the agent that handles it. In Copilot CLI, select that agent first: run `/agent` and choose, for example, `ai-team-orchestration:ai-team-producer`. You can also start Copilot CLI with `--agent ai-team-orchestration:ai-team-producer`.

### New or existing project

```text
@ai-team-producer Help me define the next useful outcome for this project.
Use the ai-team-orchestration skill. Keep planning proportional to the work.
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

## Delegation and Repository Instructions

The team agents set `include-custom-instructions: true`. The [plugin README](./plugins/ai-team-orchestration/README.md#delegation-and-repository-instructions) explains which clients then give the repository instructions to a team agent that runs as a subagent.

## Customization

Keep the stable agent IDs:

- `ai-team-producer`
- `ai-team-dev`
- `ai-team-qa`

Adapt role personalities and project perspectives as needed. QA and independent review are optional unless repository policy or risk makes them necessary.

## Versions

Version 2.1.2 adds `NOTICE` to the skill folder. It gives the MIT notice of GitHub, Inc. for the material that [github/awesome-copilot#2946](https://github.com/github/awesome-copilot/pull/2946) added to the four references. The agent and skill guidance does not change. [ADR 0002](./docs/decisions/0002-third-party-notice.md) records the reasons.

Version 2.1.1 changes only the package. It uses the Agent Plugins 1.0 layout, keeps one copy in `plugins/ai-team-orchestration`, and renames the skill from `ai-team` to `ai-team-orchestration`. The agent and skill content of version 2.1.0 does not change. [ADR 0001](./docs/decisions/0001-agent-plugins-layout.md) records the reasons.

Version 2.1.0 sets `include-custom-instructions: true` on the team agents.

Version 2:

- keeps the stable `ai-team-*` agent IDs;
- inherits the user's enabled tools and selected model;
- makes roles stack-adaptive;
- replaces the formal delivery protocol with a lightweight, risk-proportionate default workflow.

## Repository Layout

```text
plugins/ai-team-orchestration/   The plugin root. Installs copy only this folder.
  plugin.json                    Agent Plugins 1.0 manifest
  README.md                      Marketplace description
  com.github.copilot/agents/     The three agents
  skills/ai-team-orchestration/  The skill, its four references and its NOTICE
docs/decisions/                  Architecture decision records
eng/                             Validator and tests
```

## Maintainers

This repository is the single source of the plugin. See [AGENTS.md](./AGENTS.md) for the invariants and [CONTRIBUTING.md](./CONTRIBUTING.md) for validation, the smoke test and releases.

```text
npm run validate
npm test
```

## Origin

The original workflow grew from [Arcade After Dark](https://github.com/denis-a-evdokimov/guess-and-get), a multi-agent project built with distinct planning, implementation, design, and QA perspectives.

## License

MIT. See [LICENSE](./LICENSE). Portions are Copyright GitHub, Inc. The skill's [NOTICE](./plugins/ai-team-orchestration/skills/ai-team-orchestration/NOTICE) names these portions and gives their license.
