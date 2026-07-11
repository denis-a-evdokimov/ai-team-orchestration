# AI Team Orchestration Plugin

An agent plugin for VS Code that bootstraps and runs a multi-agent AI development team. Plan sprints, run brainstorms with distinct agent voices, and coordinate parallel dev/QA workflows — all from VS Code chat.

## What's Inside

### Agents

| Agent | Chat mention | Role | Tool Access |
|-------|-------------|------|-------------|
| **Producer** (Remy) | `@ai-team-producer` | Sprint planning, coordination, PR merging | Read + coordination-doc editing (no application-code editing) |
| **Dev Team** (Nova, Sage, Milo) | `@ai-team-dev` | Frontend, backend, and visual implementation | Full coding tools |
| **QA** (Ivy) | `@ai-team-qa` | Testing, bug filing, sign-off | Read + terminal + test/docs editing (no source editing) |

### Skill

Type `/ai-team` in chat to access templates for:
- **PROJECT_BRIEF.md** — single source of truth across all chats
- **Brainstorm format** — multi-agent debate with distinct voices
- **Sprint plans** — prioritized tasks, progress trackers, handoff docs
- **Anti-patterns** — lessons learned from real multi-agent projects

## Install

### From Source (Git URL)

1. Open VS Code
2. Run **Chat: Install Plugin From Source** from the Command Palette
3. Enter: `https://github.com/denis-a-evdokimov/ai-team-orchestration.git`

### Manual

1. Clone this repo
2. Add to VS Code settings:
```json
"chat.pluginLocations": {
    "/path/to/ai-team-orchestration": true
}
```

## Quick Start

### 1. Bootstrap a project

```
@ai-team-producer I want to build [describe your project in 3-5 sentences].
Use the /ai-team skill to bootstrap this project.
Start with a brainstorm, then create PROJECT_BRIEF.md with ALL sections (1-14).
```

### 2. Plan a sprint

```
@ai-team-producer Create Sprint 1 plan. Here's what needs to be done: [scope].
Run a team consilium to validate the plan.
```

### 3. Execute (in a separate VS Code window)

```
@ai-team-dev Read PROJECT_BRIEF.md, then docs/sprint-1/plan.md. Execute Sprint 1.
git pull origin main && git checkout -b feature/sprint-1
```

### 4. Test (in another VS Code window)

```
@ai-team-qa Sprint 1 is merged to main. Do full playthrough.
File bugs as GitHub Issues. Write docs/qa/sprint-1-signoff.md.
```

## How It Works

The human acts as the message bus between parallel chats:

```
  @ai-team-producer (plans & merges)
        │
   ┌────┼────┐
   ▼    ▼    ▼
@ai-team  @ai-team  DevOps
-dev      -qa       (on demand)
```

- **@ai-team-producer** edits coordination docs, never application source files
- **@ai-team-qa** edits tests and QA docs, never application source files
- **@ai-team-dev** has full tools — builds features as Nova (frontend), Sage (backend), and Milo (CSS/design)
- Each team works in a **separate clone** on its own feature branch

## Customization

### Change agent names
Edit the `.agent.md` files in `agents/` — update the name and personality.

### Add/remove roles
- Don't need QA? Delete `agents/ai-team-qa.agent.md`
- Need DevOps? Create `agents/devops.agent.md` with CI/CD-focused instructions
- Need a Data Scientist? Create `agents/data.agent.md` with ML-focused tools

### Adjust tool access
Edit the `tools:` field in agent frontmatter:
- `[read, search]` — read-only research
- `[read, edit, search, execute]` — full coding
- `[read, search, execute]` — read + test (no editing)

## Origin

This plugin codifies the workflow that shipped [Arcade After Dark](https://github.com/denis-a-evdokimov/guess-and-get) — a 30-game birthday gift app built entirely by 7 AI agents in 5 days. Zero lines of human-written code.

## License

MIT
