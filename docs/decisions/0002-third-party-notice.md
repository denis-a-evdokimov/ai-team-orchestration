# 0002: Ship the license notice for upstream material in the skill folder

- Status: Accepted
- Date: 2026-11-22
- Decided by: agent (Project coordinator). The reviewer of the upstream submission and the upstream session agreed.
- Review: see the pull request `## Review` section
- Links: pull request [#19](https://github.com/denis-a-evdokimov/ai-team-orchestration/pull/19); material imported in [#16](https://github.com/denis-a-evdokimov/ai-team-orchestration/pull/16); source [github/awesome-copilot#2946](https://github.com/github/awesome-copilot/pull/2946); layout in [ADR 0001](./0001-agent-plugins-layout.md)

## Context

- [#16](https://github.com/denis-a-evdokimov/ai-team-orchestration/pull/16) imported 69 lines that a third party added to github/awesome-copilot in [#2946](https://github.com/github/awesome-copilot/pull/2946). The lines are in the four reference files of the skill. The other plugin files contain no third-party material.
- github/awesome-copilot uses the MIT License with the notice "Copyright GitHub, Inc.". The MIT License requires that notice and the permission notice in all copies or substantial portions.
- The `LICENSE` of this repository names only "Copyright (c) 2026 Denis Evdokimov". It is at the repository root.
- A plugin install copies only `plugins/ai-team-orchestration/` ([ADR 0001](./0001-agent-plugins-layout.md)). A skill install, for example with `gh skills install`, copies only the skill folder. Thus no install contains the root `LICENSE`.
- The GPT-6.2 Sol review of the upstream submission for an external Awesome Copilot entry reported the missing notice as a BLOCKER.

## Options considered

1. Add the notice only to the root `LICENSE`. No install contains that file.
2. Publish without a notice. This does not meet the conditions of the MIT License.
3. Remove the #2946 material. Denis chose to align the content with upstream in #16.
4. Add a notice file to the skill folder, and point to it from the root `LICENSE`.

## Decision

We chose option 4:

- `skills/ai-team-orchestration/NOTICE` names the source and the parts of the four references that contain the material. Then it gives the MIT License text of github/awesome-copilot with "Copyright GitHub, Inc.".
- The name `NOTICE` follows the [pinned Awesome Copilot catalog](https://github.com/github/awesome-copilot/tree/f10fdb8b2660ce85c98f220b2f1ca24653768a5c/skills/anti-ui-slop). There, `skills/anti-ui-slop/NOTICE` gives third-party notices next to `SKILL.md`. In that catalog, a `LICENSE` or `LICENSE.txt` file in a skill folder gives the license and the owner of the whole skill. That name would tell users that GitHub owns the whole skill.
- The root `LICENSE` keeps its MIT text and its copyright line. It adds the line "Copyright GitHub, Inc. (portions; see plugins/ai-team-orchestration/skills/ai-team-orchestration/NOTICE)". GitHub detects the MIT License only if each line above the permission notice starts with a copyright symbol. A test on GitHub showed that a separate line "Portions Copyright GitHub, Inc." changes the detected license from MIT to "Other", also without the path.
- `eng/validate.mjs` requires the notice, its copyright line, its permission notice and the pointer in `LICENSE`. It also requires that each line above the permission notice in `LICENSE` starts with "Copyright".
- The change is version 2.1.2. The agent and skill guidance does not change.

## Consequences

- Positive: plugin installs and skill installs contain the notice that the MIT License requires.
- Negative: the installed file set has 11 files. It no longer equals the native Awesome Copilot install, which has 10 files. This changes a consequence of ADR 0001, not its decision.
- Follow-up: material that comes from another source later needs its notice in `NOTICE` too.

## Revisit when

- The #2946 material leaves the references.
- An install route copies the root `LICENSE`, or a client requires a license file in another place.
