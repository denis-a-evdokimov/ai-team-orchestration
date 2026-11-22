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
- the exact file set of the plugin root: regular UTF-8 files only, with no links, hard links, extra files or extra folders;
- the constrained frontmatter fields, the stable agent IDs, the `include-custom-instructions: true` agent setting and the skill name;
- that no plugin manifest, skill, agent or copy of a plugin file exists outside the plugin root;
- local Markdown links, and that plugin Markdown links point only to files in the plugin root;
- that plugin Markdown has no parent-directory path and no root-relative link target, also not in code;
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

Before a catalog entry points at a commit, install that commit through a temporary marketplace. Run the check in a new shell process with an isolated Copilot home. Then the check does not change your own installation. The commands need PowerShell 7.4 or later.

1. Start a new PowerShell process, for example `pwsh -NoProfile`. Stop at the first failed command. Create a new, empty temporary folder, and point the home, cache and configuration folders at it:

   ```powershell
   $ErrorActionPreference = 'Stop'
   $PSNativeCommandUseErrorActionPreference = $true
   $iso = Join-Path ([IO.Path]::GetTempPath()) ('copilot-release-check-' + [guid]::NewGuid().ToString('N'))
   New-Item -ItemType Directory -Path $iso | Out-Null
   $env:USERPROFILE = $iso
   $env:HOME = $iso
   $env:COPILOT_HOME = "$iso\.copilot"
   $env:COPILOT_CACHE_HOME = "$iso\cache"
   $env:LOCALAPPDATA = "$iso\AppData\Local"
   $env:APPDATA = "$iso\AppData\Roaming"
   $env:XDG_CONFIG_HOME = "$iso\.config"
   $env:XDG_CACHE_HOME = "$iso\.cache"
   $env:XDG_DATA_HOME = "$iso\.local\share"
   $env:XDG_STATE_HOME = "$iso\.local\state"
   ```

   On Linux and macOS, set `HOME`, `COPILOT_HOME` and the `XDG_*` folders in the same way. The [Awesome Copilot install smoke gate](https://github.com/github/awesome-copilot/blob/f10fdb8b2660ce85c98f220b2f1ca24653768a5c/.github/scripts/external-plugins/external-plugin-quality-gates.mjs#L435-L480) sets `HOME` and the XDG folders on Linux.
2. Write `$iso\marketplace\marketplace.json`. The plugin entry uses the full commit SHA and the version from `plugin.json`:

   ```json
   {
     "name": "release-check",
     "owner": { "name": "Release check" },
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

3. Install the plugin:

   ```powershell
   copilot plugin marketplace add "$iso\marketplace"
   copilot plugin install ai-team-orchestration@release-check
   ```

4. Compare the installed folder with the plugin root at that commit. Run the commands in your checkout:

   ```powershell
   git archive --format=tar --output="$iso\release.tar" <full commit SHA> plugins/ai-team-orchestration
   tar -xf "$iso\release.tar" -C $iso
   git diff --no-index --ignore-cr-at-eol --stat "$iso\plugins\ai-team-orchestration" "$env:COPILOT_HOME\installed-plugins\release-check\ai-team-orchestration"
   ```

   No output and no error mean that the file sets and the file contents are equal. A difference makes `git diff` exit with code 1, and PowerShell stops with an error.
5. Close the shell process, and delete the temporary folder.

Do the comparison before you run another Copilot CLI command. In our test, Copilot CLI 1.0.114 removed the installed copy at its next start. The marketplace was a local folder, and the plugin source was a GitHub repository.

The Awesome Copilot [external plugin gates](https://github.com/github/awesome-copilot/blob/f10fdb8b2660ce85c98f220b2f1ca24653768a5c/CONTRIBUTING.md#L213-L346) run the same kind of install check. They also check the manifest and run `vally lint`.

## Release

1. Change the plugin in `plugins/ai-team-orchestration/`. Set a new SemVer `version` in `plugin.json`.
2. Run the local validation and the smoke test.
3. The repository owner merges the pull request with a merge commit. The merge commit on `main` is the release. This repository does not use tags.
4. Run the install check for the merge commit.

A catalog entry, for example in Awesome Copilot, pins the plugin with `source.path` `plugins/ai-team-orchestration`, the full merge commit SHA, and the same version. A change to the Awesome Copilot entry needs the repository owner's approval and follows the public Awesome Copilot workflow.
