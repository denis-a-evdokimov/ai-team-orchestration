# Contributing

Work on a feature branch. The plugin lives in [`plugins/ai-team-orchestration`](./plugins/ai-team-orchestration/), and this repository keeps exactly one copy of it. [AGENTS.md](./AGENTS.md) defines the layout and naming invariants.

## Pull requests

All changes enter `main` through a pull request; direct pushes and force pushes are blocked. Every pull request must pass the repository validation workflow, and unresolved review conversations block merging. External contributions require one approval from the repository owner. Because GitHub does not count an author's approval of their own pull request, the owner may bypass only the approval requirement for an owner-authored pull request; required checks and the pull-request-only path still apply.

Use a regular merge. Squash and rebase merges are disabled by repository policy. A new commit must pass validation again and may require renewed approval according to branch protection.

Do not put secrets or end-user identifying information in code, fixtures, documentation, issues, pull requests, screenshots, or logs. Report suspected vulnerabilities privately as described in [.github/SECURITY.md](./.github/SECURITY.md).

## Local validation

Node.js 20 or newer is required. There are no third-party package dependencies.

Run both checks before review:

```text
npm run validate
npm test
```

The validator checks:

- the Agent Plugins 1.0 manifest fields and `$schema`;
- the exact file set of the plugin root, the three agent files and the one skill;
- the constrained frontmatter fields, the stable agent IDs and the skill name;
- that no plugin manifest, skill or agent file exists outside the plugin root;
- relative Markdown links, and that plugin Markdown links stay inside the plugin root;
- legacy agent references.

It does not claim full YAML or JSON Schema validation. The Awesome Copilot gates stay authoritative for a catalog listing. The tests run the validator against temporary copies of this repository.

## Smoke test

For packaging or content changes, test the plugin root with GitHub Copilot CLI before review.

1. List the plugin and its skill from the checkout:

   ```text
   copilot --plugin-dir ./plugins/ai-team-orchestration plugin list
   copilot --plugin-dir ./plugins/ai-team-orchestration skill list
   ```

   Confirm that `ai-team-orchestration` shows the new version under **External Plugins**. Confirm that the `ai-team-orchestration` skill shows under **Plugin skills**.
2. Start `copilot --plugin-dir ./plugins/ai-team-orchestration`. Run `/agent` and confirm the three agents: `ai-team-orchestration:ai-team-producer`, `ai-team-orchestration:ai-team-dev`, and `ai-team-orchestration:ai-team-qa`.
3. Invoke the skill. Confirm that its four reference links open.
4. Enable a test MCP or extension-provided tool, switch among the three AI Team agents, and confirm the tool remains available. The bundled agents intentionally omit `tools` and must not replace the user's enabled tool set.
5. Exercise the changed agent or skill guidance without changing the stable IDs or the skill name.

### Install check for a release commit

Before a catalog entry points at a commit, install that commit through a temporary marketplace. Use an isolated Copilot home, so that the check does not change your own installation. Set `COPILOT_HOME` to an empty folder. On Windows, also point `USERPROFILE`, `LOCALAPPDATA`, and `COPILOT_CACHE_HOME` at empty folders.

1. Write a `marketplace.json` file in an empty folder. The plugin entry uses the full commit SHA and the version from `plugin.json`:

   ```json
   {
     "name": "release-check",
     "owner": { "name": "Denis Evdokimov" },
     "plugins": [
       {
         "name": "ai-team-orchestration",
         "description": "<description from plugin.json>",
         "version": "<version from plugin.json>",
         "source": {
           "source": "github",
           "repo": "denis-a-evdokimov/ai-team-orchestration",
           "path": "plugins/ai-team-orchestration",
           "sha": "<full commit SHA>"
         }
       }
     ]
   }
   ```

2. Install the plugin:

   ```text
   copilot plugin marketplace add <marketplace-folder>
   copilot plugin install ai-team-orchestration@release-check
   ```

3. Compare the installed folder with `plugins/ai-team-orchestration` at that commit. The file set and the file contents after line-ending normalization must be equal.

The Awesome Copilot [external plugin gates](https://github.com/github/awesome-copilot/blob/f10fdb8b2660ce85c98f220b2f1ca24653768a5c/CONTRIBUTING.md#L213-L346) run the same kind of install check, and also check the manifest and run `vally lint`.

## Release

1. Change the plugin in `plugins/ai-team-orchestration/`. Set a new SemVer `version` in `plugin.json`.
2. Run the local validation and the smoke test.
3. Merge the pull request with a merge commit. The merge commit on `main` is the release. This repository does not use tags.
4. Run the install check for the merge commit.

A catalog entry, for example in Awesome Copilot, pins the plugin with `source.path` `plugins/ai-team-orchestration`, the full merge commit SHA, and the same version. A change to the Awesome Copilot entry needs Denis's approval and follows the public Awesome Copilot workflow.
