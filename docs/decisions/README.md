# Decision records

This folder holds the architecture decision records (ADRs) of this repository. Each ADR records one significant or hard-to-reverse decision.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-agent-plugins-layout.md) | Distribute the plugin as one Agent Plugins 1.0 package | Accepted |
| [0002](./0002-third-party-notice.md) | Ship the license notice for upstream material in the skill folder | Accepted |

## Rules

- Name each file `NNNN-short-title.md`. Use the next free number.
- Write the ADR in the same pull request as the change that it decides.
- Do not edit an accepted ADR. To change a decision, write a new ADR. Then change only the status line of the old ADR to `Superseded by NNNN`.
- Add a row to the index table.

## Template

```markdown
# NNNN: Decision title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Decided by: agent (model) | Denis
- Review: reviewer model; agreed | disagreement decided by Denis; confidence high | medium | low
- Links: pull request, issue, supersedes NNNN

## Context

What problem, constraint or quality attribute makes this decision significant?

## Options considered

- Each option and its material trade-offs.

## Decision

What we chose and why.

## Consequences

- Positive, negative and follow-up consequences.

## Revisit when

- The condition that makes us reconsider this decision.
```
