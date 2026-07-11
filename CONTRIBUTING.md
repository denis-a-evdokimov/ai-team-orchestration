# Contributing

Work on a feature branch. This repository is the canonical source; do not begin by patching an Awesome Copilot copy. The ownership and naming invariants are defined in [AGENTS.md](./AGENTS.md).

## Local validation

Node.js 20 or newer is required. There are no third-party package dependencies.

Run both checks before review:

```text
npm run validate
npm test
```

The validator checks standalone plugin metadata, the constrained frontmatter fields this repository relies on, relative Markdown links, stable IDs, legacy references, and synchronization configuration. It deliberately does not claim full YAML validation; Awesome Copilot's validators remain authoritative downstream. Tests exercise the exporter entirely in temporary repositories. `AI_TEAM_VALIDATE_ROOT` exists solely for those isolated validator fixtures; normal validation leaves it unset.

## Direct plugin smoke test

For packaging or content changes, test the standalone checkout directly before export:

1. In VS Code, run **Chat: Install Plugin From Source**.
2. Select this repository checkout.
3. Confirm that `@ai-team-producer`, `@ai-team-dev`, and `@ai-team-qa` are available.
4. Confirm that the `ai-team` skill loads. In a plugin installation, VS Code may show its namespace-prefixed command, such as `/ai-team-orchestration:ai-team`.
5. Enable a test MCP or extension-provided tool, switch among the three AI Team agents, and confirm the tool remains available. The bundled agents intentionally omit `tools` and must not replace the user's enabled tool set.
6. Exercise the changed prompt or workflow without changing the stable IDs or local skill name.

If more than 128 tools are enabled, reduce the selection in the tool picker or configure `github.copilot.chat.virtualTools.threshold` before the smoke test.

## Export to Awesome Copilot

The export is deterministic and one-way. It manages the three root agents, mirrors the skill with the one explicit frontmatter-name adaptation, and updates only configured target plugin fields.

### 1. Prepare a fresh target branch

Start from a clean Awesome Copilot checkout with an `upstream` remote:

```text
git status --short
git fetch upstream main
git switch --no-track --create feature/sync-ai-team-orchestration-<version> upstream/main
```

Both check and write require `upstream/main` to exist and be an ancestor of the attached target feature branch, and refuse target `main` or `staged` and detached HEAD. This proves the branch was created from the current fetched upstream baseline while allowing reruns after target commits. Write additionally refuses staged files, untracked files, and other dirty worktree changes.

### 2. Check and export from this repository

Commit the canonical agents, complete skill tree, plugin metadata, and synchronization configuration on this feature branch before exporting. Both check and write read managed source bytes from the committed `HEAD` and refuse canonical `main` or `staged`, detached HEAD, staged changes, and any tracked or untracked dirty worktree state.

From the clean, committed canonical checkout:

```text
npm run validate
npm test
npm run awesome:check -- --target <awesome-copilot-checkout>
npm run awesome:write -- --target <awesome-copilot-checkout>
npm run awesome:check -- --target <awesome-copilot-checkout>
```

The first check normally exits 1 when an update is pending. Write mode constructs the exact managed change in a private temporary no-hardlink clone, verifies its binary/full-index Git patch, runs `git apply --check`, and then applies it to the target working tree with `git apply`. It never stages the result. After write mode, the final check must exit 0.

### 3. Validate and build in Awesome Copilot

From the target feature branch, run the Awesome commands:

```text
npm ci
npm run skill:validate
npm run plugin:validate
npm run build
bash eng/fix-line-endings.sh
npm run skill:validate
npm run plugin:validate
```

Then rerun the canonical `awesome:check` command against the target checkout and inspect the complete target diff.

All outputs produced or materialized by Awesome's build and publication automation are build/publication-owned. Do not hand-edit generated outputs. The target plugin `plugins/ai-team-orchestration/README.md` is an Awesome-owned adapter and is intentionally outside synchronization. A manual review against the exported behavior is mandatory for every export: update the README in the same Awesome PR when needed, or record in that PR that the review found no documentation change necessary. Change canonical managed agent or skill content here and export again; maintain Awesome-specific documentation and build behavior in Awesome itself.

### 4. Commit and open the Awesome PR

Commit and push only from the target feature branch. Open the Awesome Copilot PR with base branch `main`.

```text
git push --set-upstream origin <branch>
```

Include these trace details in the PR description:

- standalone repository URL;
- exact standalone source commit SHA;
- standalone `plugin.json` version;
- local validation and test results;
- Awesome skill validation, plugin validation, build, and line-ending results.

The exporter changes only verified managed working-tree paths through Git patch application. It does not stage, commit, push, create branches, or open pull requests.
