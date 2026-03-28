# Vorra - Development Guide

## Project Overview

Vorra is an AI-powered study & life planner — an Electron desktop app for managing courses, study plans, goals, and focus sessions. Current version: **7.4.0**.

## Tech Stack

- **UI**: React 18 (JSX, no TypeScript)
- **Build**: Vite 6 (dev server on port 5173)
- **Desktop**: Electron 35 (main process in `electron/main.js`)
- **Styling**: Vanilla CSS + inline styles with theme token system (Dark, Light, Warm, Mono, Ocean)
- **Data**: localStorage persistence (10MB Electron limit), SQLite backend built but not wired for primary data
- **Package Manager**: npm
- **Platform**: Windows (NSIS installer via electron-builder)

## Project Structure

```
vorra/
├── src/
│   ├── App.jsx                    # App shell, sidebar nav, routing, shortcuts
│   ├── main.jsx                   # React root with error boundary
│   ├── streams.js                 # YouTube & SomaFM stream data
│   ├── pages/
│   │   ├── Dashboard/DegreeDashboard.jsx
│   │   ├── Courses/MyCoursesPage.jsx
│   │   ├── Planner/StudyPlannerPage.jsx
│   │   ├── Daily/DailyPage.jsx
│   │   ├── Calendar/CalendarPage.jsx, MiniCal.jsx
│   │   ├── Chat/StudyChatPage.jsx
│   │   ├── Quiz/PracticeExamPage.jsx
│   │   ├── Report/WeeklyReportPage.jsx
│   │   ├── Settings/SettingsPage.jsx
│   │   └── Ambient/AmbientPage.jsx
│   ├── components/
│   │   ├── ui/          # Btn, Badge, Modal, Label, PillGroup, etc.
│   │   ├── icons/       # Icon components + Spin animation
│   │   ├── course/      # CourseDetail (pill-button section viewer)
│   │   ├── planner/     # WeeklyAvailabilityEditor, CommitmentEditor
│   │   ├── widgets/     # Dashboard widgets
│   │   └── MediaPlayer/ # Study radio player + visualizer
│   ├── systems/
│   │   ├── api.js       # AI provider integration, buildSystemPrompt, runAILoop
│   │   ├── storage.js   # localStorage load/save, INIT schema, migrations
│   │   ├── background.js # Background task system (survives navigation)
│   │   ├── timer.js, focus.js, audio.js, youtube.js
│   │   ├── notifications.js, shortcuts.js, breakpoint.js
│   │   ├── debug.js, toast.js
│   │   └── spaced-repetition.js  # FSRS-4.5 engine (built, not yet wired to planner)
│   ├── constants/
│   │   ├── tools.js             # AI tool schemas, PROVIDER_QUIRKS
│   │   ├── universityProfiles.js # School presets (WGU, SNHU, ASU, Purdue)
│   │   ├── lifeTemplates.js     # 11 schedule presets for study planner
│   │   ├── categories.js, nav.js
│   │   └── ...
│   ├── utils/
│   │   ├── toolExecution.js     # AI tool handler (add_tasks, generate_study_plan, etc.)
│   │   ├── courseHelpers.js     # Shared section data, completeness, health indicators
│   │   ├── availabilityCalc.js  # Weekly availability math, feasibility, derivation
│   │   ├── planCalculations.js  # Legacy study plan math
│   │   ├── jsonRepair.js, helpers.js
│   │   └── ...
│   └── styles/
│       ├── tokens.js    # Theme system (useTheme, fs)
│       └── *.css
├── electron/
│   ├── main.js          # Electron main process, local HTTP server (port 19532)
│   ├── database.js      # SQLite wrapper (better-sqlite3)
│   ├── preload.js       # contextBridge for window.vorra API
│   └── backup.js        # Auto-backup system
├── dist/                # Vite build output
├── index.html           # Entry point
└── CLAUDE.md            # This file
```

## Commands

```bash
npm run dev              # Vite dev server (port 5173)
npm run build            # Production build to dist/
npm run electron:dev     # Dev mode: Vite + Electron together
npm run electron:build   # Production: build + package installer
npm start                # Run Electron from built files
start.bat                # Smart launcher: detects changes, rebuilds, runs Electron
```

## Architecture Notes

- **Modular structure** — pages, components, systems, constants, and utils are separated into dedicated files
- **App.jsx** is the shell (~500 lines) — sidebar nav, routing, keyboard shortcuts, command palette
- **No routing library** — uses `usePageNav()` hook with internal state
- **Electron main process** runs a local HTTP server (port 19532) with no-cache headers for development
- **Context isolation is ON**, Node integration is OFF
- **All user data** stored in localStorage via the `data` object (persisted through `save()`/`load()`)
- **plannerConfig** — new weekly availability system with per-day time windows, commitments, study modes
- **planHistory** — records of each AI plan generation for progress tracking
- **pendingPlan** — persisted in `data` to survive navigation (prevents orphaned tasks)

## Key Features

- Course management with 35+ fields per course, AI enrichment with 14 section categories
- My Courses: single-page flow (import → enrich → view), selective section regeneration, data health indicators
- Study Planner: weekly availability timeline editor with drag/resize, life templates, study modes (sequential/parallel/hybrid), pacing styles, block styles, feasibility stats with school-model-aware buffer
- AI study plan generation with exam prep ramps, spaced review, difficulty ramping, technique guidance
- Plan progress tracking with nudge system (catch-up suggestions)
- Degree plan parser (extracts courses from screenshots via vision AI)
- Study Radio (44 SomaFM + 50 YouTube streams)
- Practice exam generator with AI
- Study timer with Pomodoro, focus tracking
- Study Chat with per-course context
- Multiple themes (Dark, Light, Warm, Mono, Ocean)
- University profile system (WGU, SNHU, ASU Online, Purdue Global presets)
- AI disclaimers across 5 surfaces (first-run modal, course detail, practice exam, study planner, chat)

## Study Planner Features

- **Weekly Availability Editor**: interactive timeline with drag-to-move, edge-resize, 15-min snap
- **Keyboard shortcuts**: Ctrl+Z/Y undo/redo, Delete/Backspace to remove, arrow keys to nudge, Escape to deselect, click-to-select with visual highlight
- **Right-click context menus**: on empty space, study blocks, commitment blocks, day labels, time axis header
- **11 Life Templates**: 9-to-5 Worker, Night Shift, Parent, Full-Time Student, Part-Time Worker, Freelancer, Healthcare (12h), Remote Worker, Career Changer, Retail/Service, Blank Slate
- **Study Modes**: Sequential (WGU), Parallel (SNHU/ASU), Hybrid interleaving
- **Pacing Styles**: Steady, Wave, Sprint/Rest
- **Block Styles**: Standard (60-90m), Pomodoro (25m), Sprint (50m)
- **Feasibility Dashboard**: 5 stat cards (Total Hours, Weekly Pace, Est. Finish, Daily Need, Buffer/Acceleration/Weekly Slack), school-model-aware
- **AI Prompt Enhancements**: pre-assessment focus, exam prep ramp-down, post-exam recovery, session-relative difficulty scheduling, study technique guidance, spaced review, fatigue management
- **Study Preferences**: exam day strategy (light review/no study/normal/intensive), hard material timing (first/middle/last window), weekend intensity, per-course exam dates with date-based prep ramps
- **Generation Pipeline**: week-by-week with thinking-model chunking (3-day chunks), per-week timeout (3/5/8 min by model type), stall detection, catch-up hours, JSON-text fallback for no-tool providers (ClewdR)
- **Plan Review Dashboard**: course breakdown bars, weekly load chart, quality checks (overloaded days, utilization), conflict detection with existing calendar, motivational finish-line projection
- **Collapsible Week Cards**: expand/collapse with animation, per-week accept/reject toggles, mini day-load indicators, course color borders, staggered fade-in
- **Task Editing**: hover-reveal delete, inline time/title editing (click to edit), course filter pills to isolate by course
- **Safety**: discard confirmation dialog, undo after confirm (15-second window), partial week confirmation
- **Plan Progress Tracker**: overall bar, this-week/today metrics, catch-up nudge system
- **Daily Page Banner**: inline plan progress visible during study sessions

## Code Style

- **JavaScript** (JSX) — no TypeScript
- **Single quotes** for strings
- **Semicolons** at end of statements
- **2-space indentation**
- **Inline styles** with theme tokens (`T.accent`, `T.card`, `T.border`, etc.)
- **camelCase** for variables/functions, **PascalCase** for components
- **`fs()`** for responsive font scaling

## Development Guidelines

1. **Read before editing** — understand the component structure before making changes
2. **Test builds** — run `npm run build` after changes to catch issues early
3. **Electron security** — never enable nodeIntegration, keep contextIsolation on
4. **No secrets in code** — API keys come from user input, never hardcoded
5. **localStorage limits** — 10MB in Electron; chatHistories is the fastest-growing data
6. **Theme compatibility** — ensure UI works across all 5 themes
7. **No-cache headers** — Electron's local server sends no-cache headers to prevent stale assets
