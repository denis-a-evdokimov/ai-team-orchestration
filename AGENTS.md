# Repository Instructions

## Plugin package

This repository is the source and the distribution of the AI Team Orchestration plugin. The plugin root is `plugins/ai-team-orchestration/`. It is an Agent Plugins 1.0 package. An install copies this folder, so the folder contains only plugin files. [ADR 0001](./docs/decisions/0001-agent-plugins-layout.md) records this decision.

The following rules are invariants:

- Keep exactly one copy of the plugin content, in the plugin root. Do not add generated copies, generators or export tooling.
- The plugin root contains exactly the files in `PLUGIN_FILES` in `eng/validate.mjs`: `plugin.json`, `README.md`, the three agent files, and the skill with its four references and its `NOTICE`. All are regular UTF-8 files, with no links or hard links. To add or remove a plugin file, update that list in the same change.
- The skill folder keeps `NOTICE`. It gives the MIT notice of GitHub, Inc. for the material that [github/awesome-copilot#2946](https://github.com/github/awesome-copilot/pull/2946) added to the four references. A skill install copies only the skill folder, so the notice stays there. A copyright line in the root `LICENSE` points to it, and `npm run validate` checks both. Above the permission notice, `LICENSE` has only the title, blank lines and lines that start with `Copyright`. In a test, another line made GitHub report "Other" instead of the MIT License. Material from another source needs its notice in `NOTICE` too. [ADR 0002](./docs/decisions/0002-third-party-notice.md) records this decision.
- `plugin.json` uses the Agent Plugins 1.0 `$schema` and only Agent Plugins 1.0 fields. The plugin name is `ai-team-orchestration`.
- The skill folder is `skills/ai-team-orchestration`, and its `SKILL.md` frontmatter name is exactly `ai-team-orchestration`.
- The stable agent IDs are `ai-team-dev`, `ai-team-producer`, and `ai-team-qa`. Each agent file is `com.github.copilot/agents/<id>.md`.
- The three bundled agents intentionally omit the optional `tools` and `model` fields. Thus they inherit the user's enabled built-in, Model Context Protocol (MCP), and extension tools. They also use the developer's selected model. Their role boundaries belong in instructions. Do not add a plugin-owned tool allowlist or model pin without an explicit compatibility decision.
- The three bundled agents set `include-custom-instructions: true`. Clients that support this field, for example Copilot CLI 1.0.86 or later, then also give the repository instruction files to an agent that runs as a subagent. `npm run validate` requires this field. Do not remove it without an explicit compatibility decision.
- Local file links in plugin Markdown point only to files in the plugin root. Installed copies do not contain other repository files. Use full URLs for other targets. This rule also applies to link forms and URL attributes in code examples. Plugin Markdown contains no parent-directory path (`../`) and no root-relative link target, also not in code examples.

`eng/validate.mjs` enforces these invariants.

## File ownership boundaries

| Ownership | Files |
| --- | --- |
| Plugin package, installed by users | `plugins/ai-team-orchestration/` |
| Repository only, never installed | Root `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `LICENSE`, `package.json`, `docs/`, `eng/`, and `.github/` |
| Awesome Copilot | The catalog entry for this plugin in `github/awesome-copilot` and its generated outputs |

Do not change Awesome Copilot from this repository. A change to its catalog entry needs the repository owner's approval and follows the public Awesome Copilot workflow.

## Workflow rules

1. Work only on feature branches. Never write or push directly to `main`.
2. Change the plugin only in `plugins/ai-team-orchestration/`.
3. Give each change to the plugin root a new `version` in `plugin.json`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the smoke test and the release procedure.

## Validation commands

Run before proposing a change:

```text
npm run validate
npm test
```
