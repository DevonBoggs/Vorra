# Vorra

**AI-powered study & life planner** for students. Built for WGU and competency-based education, but works for any study program.

An Electron desktop app that combines AI-generated lesson plans, a queue-based daily study system, practice exams with competency scoring, an AI study tutor, and an ambient study radio -- all in one window.

## Features

### Study Planner
- AI generates per-course lesson plans (units, topics, objectives, study techniques)
- Queue-based daily tasks -- the student controls the pace, the system tracks progress
- Pacing math: SPI (Schedule Performance Index), velocity tracking, estimated finish dates
- Study modes: sequential (one course at a time), parallel, or hybrid
- Weekly availability editor with drag/resize time windows
- Supports 25+ AI providers: Anthropic, OpenAI, Z.AI (GLM-5.1), Google Gemini, DeepSeek, Groq, Ollama, LM Studio, and more

### Daily Planner
- Queue-based daily view with today's tasks and work-ahead section
- Per-task countdown timer with start/pause and completion chime
- Overdue task highlighting (orange tint when past end time)
- Task completion with undo history
- Carry-forward for incomplete tasks from previous days

### Practice Exams
- AI-generated exams with multiple question types (multiple choice, multi-select)
- Test mode (simulates real exam) and Study mode (immediate feedback)
- Per-competency/topic results dashboard with score breakdown bars
- Exam presets: Quick Check (10q), Practice Set (25q), Full Simulation (50q), Custom
- Score trend chart with Y-axis labels, passing threshold, and per-exam details
- Historical exam review with full question/answer detail
- Persistent exam state survives page navigation
- Show/hide correct answers toggle

### Study Chat (AI Tutor)
- Four modes: Tutor (Socratic), Quiz, Plan, Coach
- Socratic tutoring: asks questions before explaining, "Just tell me" escape
- Deep context: course enrichment, task queue, lesson plans, exam history, study stats
- Thinking block display (collapsible, from reasoning models)
- 40+ quick action presets across all modes
- Concise/Detailed response toggle
- Per-course chat threads with compaction (condense old messages)

### Calendar
- Three views: Month (heatmap), Week (task columns), Day
- Study intensity heatmap (darker = more hours)
- Exam date markers with countdown badges
- Streak banner with course progress mini-bars

### Degree Dashboard
- Hero action zone with "Start Studying" CTA linked to next queue task
- Three progress rings: hours today, tasks today, overall completion
- 7-day velocity bars and study day dots
- Course progress bars with exam date countdowns
- Exam readiness section from practice exam history
- State-dependent: new user onboarding, active study, completing celebration

### Weekly Report
- Hero zone with SVG progress ring and week verdict
- Study day dots (Duolingo-style)
- 4-week sparkline trends
- Exam trend chart with proper axes
- "Next Step" CTA with specific task from queue
- Tier-based messaging for light weeks

### Study Radio
- 44 SomaFM stations + 100 YouTube streams across 10 categories
- Quick Focus presets (Lo-fi + Rain, Cafe Study, Nature Focus, etc.)
- Custom presets: save any combination of streams + volumes
- Genre-aware audio visualizer (bass-heavy for lo-fi, fast for electronic, etc.)
- Multi-stream playback (up to 4 simultaneous YouTube streams)
- Sleep timer, favorites, YouTube search discovery

### Course Management
- Track 35+ fields per course (credits, difficulty, competencies, topics, exam tips)
- AI-powered enrichment: generates study strategy, mnemonics, key terms, common mistakes, resources
- University profile system (WGU, SNHU, ASU Online, Purdue Global presets)
- AI degree plan parser -- extract courses from screenshots

### Sidebar
- Grouped navigation (Study / Tools sections)
- Compact status bar: active timer + streak at top
- Tooltips in collapsed mode with keyboard shortcuts
- Nav badges (daily task dot, exam score)
- Collapsible media player with genre-aware visualizer

### Quality of Life
- 5 themes: Dark, Light, Warm, Mono, Ocean
- Configurable font scaling (75%-300%, 12px minimum)
- Auto-update from GitHub Releases
- Branded splash screen on startup
- Session restore (last page + window position)
- "What's New" modal after updates
- All data stored locally -- your data stays on your machine
- Auto-backup system with crash recovery

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- npm

### Install

```bash
git clone https://github.com/DevonBoggs/Vorra.git
cd Vorra
npm install
```

Or on Windows, run `setup.bat` for a guided setup.

### Run

**Windows (recommended):**
Double-click `start.bat` -- launches silently with no console window.

**Development mode:**
```bash
npm run electron:dev
```
Starts Vite dev server + Electron with hot reload.

**Production mode:**
```bash
npm run build
npm start
```

### Build Installer

```bash
npm run electron:build
```

Produces a Windows NSIS installer in the `release/` directory.

### AI Provider Setup

Vorra requires an AI provider for study planning, practice exams, and chat. Configure one in **Settings**:

- **Anthropic** (Claude) -- recommended for best tool calling support
- **OpenAI** (GPT-4o, o1) -- excellent alternative
- **Z.AI** (GLM-5.1, GLM-5-Turbo) -- free with Z.AI Coding Plan
- **Groq** (Llama, Mixtral) -- fast and free tier available
- **Local models** -- Ollama, LM Studio, llama.cpp, and more

### YouTube Data API (optional)

Study Radio features like live viewer counts and stream discovery require a YouTube Data API v3 key. Get one free from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), then add it in **Settings > Integrations**.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18 (JSX) |
| Build | Vite 6 |
| Desktop | Electron 35 |
| Styling | Vanilla CSS + inline styles with theme token system |
| Data | SQLite (primary) + localStorage (fallback) |
| Audio | Web Audio API + YouTube IFrame API |
| Platform | Windows (NSIS installer via electron-builder) |

## Project Structure

```
vorra/
├── electron/          # Electron main process
│   ├── main.js        # App shell, local server, IPC, splash screen
│   ├── preload.js     # Context bridge (window.vorra API)
│   ├── database.js    # SQLite wrapper (better-sqlite3)
│   ├── backup.js      # Auto-backup system
│   └── splash.html    # Branded splash screen
├── src/
│   ├── App.jsx        # App shell, sidebar, routing, update banner
│   ├── main.jsx       # React root with error boundary
│   ├── streams.js     # YouTube & SomaFM stream catalog
│   ├── pages/         # Page components (Dashboard, Planner, Daily, etc.)
│   ├── components/    # UI components, icons, widgets, media player
│   ├── systems/       # Core systems (API, storage, timer, audio, etc.)
│   ├── constants/     # Navigation, tools, categories, templates
│   ├── utils/         # Helpers, queue logic, availability calc
│   └── styles/        # Theme tokens, global CSS
├── package.json       # Dependencies + electron-builder config
├── vite.config.js     # Vite build config
├── start.bat          # Silent Windows launcher
├── start.vbs          # VBS launcher (no console)
├── setup.bat          # Windows setup script
└── CLAUDE.md          # Development guide
```

## License

MIT
