# Repository Instructions

## Canonical ownership

This standalone repository is the canonical source for AI Team Orchestration. Change the canonical agents, skill, and plugin metadata here first; then export the managed subset to an Awesome Copilot checkout. Never make a target-only content fix and leave the canonical source behind.

The following identities are invariants:

- The standalone skill folder is `skills/ai-team`, and its `SKILL.md` frontmatter name is exactly `ai-team`.
- The Awesome Copilot target skill is `skills/ai-team-orchestration`, with exported frontmatter name `ai-team-orchestration`.
- The stable shared agent IDs are `ai-team-dev`, `ai-team-producer`, and `ai-team-qa`.
- The three bundled agents intentionally omit the optional `tools` field so they inherit the user's enabled built-in, MCP, and extension tools. Their role boundaries belong in instructions. Do not add a plugin-owned tool allowlist without an explicit compatibility decision.
- The standalone plugin manifest remains at the repository root as `plugin.json`.

The exporter produces content-equivalent managed files after LF normalization. The only semantic adaptation is the skill frontmatter `name`, from `ai-team` to `ai-team-orchestration`; opaque unknown assets remain byte-preserved. The standalone and Awesome copies are therefore not required to be byte-identical. Do not rename the standalone skill to match the target.

## File ownership boundaries

| Ownership | Files |
| --- | --- |
| Canonical, synchronized from this repository | The three files under `agents/`; the complete `skills/ai-team/` tree; configured plugin fields listed in `eng/awesome-copilot-sync.json` |
| Standalone-only | Root documentation; the root plugin location and its non-managed fields; `AGENTS.md`, `CONTRIBUTING.md`, `package.json`, and `eng/` |
| Awesome-owned | Target plugin `README.md`, target plugin repository URL, `agents` and `skills` paths, and every target plugin field not listed as managed |
| Awesome build/publication-owned | Every output generated or materialized by Awesome's build and publication automation |

Do not add generated or Awesome-owned files to the synchronization manifest. Maintain the target plugin README in Awesome for its marketplace audience; do not overwrite it from this repository. Do not hand-edit generated outputs to make a check pass.

## Workflow rules

1. Work only on feature branches in both repositories. Never write or push directly to `main`.
2. Follow the canonical-workflow-first rule: edit here, validate here, export, run Awesome validation/build, and open an Awesome PR targeting `main`.
3. Keep synchronization one-way. The Awesome checkout is never imported into this repository.
4. Keep `eng/awesome-copilot-sync.json` portable and minimal; absolute paths are forbidden.
5. Do not commit, push, create branches, or open pull requests from the synchronization script.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full release and smoke-test procedure.

## Validation commands

Run before proposing a change:

```text
npm run validate
npm test
```

Check or write an Awesome Copilot checkout explicitly:

```text
npm run awesome:check -- --target <awesome-copilot-checkout>
npm run awesome:write -- --target <awesome-copilot-checkout>
```

`AWESOME_COPILOT_ROOT` may replace `--target`. Both check and write require this canonical source to be committed, clean, and attached to a feature branch with no staged changes, and require the target to be attached to a non-`main`, non-`staged` branch. Write mode additionally requires a clean target Git worktree.

The target must have a fetched `upstream/main` ref that is an ancestor of its feature-branch `HEAD`. Write mode generates and verifies a binary Git patch in a private temporary no-hardlink clone, then applies it to the target working tree without staging.
