# DevonSYNC

**AI-powered WGU Study Planner** — A desktop app for managing courses, study plans, practice exams, and focus sessions.

Built with React, Electron, and Vite. Runs entirely offline with localStorage — no backend required.

## Features

### Course Management
- Track 35+ fields per course (credits, difficulty, topics, competencies, exam tips)
- AI-powered degree plan parser — drag in a screenshot and extract courses automatically
- Drag-and-drop reordering with priority-based scheduling

### AI Study Planning
- Multi-step AI workflow: set target date, study hours, exception days — AI generates an optimized task schedule
- Supports 25+ AI providers: Anthropic, OpenAI, Google Gemini, DeepSeek, Groq, Ollama, LM Studio, and more
- Multiple AI profiles with custom endpoints for proxies and local models

### Practice Exams
- AI-generated multiple choice exams weighted by topic importance
- Configurable difficulty and question count
- Timed exam simulation with real-time scoring and explanations

### Study Radio
- 44 SomaFM stations + 541 YouTube streams across 56 categories
- Multi-stream playback (up to 4 simultaneous YouTube streams)
- 24-bar dual-source audio visualizer
- Custom stream support and YouTube search discovery

### Study Tracking
- Daily task management with Pomodoro timer integration
- Monthly calendar view with task visualization
- Weekly analytics: completion rates, scheduled vs. actual hours, streaks
- Focus Pulse check-ins during study sessions

### AI Tutor Chat
- Course-aware chat with full context (topics, competencies, progress)
- Image upload for OCR and visual explanations
- Per-course conversation history

### Data & Customization
- 5 themes: Dark, Light, Warm, Mono, Ocean
- CSV and JSON import/export
- All data stored locally — your data stays on your machine

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- npm

### Install

```bash
git clone https://github.com/DevonBoggs/devonsync-app.git
cd devonsync-app
npm install
```

### Development

```bash
npm run electron:dev
```

This starts the Vite dev server and Electron together with hot reload.

### Build

```bash
npm run electron:build
```

Produces a Windows installer in the `release/` directory.

### Optional: YouTube Data API

Study Radio features like live stats, viewer counts, and stream discovery require a YouTube Data API v3 key. Get one free from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), then add it in **Settings > Integrations**.

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 18 (JSX) |
| Build | Vite 6 |
| Desktop | Electron 35 |
| Styling | Vanilla CSS with theme tokens |
| Data | localStorage |
| Platform | Windows (NSIS installer) |

## License

MIT
