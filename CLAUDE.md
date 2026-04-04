# Vorra - Development Guide

## Project Overview

Vorra is an AI-powered study & life planner — an Electron desktop app for managing courses, study plans, goals, and focus sessions. Current version: **8.2.0**.

## Tech Stack

- **UI**: React 18 (JSX, no TypeScript)
- **Build**: Vite 6 (dev server on port 5173)
- **Desktop**: Electron 35 (main process in `electron/main.js`)
- **Styling**: Vanilla CSS + inline styles with theme token system (Dark, Light, Warm, Mono, Ocean)
- **Data**: SQLite primary (better-sqlite3) + localStorage fallback. Dual-write for reliability.
- **Package Manager**: npm
- **Platform**: Windows (NSIS installer via electron-builder)
- **Updates**: electron-updater with GitHub Releases

## Project Structure

```
vorra/
├── electron/
│   ├── main.js            # Electron main process, splash screen, local HTTP server (port 19532), auto-updater, IPC handlers
│   ├── preload.js          # contextBridge: window.vorra API (db, backup, notify, updates, platform)
│   ├── database.js         # SQLite wrapper (better-sqlite3, WAL mode)
│   ├── backup.js           # Auto-backup system with crash recovery
│   └── splash.html         # Branded splash screen (frameless, animated)
├── src/
│   ├── App.jsx             # App shell (~800 lines): sidebar, routing, shortcuts, update banner, What's New modal, session restore
│   ├── main.jsx            # React root with error boundary
│   ├── streams.js          # YouTube (100 streams) & SomaFM (44 stations) catalog
│   ├── pages/
│   │   ├── Dashboard/DegreeDashboard.jsx     # Hero zone, progress rings, course bars, exam readiness, streak
│   │   ├── Courses/MyCoursesPage.jsx         # Course management, AI enrichment, degree plan parser
│   │   ├── Planner/StudyPlannerPage.jsx      # AI lesson plan generation, queue conversion, availability editor
│   │   ├── Daily/DailyPage.jsx               # Queue-based daily tasks, timer, overdue detection, carry-forward
│   │   ├── Calendar/CalendarPage.jsx         # Month/Week/Day views, heatmap, exam markers
│   │   ├── Calendar/MiniCal.jsx              # Sidebar mini calendar
│   │   ├── Chat/StudyChatPage.jsx            # 4-mode AI tutor (Socratic/Quiz/Plan/Coach), thinking blocks
│   │   ├── Quiz/PracticeExamPage.jsx         # Test/Study modes, competency scoring, FSRS, historical review
│   │   ├── Report/WeeklyReportPage.jsx       # Hero ring, study dots, velocity bars, exam trends
│   │   ├── Settings/SettingsPage.jsx         # AI profiles, themes, font scaling, university profile
│   │   └── Ambient/AmbientPage.jsx           # Study radio, quick focus presets, custom presets, sleep timer
│   ├── components/
│   │   ├── ui/             # Btn, Badge, Modal, Label, PillGroup, CommandPalette, OnboardingWizard, etc.
│   │   ├── icons/          # SVG icon library (100+ icons including Vorra logo, provider logos, preset icons)
│   │   ├── course/         # CourseDetail (pill-button section viewer)
│   │   ├── daily/          # DayTimeline, FocusMode, AIAssistBar, NowStrip, ProgressHeader
│   │   ├── planner/        # WeeklyAvailabilityEditor, CommitmentEditor
│   │   ├── widgets/        # Dashboard widgets (Progress, Streak, Task, Timer, Upcoming, Courses)
│   │   └── MediaPlayer/    # Sidebar media player + genre-aware visualizer
│   ├── systems/
│   │   ├── api.js          # AI provider integration: buildSystemPrompt (with selectedCourseId optimization), fmtCtx/fmtCtxSlim, callAIWithTools, callAIStream, runAILoop, thinking extraction
│   │   ├── storage.js      # Dual-write (SQLite + localStorage), INIT schema, migrations, crash recovery
│   │   ├── background.js   # Background task system (survives navigation)
│   │   ├── timer.js        # Study session timer with countdown/count-up
│   │   ├── focus.js        # Focus pulse check-in system
│   │   ├── audio.js        # SomaFM playback + Web Audio API (16-band frequency data)
│   │   ├── youtube.js      # YouTube multi-stream playback, health checks, postMessage with origin validation
│   │   ├── undoStack.js    # Memory-only undo/redo stack (max 10 snapshots)
│   │   ├── spaced-repetition.js  # FSRS-4.5 engine (built, wiring to exams in progress)
│   │   ├── shortcuts.js    # Keyboard shortcut registration
│   │   ├── breakpoint.js   # Responsive breakpoint system
│   │   ├── notifications.js, debug.js, toast.js, electron-bridge.js
│   │   └── ...
│   ├── constants/
│   │   ├── tools.js        # AI tool schemas (7 tools), PROVIDER_QUIRKS per provider
│   │   ├── nav.js          # Navigation items grouped (Study/Tools), keyboard shortcuts
│   │   ├── universityProfiles.js # School presets (WGU, SNHU, ASU, Purdue)
│   │   ├── lifeTemplates.js     # 11 schedule presets for study planner
│   │   └── categories.js   # Task categories with colors
│   ├── utils/
│   │   ├── studyQueue.js   # lessonPlanToQueue, populateToday, computeProgress (SPI, velocity)
│   │   ├── toolExecution.js # AI tool handler with course matching, dedup, validation
│   │   ├── courseHelpers.js # Section data, completeness checks, health indicators
│   │   ├── availabilityCalc.js  # Weekly availability math, effective hours per day
│   │   ├── courseLifecycle.js    # Course progress, task pulling, ghost placeholders
│   │   ├── gapAnalysis.js       # Plan health: content coverage, day gaps, Jaccard similarity
│   │   ├── scheduleShift.js     # Cascading task redistribution
│   │   ├── jsonRepair.js, helpers.js, csvImport.js, icsExport.js, courseSchema.js, planCalculations.js
│   │   └── ...
│   └── styles/
│       ├── tokens.js       # Theme system: 5 themes, fs() with 12px floor, useTheme hook
│       └── global.css       # Reset, form controls, animations, prefers-reduced-motion
├── build/                   # Installer assets (icon.ico)
├── package.json             # Dependencies + electron-builder config with GitHub publish
├── vite.config.js           # Vite build configuration
├── start.bat                # Silent Windows launcher (calls start.vbs)
├── start.vbs                # VBS launcher: no console window, auto-rebuild
├── setup.bat / setup.ps1    # Windows setup scripts
└── CLAUDE.md                # This file
```

## Commands

```bash
npm run dev              # Vite dev server (port 5173)
npm run build            # Production build to dist/
npm run electron:dev     # Dev mode: Vite + Electron together
npm run electron:build   # Production: build + package installer
npm start                # Run Electron from built files
start.bat                # Silent launcher: no console, auto-rebuild, runs Electron
```

## Architecture Notes

### Study System (Queue Model)
- AI generates a **lesson plan** per course (via `create_lesson_plan` tool)
- `lessonPlanToQueue()` converts units into an **ordered task queue**
- Student works through tasks at their own pace — no fixed calendar dates
- `populateToday()` slices the queue into daily buckets based on available hours
- `computeProgress()` tracks SPI, velocity, estimated finish date
- Legacy tools (`generate_study_plan`, `create_schedule_outline`) are deprecated

### App Shell (App.jsx)
- ~800 lines: sidebar nav, routing, keyboard shortcuts, command palette
- Three-zone sidebar: fixed top (logo + status), scrollable middle (nav + calendar), fixed bottom (AI + media)
- Update banner for auto-updater (available → downloading → ready)
- What's New modal on version upgrade
- Session restore (last page + window bounds)

### AI Context System
- `buildSystemPrompt(data, ctx, selectedCourseId)` — selected course gets full `fmtCtx()` enrichment (all 18+ fields), others get `fmtCtxSlim()` one-liner
- `buildContext()` in StudyChatPage — runtime stats only (no enrichment duplication): queue progress, today's tasks, exam history, lesson plans, study stats
- 7 AI tools defined in `constants/tools.js`, all documented in the system prompt
- `PROVIDER_QUIRKS` handles per-provider differences (streaming, tool support, max loops)
- Thinking content extracted from `<think>` tags and `reasoning_content` field

### Data Persistence
- **SQLite** (primary): `%AppData%/vorra/vorra.db` via better-sqlite3 with WAL mode
- **localStorage** (fallback): `vorra-v1` key, 10MB Electron limit
- **Dual-write**: every save writes to both for redundancy
- **Crash recovery**: `-prev` backup key in localStorage
- **Auto-backup**: on startup (deferred 3s after window shows)
- **INIT schema**: defines all fields with defaults — new fields auto-populate on load

### Electron Main Process
- **Splash screen**: frameless 420x320 window, shown immediately, destroyed on `ready-to-show`
- **Local HTTP server**: port 19532, bound to 127.0.0.1, serves dist/ files
- **YouTube proxy**: `/yt-proxy?v=VIDEO_ID` with referrer-policy headers
- **Auto-updater**: electron-updater with GitHub Releases, silent check every 4 hours
- **Security**: nodeIntegration OFF, contextIsolation ON, no eval/remote module
- **Session restore**: window bounds saved to SQLite on close

## Code Style

- **JavaScript** (JSX) — no TypeScript
- **Single quotes** for strings
- **Semicolons** at end of statements
- **2-space indentation**
- **Inline styles** with theme tokens (`T.accent`, `T.card`, `T.border`, etc.)
- **camelCase** for variables/functions, **PascalCase** for components
- **`fs()`** for responsive font scaling (12px minimum floor, default 115% scale)
- **`safeArr()`** for safe array operations on potentially undefined data

## Development Guidelines

1. **Read before editing** — understand the component structure before making changes
2. **Test builds** — run `npm run build` after changes to catch issues early
3. **Electron security** — never enable nodeIntegration, keep contextIsolation on
4. **No secrets in code** — API keys come from user input, never hardcoded
5. **Theme compatibility** — ensure UI works across all 5 themes
6. **Font scaling** — all text must use `fs()` which enforces the 12px minimum
7. **Queue model** — daily tasks come from `taskQueue`, not `data.tasks` (legacy). Use `create_lesson_plan` not `generate_study_plan`
8. **Context optimization** — selected course gets full enrichment, others get slim summary. Don't duplicate enrichment between `fmtCtx` and `buildContext`
9. **Safe rendering** — never use `dangerouslySetInnerHTML`. Use React component-based rendering for AI-generated content
10. **postMessage validation** — always check `e.origin` in message event listeners
