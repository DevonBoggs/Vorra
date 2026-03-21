# Vorra - Development Guide

## Project Overview

Vorra is an AI-powered study & life planner — an Electron desktop app for managing courses, goals, habits, and focus sessions. Current version: **7.3.0**.

## Tech Stack

- **UI**: React 18 (JSX, no TypeScript)
- **Build**: Vite 6 (dev server on port 5173)
- **Desktop**: Electron 35 (main process in `electron/main.js`)
- **Styling**: Vanilla CSS with theme system (Dark, Light, Warm, Mono, Ocean)
- **Data**: localStorage persistence
- **Package Manager**: npm
- **Platform**: Windows (NSIS installer via electron-builder)

## Project Structure

```
vorra/ (currently devonsync-app/)
├── src/
│   ├── App.jsx          # Main app component (~6700 lines on master, modular on ui-visual-updates)
│   ├── main.jsx         # React root with error boundary
│   └── streams.js       # YouTube & SomaFM stream data
├── electron/
│   └── main.js          # Electron main process, local HTTP server on port 19532
├── public/
│   └── icon.png
├── dist/                # Vite build output
├── index.html           # Entry point
├── vite.config.js       # Vite configuration
├── package.json         # Dependencies & scripts
├── CLAUDE.md            # This file
└── .claude/
    ├── commands/        # Slash commands (type / to see all)
    ├── skills/          # Agent skills (auto-discovered)
    ├── agents/          # Subagent definitions
    └── context/         # Design principles & style guides
```

### Branches
- `master` — monolithic App.jsx (~6700 lines)
- `ui-visual-updates` — decomposed into 42 modular files (components/, pages/, systems/, styles/, utils/)

## Commands

```bash
npm run dev              # Vite dev server (port 5173)
npm run build            # Production build to dist/
npm run electron:dev     # Dev mode: Vite + Electron together
npm run electron:build   # Production: build + package installer
npm start                # Run Electron from built files
```

## Architecture Notes

- **App.jsx is monolithic** (~6700 lines). All state, UI, and logic live here. When modifying, be precise about which section you're editing.
- **No routing library** — the app uses internal state to switch between views/tabs.
- **Electron main process** runs a local HTTP server (port 19532) for YouTube proxy/embed functionality.
- **Context isolation is ON**, Node integration is OFF — communication between main/renderer uses standard web APIs and postMessage.
- **All user data** is stored in localStorage — there is no backend database.

## Key Features

- Course management with 35+ fields per course
- AI study plan generation (Anthropic/OpenAI API integration)
- Degree plan parser (extracts courses from screenshots)
- Study Radio (44 SomaFM + 50 YouTube streams)
- Practice exam generator
- Study timer with focus tracking
- CSV/JSON import/export
- Multiple themes

## Code Style

- **JavaScript** (JSX) — no TypeScript
- **Single quotes** for strings
- **Semicolons** at end of statements
- **2-space indentation**
- **React.createElement** used in main.jsx (error boundary), JSX everywhere else
- **Inline styles** are common throughout App.jsx
- **camelCase** for variables and functions
- **PascalCase** for component names

## Development Guidelines

1. **Read before editing** — always read the relevant section of App.jsx before making changes, it's large
2. **Be surgical** — in a 6700-line file, use precise edits with enough context to match uniquely
3. **Test builds** — run `npm run build` after changes to catch issues early
4. **Electron security** — never enable nodeIntegration, keep contextIsolation on
5. **No secrets in code** — API keys should come from user input or environment, never hardcoded
6. **localStorage limits** — be mindful of the ~5-10MB localStorage limit when adding data features
7. **Theme compatibility** — when adding UI, ensure it works across all 5 themes

## Slash Commands

| Command | Purpose |
|---|---|
| `/commit` | Conventional commits with emoji |
| `/create-pr` | Branch + commit + pull request |
| `/pr-review #N` | Multi-role code review |
| `/fix-github-issue #N` | Analyze and fix a GitHub issue |
| `/todo add "task"` | Manage project todos |
| `/create-hook` | Set up Claude Code hooks |
| `/release` | Changelog + version bump |
| `/add-to-changelog 7.4.0 added "..."` | Add changelog entry |
| `/update-branch-name` | Rename branch based on work |
| `/test-plan "feature"` | Create a testing plan |
| `/evaluate` | Full repository audit |
| `/optimize "target"` | Performance analysis + 3 fixes |
| `/design-review` | UI/UX review with design principles |
| `/security-review` | OWASP-based security scan |
| `/code-review` | Pragmatic code review |
| `/diff-review` | Security-focused PR/commit review (Trail of Bits) |

## Agent Skills (auto-discovered from .claude/skills/)

### Superpowers (Core SDLC)
- **brainstorming** — Socratic design refinement before implementation
- **writing-plans** — Bite-sized implementation plans with exact steps
- **subagent-driven-development** — Execute plans with 2-stage review per task
- **test-driven-development** — RED-GREEN-REFACTOR cycle
- **systematic-debugging** — 4-phase root cause analysis
- **verification-before-completion** — Evidence before assertions
- **dispatching-parallel-agents** — Run independent investigations concurrently
- **requesting-code-review** / **receiving-code-review** — Code review workflow
- **finishing-a-development-branch** — Merge/PR decision workflow
- **using-git-worktrees** — Isolated workspaces for parallel work

### Trail of Bits (Security)
- **differential-review** — Security-focused PR review with adversarial analysis
- **insecure-defaults** — Detect hardcoded secrets, weak crypto, fail-open behavior
- **supply-chain-risk-auditor** — Dependency threat assessment

### CCPM (Project Management)
- **ccpm** — Spec-driven PM: PRDs → Epics → GitHub Issues → Parallel Execution → Tracking
  - Uses bash scripts for status: `bash .claude/skills/ccpm/references/scripts/status.sh`

### Fullstack Dev Skills
- **react-expert** — React 18/19 patterns, hooks, performance, state management
- **javascript-pro** — Modern ES2023+, async patterns, Node.js APIs, Web Workers
- **typescript-pro** — Advanced generics, type guards, utility types
- **fullstack-guardian** — End-to-end feature implementation with security

### Context Engineering Kit
- **reflexion** — Self-reflection and iterative improvement
- **kaizen** — Continuous improvement patterns
- **tdd** — Test-driven development patterns

### Compound Engineering
- **ce-brainstorm** / **ce-ideate** — Ideation workflows
- **ce-plan** — Planning with compound improvement loops
- **ce-review** — Code review that learns from mistakes
- **ce-work** — Execution with git worktrees and task tracking

### Other Skills
- **web-asset-generator** — Generate favicons, app icons, OG images from logos/emoji

## Agents (in .claude/agents/)

| Agent | Source | Purpose |
|---|---|---|
| `code-reviewer` | Superpowers | Senior code reviewer with architecture focus |
| `design-review-agent` | Design Review Workflow | 7-phase UI/UX review with Playwright |
| `pragmatic-code-review` | Code Review Workflow | Practical code quality review |
| `security-auditor` | Trail of Bits | Security-focused code auditor |
| `bug-hunter` | Compound Engineering | Find and fix bugs systematically |

## External Tools (install separately)

### Claude Squad — Parallel agent management
```bash
# Requires Go. Install from: https://github.com/smtg-ai/claude-squad
# brew install claude-squad  (macOS)
# Or: curl -fsSL https://raw.githubusercontent.com/smtg-ai/claude-squad/main/install.sh | bash
```

### Parry — Prompt injection scanner
```bash
# Requires Rust/Cargo or uvx. Install from: https://github.com/vaporif/parry
# Needs HuggingFace token for ML models
# uvx parry-guard hook  (add to settings.json hooks)
```
