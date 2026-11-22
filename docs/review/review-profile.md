# Review profile: AI Team Orchestration

> Durable review memory for the at-code-review skill. Manual edits are authoritative.
> Status: draft, bootstrapped in #18. A later review or Denis confirms it.

## Artifact policy

- This profile is the only committed review artifact.
- Review reports go in the pull request: the `## Review` section or a comment.

## Project goal

The repository is the single source and the distribution of an Agent Plugins 1.0 plugin: three agents and one skill for GitHub Copilot. Reviews protect the installed package contract and the accuracy of its documentation.

## Sacred invariants (automatic BLOCKER)

- Exactly one copy of the plugin, in `plugins/ai-team-orchestration/`. No generated copy, generator or exporter.
- The plugin root contains exactly the files in `PLUGIN_FILES` in `eng/validate.mjs`, as regular files without links or hard links. Installs copy this whole folder, recursively.
- `plugin.json` has the Agent Plugins 1.0 `$schema`, only Agent Plugins 1.0 fields, and the name `ai-team-orchestration`.
- The agent IDs are `ai-team-dev`, `ai-team-producer` and `ai-team-qa`, in `com.github.copilot/agents/<id>.md`.
- The skill is `skills/ai-team-orchestration`, with the frontmatter name `ai-team-orchestration`.
- The agents omit `tools` and `model`, and set `include-custom-instructions: true`.
- A change to guidance content is a separate, deliberate change. A packaging change keeps the content byte-identical after line-ending normalization.
- No change to other repositories, including `github/awesome-copilot`, from this repository.

## Stack pins and conventions

- Node.js 20 or newer. No third-party package dependencies.
- `npm run validate` (`eng/validate.mjs`) and `npm test` (`node --test`) are the checks. Continuous integration (CI) runs both on Ubuntu.
- Merge commits only. Text for humans follows the ASD-STE100-based writing style.

## Scale context

- About ten plugin files and one validator of about 720 lines. Performance is not a material risk.

## Privacy and end-user identifiable information (EUII) surface

- The plugin contains instructions only, with no executable code. The validator reads only repository files.
- Do not commit local paths that contain a user name, credentials or install logs.
- Use fictional names in examples and test fixtures. The author name in `plugin.json` and `LICENSE` is intentional public attribution.

## Accepted trade-offs (do not report again)

- `LICENSE` exists only at the repository root, not in the plugin root: one copy, and the installed file set equals the former native install. Accepted in #18.
- No tags or GitHub releases: the merge commit on `main` is the release locator. Accepted in #18.
- The validator implements the needed Agent Plugins 1.0 manifest rules without a JSON Schema library. Accepted in #18.
- The plugin `README.md` is the user README: the marketplace description and the delegation guidance. The root `README.md` serves repository visitors and links to the plugin README. Accepted in #18.
- The validator reads every Markdown link form in the raw text, code examples included, without a Markdown parser. In plugin Markdown, it also reads URL attributes outside HTML tags. Thus a code example or a sentence that looks like a broken link gives a diagnostic. Rephrase it, or use an existing target or a full URL. Reason: in #18, each code-aware scanner let a link leave the installed plugin. Accepted in #18.

## Recurring findings (check these first)

- Documentation that claims an install route or a client behavior without verification or a citation. Keep command-line interface (CLI) discovery, catalog installation and client compatibility as separate claims, each with the client version that was tested.
- Validator checks that compare names but not entry types, links, hard links or nested paths.
- Link extraction uses regular expressions on the raw text, not a Markdown or HTML parser. When it changes, test link forms in code, URL attributes outside well-formed tags, character references, backslash escapes and reference definitions in containers. Do not make plugin Markdown extraction skip code: a skip that differs from a client parser hides links. The fail-closed path checks (no parent-directory path and no root-relative target in plugin Markdown) keep a missed link inside the plugin root.
- A version change that is missing from `plugin.json` when the plugin root changes.

## Severity calibration

- A plugin-root file outside the allowlist, or a second copy of plugin content, is a BLOCKER.
- A weakened validator check without a stated reason is at least MAJOR.
- A link that the validator misses is MINOR when the fail-closed path checks still keep it inside the plugin root. A form that leaves the plugin root despite those checks is MAJOR. Exception: a form that needs deliberate obfuscation, for example escapes inside CSS or script, is MINOR. The checks find mistakes in reviewed pull requests. They are not a defense against a hostile author, who can write any instruction in plain text.

## Lens weighting

- Correctness of the package contract and Maintainability of documents and tests dominate. Security matters for secrets and personal data in records. Performance rarely applies.

## Architecture and drift watch

States: watch, escalate, resolved.

- `eng/validate.mjs` - growing file - about 720 lines after #18; each function within a complexity of 10 - **watch**
- Root `README.md` and plugin `README.md` - duplication cluster - the quick start prompts exist in both - **watch**
