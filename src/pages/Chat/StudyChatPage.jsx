// StudyChatPage — AI Study Companion
// Modes: Tutor (Socratic), Quiz, Plan, Coach
// Deep integration with taskQueue, lessonPlan, enrichment data

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { buildSystemPrompt, runAILoop, APP_VERSION, callAIWithTools, continueAfterTools } from "../../systems/api.js";
import { useBgTask, bgSet, bgLog, bgClear, bgAbort, bgStream } from "../../systems/background.js";
import { executeTools, safeArr } from "../../utils/toolExecution.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { uid, todayStr, fileToBase64, diffDays, minsToStr } from "../../utils/helpers.js";
import { getSTATUS_C, STATUS_L } from "../../constants/categories.js";
import { hasCtx } from "../../utils/courseHelpers.js";

// Mode-specific system prompt modifiers
const MODE_PROMPTS = {
  tutor: `MODE: SOCRATIC TUTOR
When a student asks "What is X?" — respond with "What do you already know about X?" FIRST. Only explain after they attempt.
When they give a wrong answer — do NOT say "That's wrong." Instead ask a guiding question with a counterexample.
When they give a right answer — confirm, then deepen: "Can you think of a case where that breaks down?"
Provide ONE concept per message. One idea, one question.
Use analogies from their course context when available.
FRUSTRATION ESCAPE: If the student says "just tell me" or shows frustration (3+ attempts), switch to direct explanation. Say "Let me walk you through this" and explain clearly. Then return to Socratic mode.`,

  quiz: `MODE: QUIZ MASTER
Generate ONE question at a time. Wait for the student's answer before revealing the correct one.
After each answer, explain WHY the answer is right or wrong — reference specific concepts.
Track and report score within the session.
Match the assessment format: OA courses get multiple-choice scenario questions, PA courses get rubric-based analysis prompts.
Adapt difficulty: if they get 3 right in a row, increase difficulty. If they get 2 wrong, go easier.
Tag each question with the competency or topic it tests.`,

  plan: `MODE: STUDY PLANNER
Reference the student's calendar, pace data, task queue, and deadlines.
Suggest specific time blocks and topics based on their schedule.
Use the add_tasks tool to schedule items when the student agrees.
Check feasibility: compare remaining hours vs available time.
For catch-up: provide concrete micro-plans ("study X for 45 min, then Y for 30 min").`,

  coach: `MODE: ACCOUNTABILITY COACH
Be direct but encouraging. Reference actual data: streak, hours studied, pace vs target, completion percentage.
Celebrate specific wins: "You completed 4 tasks yesterday — that's your best day this week."
For setbacks, provide concrete micro-goals for the next 30 minutes, not the next month.
If they're behind, acknowledge it honestly and offer 2-3 specific recovery options.
If they're ahead, encourage continued momentum or suggest a lighter day.
Keep messages short and punchy. No lectures.`,
};

export const StudyChatPage = ({ data, setData, profile, Btn }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  const [selCourse, setSelCourse] = useState(data.courses?.[0]?.id || "");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatAbort, setChatAbort] = useState(null);
  const [imgFile, setImgFile] = useState(null);
  const [imgPrev, setImgPrev] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [chatMode, setChatMode] = useState('tutor'); // 'tutor' | 'quiz' | 'plan' | 'coach'
  const [concise, setConcise] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const messagesEnd = useRef(null);
  const fileRef = useRef(null);

  const course = data.courses?.find(c => c.id === selCourse);
  const chatKey = selCourse || "_general";
  const messages = data.chatHistories?.[chatKey] || [];
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const handleImg = (e) => {
    const f = e.target.files?.[0]; if (!f) return; setImgFile(f);
    const r = new FileReader(); r.onload = () => setImgPrev(r.result); r.readAsDataURL(f);
    e.target.value = '';
  };

  const stopChat = () => { if (chatAbort) { chatAbort.abort(); setChatAbort(null); setLoading(false); toast("Stopped", "info"); } };

  // ── Build rich context ──
  const buildContext = () => {
    // Course context
    let courseCtx = "No specific course selected — general study help.";
    if (course) {
      courseCtx = `Active course: ${course.name} (${course.courseCode || "no code"})
Credits: ${course.credits} CU | Difficulty: ${course.difficulty}/5 | Status: ${course.status} | Assessment: ${course.assessmentType || "unknown"}`;
      if (safeArr(course.topicBreakdown).length > 0) courseCtx += `\nTopics: ${safeArr(course.topicBreakdown).map(t => `${t.topic} (${t.weight || "?"})`).join(", ")}`;
      if (safeArr(course.competencies).length > 0) courseCtx += `\nCompetencies: ${safeArr(course.competencies).map(c => `${c.code || ""} ${c.title} (${c.weight || "?"})`).join("; ")}`;
      if (safeArr(course.examTips).length > 0) courseCtx += `\nExam tips: ${safeArr(course.examTips).slice(0, 5).join("; ")}`;
      if (safeArr(course.knownFocusAreas).length > 0) courseCtx += `\nFocus areas: ${safeArr(course.knownFocusAreas).join(", ")}`;
      // NEW: Deep enrichment fields
      if (course.studyStrategy) courseCtx += `\nStudy strategy: ${course.studyStrategy}`;
      if (safeArr(course.quickWins).length > 0) courseCtx += `\nQuick wins: ${safeArr(course.quickWins).join("; ")}`;
      if (safeArr(course.hardestConcepts).length > 0) courseCtx += `\nHardest concepts: ${safeArr(course.hardestConcepts).join("; ")}`;
      if (safeArr(course.mnemonics).length > 0) courseCtx += `\nMnemonics: ${safeArr(course.mnemonics).map(m => `${m.concept}: ${m.mnemonic}`).join("; ")}`;
      if (course.instructorTips) courseCtx += `\nInstructor tips: ${course.instructorTips}`;
      if (course.communityInsights) courseCtx += `\nCommunity insights: ${course.communityInsights}`;
      if (course.preAssessmentScore != null) courseCtx += `\nPre-assessment score: ${course.preAssessmentScore}%`;
      if (safeArr(course.preAssessmentWeakAreas).length > 0) courseCtx += `\nWeak areas (pre-assessment): ${safeArr(course.preAssessmentWeakAreas).join(", ")}`;
      if (course.examDate) courseCtx += `\nExam date: ${course.examDate} (${Math.max(0, diffDays(todayStr(), course.examDate))} days away)`;
      // Study progress from sessions
      const courseStudiedMins = (data.studySessions || []).filter(s => s.course === course.name).reduce((s, x) => s + (x.mins || 0), 0);
      const courseEstHrs = course.averageStudyHours || 0;
      if (courseEstHrs > 0) courseCtx += `\nStudy progress: ${Math.round(courseStudiedMins / 6) / 10}h / ~${courseEstHrs}h (${Math.round(courseStudiedMins / 60 / courseEstHrs * 100)}%)`;
    }

    // Task queue context
    const queue = data.taskQueue || [];
    let queueCtx = '';
    if (queue.length > 0) {
      const studyTasks = queue.filter(t => t.category !== 'break');
      const doneTasks = studyTasks.filter(t => t.done);
      const remainMins = studyTasks.filter(t => !t.done).reduce((s, t) => s + (t.estimatedMins || 60), 0);
      const nextTasks = queue.filter(t => !t.done && t.category !== 'break').slice(0, 3);
      queueCtx = `\n\nSTUDY PLAN QUEUE:
Progress: ${doneTasks.length}/${studyTasks.length} tasks complete (~${Math.round(remainMins / 60)}h remaining)`;
      if (nextTasks.length > 0) queueCtx += `\nNext up: ${nextTasks.map(t => `${t.title} (${minsToStr(t.estimatedMins || 60)})`).join(', ')}`;
      // Per-course queue progress
      const courseQ = {};
      for (const t of studyTasks) {
        const k = t.course_code || 'Other';
        if (!courseQ[k]) courseQ[k] = { total: 0, done: 0 };
        courseQ[k].total++;
        if (t.done) courseQ[k].done++;
      }
      queueCtx += `\nPer-course: ${Object.entries(courseQ).map(([k, v]) => `${k}: ${v.done}/${v.total}`).join(', ')}`;
    }

    // Lesson plan context
    let lpCtx = '';
    if (data.lessonPlan?.courses?.length > 0 && course) {
      const lpc = data.lessonPlan.courses.find(c => (c.course_code || '').toUpperCase() === (course.courseCode || '').toUpperCase());
      if (lpc?.units?.length > 0) {
        lpCtx = `\n\nLESSON PLAN for ${lpc.course_code} (${lpc.units.length} units, ${lpc.total_hours}h):`;
        lpCtx += `\n${lpc.units.map(u => `U${u.unit_number}: ${u.title} (${u.hours}h, ${u.type})`).join('\n')}`;
      }
    }

    // Calendar context
    const today = todayStr();
    const todayTasks = safeArr(data.tasks?.[today]);
    let calCtx = `\n\nCALENDAR: Today (${today}): ${todayTasks.length} tasks, ${todayTasks.filter(t => t.done).length} done`;

    // Session history
    const sessions = data.studySessions || [];
    const totalStudiedMins = sessions.reduce((s, x) => s + (x.mins || 0), 0);
    const streak = data.studyStreak || { currentStreak: 0, longestStreak: 0 };
    let sessionCtx = `\n\nSTUDY STATS: Total: ${Math.round(totalStudiedMins / 6) / 10}h | Streak: ${streak.currentStreak}d (best: ${streak.longestStreak}d)`;

    // Planner context
    const pc = data.plannerConfig;
    if (pc) {
      sessionCtx += `\nStudy mode: ${pc.studyMode || 'sequential'} | Pacing: ${pc.pacingStyle || 'steady'}`;
    }

    return courseCtx + queueCtx + lpCtx + calCtx + sessionCtx;
  };

  const sendMessage = async (overrideMsg) => {
    if (loading) { stopChat(); return; }
    const msg = overrideMsg || input.trim();
    if ((!msg && !imgFile) || !profile) return;
    const controller = new AbortController();
    setChatAbort(controller);
    if (!overrideMsg) setInput("");

    const displayMsg = { role: "user", content: msg, hasImage: !!imgFile };
    const newMsgs = [...messages, displayMsg];
    setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: newMsgs } }));
    setLoading(true);

    const context = buildContext();
    const modePrompt = MODE_PROMPTS[chatMode] || MODE_PROMPTS.tutor;
    const conciseRule = concise ? '\n\nRESPONSE STYLE: Be brief. 2-3 sentences max unless the student asks for more. Use bullet points. Skip preamble and filler.' : '';

    const sys = `${buildSystemPrompt(data, context)}

${modePrompt}
${conciseRule}

CONTEXT-AWARE GUIDANCE:
- Reference the student's actual progress and schedule when relevant.
- If they're behind on pace, acknowledge it and help them prioritize.
- Celebrate streaks and milestones — motivation matters.
- Keep responses focused and actionable.`;

    const apiMsgs = newMsgs.filter(m => m.role === "user" || m.role === "assistant").slice(-30).map(m => ({ role: m.role, content: m.content }));

    let imageData = null;
    if (imgFile) {
      const b64 = await fileToBase64(imgFile);
      imageData = { type: imgFile.type, data: b64 };
      setImgFile(null); setImgPrev(null);
    }

    try {
      let resp = await callAIWithTools(profile, sys, apiMsgs, imageData);
      let fullText = "";
      let maxLoops = 5;
      while (maxLoops-- > 0) {
        if (controller.signal.aborted) break;
        if (resp.text) fullText += (fullText ? " " : "") + resp.text;
        if (resp.toolCalls.length > 0) {
          const results = executeTools(resp.toolCalls, data, setData);
          const toolSummary = results.map(r => `[${r.result}]`).join(" ");
          fullText += (fullText ? "\n\n" : "") + toolSummary;
          resp = await continueAfterTools(profile, sys, apiMsgs, resp.toolCalls, results);
        } else break;
      }
      if (resp.text && !fullText.includes(resp.text)) fullText += (fullText ? "\n\n" : "") + resp.text;

      const withReply = [...newMsgs, { role: "assistant", content: fullText }];
      setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: withReply } }));
    } catch (e) {
      if (e.name !== 'AbortError') setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: [...newMsgs, { role: "assistant", content: `Error: ${e.message}` }] } }));
    }
    setLoading(false);
    setChatAbort(null);
  };

  // Compact/condense chat — summarize older messages to reduce context size
  const [compacting, setCompacting] = useState(false);
  const compactChat = async () => {
    if (!profile || messages.length < 6) { toast('Not enough messages to compact', 'info'); return; }
    setCompacting(true);
    try {
      const transcript = messages.map(m => `${m.role === 'user' ? 'Student' : 'AI'}: ${m.content}`).join('\n\n');
      const compactSys = `You are summarizing a study chat conversation. Create a concise summary that preserves:
1. Key topics discussed and concepts explained
2. Questions the student asked and whether they were resolved
3. Any weak areas or misconceptions identified
4. Quiz scores or practice results if any
5. Any action items or scheduled tasks
6. The student's current understanding level on topics discussed

Format as a structured summary the AI can use as context for continuing the conversation. Be thorough but concise.`;

      const resp = await callAIWithTools(profile, compactSys, [{ role: 'user', content: `Summarize this study chat conversation:\n\n${transcript}` }]);
      const summary = resp.text || 'Chat summary unavailable.';

      // Replace all messages with a summary message + keep the last 4 messages for immediate context
      const recentMessages = messages.slice(-4);
      const compactedHistory = [
        { role: 'assistant', content: `**Chat Compacted** — ${messages.length} messages condensed into a summary.\n\n---\n\n**Summary of prior conversation:**\n${summary}\n\n---\n*${messages.length - recentMessages.length} older messages were compacted. Recent messages preserved below.*` },
        ...recentMessages,
      ];
      setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: compactedHistory } }));
      toast(`Compacted ${messages.length} messages → ${compactedHistory.length}`, 'success');
    } catch (e) {
      toast(`Compact failed: ${e.message}`, 'error');
    }
    setCompacting(false);
  };

  // Estimate context size in tokens (~4 chars per token is the standard approximation)
  const contextTokens = useMemo(() => {
    const totalChars = messages.reduce((s, m) => s + (m.content || '').length, 0);
    return Math.round(totalChars / 4);
  }, [messages]);
  const contextTokensK = Math.round(contextTokens / 100) / 10; // e.g. 12.3k

  // Export
  const exportChat = () => {
    const md = messages.map(m => `**${m.role === "user" ? "You" : "AI"}:** ${m.content}`).join("\n\n---\n\n");
    const header = `# Study Chat — ${course ? course.name : "General"}\nExported: ${new Date().toLocaleString()}\nMessages: ${messages.length}\n\n---\n\n`;
    const blob = new Blob([header + md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `vorra-chat-${chatKey}-${todayStr()}.md`; a.click();
    URL.revokeObjectURL(url); toast("Chat exported", "success");
  };

  // Markdown rendering
  const renderMd = (text) => {
    if (!text) return null;
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```")) {
        const code = part.replace(/^```\w*\n?/, "").replace(/```$/, "");
        return <pre key={i} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", fontSize: fs(11), fontFamily: "'JetBrains Mono',monospace", overflow: "auto", margin: "6px 0", whiteSpace: "pre-wrap" }}>{code}</pre>;
      }
      const escaped = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;font-size:12px;font-family:JetBrains Mono,monospace">$1</code>');
      return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
    });
  };

  // Search
  const filteredMessages = useMemo(() => {
    if (!searchQ) return messages;
    const q = searchQ.toLowerCase();
    return messages.filter(m => (m.content || '').toLowerCase().includes(q));
  }, [messages, searchQ]);

  // Quick actions by mode
  const quickActions = useMemo(() => {
    if (!course) return [
      { label: "What should I study?", prompt: "Based on my progress and schedule, what should I focus on right now?" },
      { label: "Am I on track?", prompt: "Look at my study pace and schedule. Am I on track to finish on time?" },
      { label: "Plan my week", prompt: "Help me plan my study schedule for this week." },
      { label: "Priority order", prompt: "What order should I study my courses in and why?" },
    ];
    const name = course.name;
    const actions = {
      tutor: [
        { label: "Explain key concepts", prompt: `What are the most important concepts in ${name}? Help me understand them.` },
        { label: "Simplify hardest topic", prompt: `What's the hardest topic in ${name}? Explain it with a simple analogy.` },
        { label: "Compare & contrast", prompt: `What are the most confused concepts in ${name}? Show me the differences.` },
        { label: "Memory tricks", prompt: `Give me mnemonics for the hardest facts in ${name}.` },
        { label: "Real-world examples", prompt: `Give me real-world examples for each major concept in ${name}.` },
      ],
      quiz: [
        { label: "Quiz me (5 Q)", prompt: `Give me 5 practice questions for ${name}. Wait for my answer before revealing the correct one.` },
        { label: "Scenario question", prompt: `Give me an application-level scenario question for ${name} matching the assessment format.` },
        { label: "Rapid fire", prompt: `Ask me 10 rapid-fire questions about ${name}. Grade me at the end.` },
        { label: "Weak area drill", prompt: `Quiz me specifically on my weak areas in ${name}: ${safeArr(course.preAssessmentWeakAreas).join(', ') || 'the hardest topics'}.` },
        { label: "True or false", prompt: `Give me 10 true/false statements about ${name}. Include common misconceptions.` },
      ],
      plan: [
        { label: "What's next?", prompt: "Based on my task queue and progress, what should I study next?" },
        { label: "Am I on track?", prompt: "Am I on track to finish on time? What adjustments should I make?" },
        { label: "Optimize my week", prompt: "Look at my schedule. Are there gaps? Am I spending too much time on anything?" },
        { label: "Catch-up plan", prompt: "I've fallen behind. Give me a concrete catch-up plan for the next 3 days." },
      ],
      coach: [
        { label: "Check my progress", prompt: "Give me honest, data-driven feedback on my study progress." },
        { label: "Motivate me", prompt: `I'm losing motivation on ${name}. Give me a concrete micro-goal for the next 30 minutes.` },
        { label: "I'm stuck", prompt: `I'm stuck on ${name} and frustrated. Help me break through with a different angle.` },
        { label: "Celebrate wins", prompt: "What have I accomplished recently? Remind me how far I've come." },
      ],
    };
    return actions[chatMode] || actions.tutor;
  }, [course, chatMode]);

  // Session divider check
  const getSessionDivider = (idx) => {
    if (idx === 0) return null;
    const prev = messages[idx - 1];
    const curr = messages[idx];
    // Simple heuristic: if there's a gap in messages (checked via content patterns)
    // For now, just show divider at the start of the conversation
    return null;
  };

  // Follow-up suggestions based on last AI message
  const followUpSuggestions = useMemo(() => {
    if (messages.length === 0 || loading) return [];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return [];
    const base = chatMode === 'quiz'
      ? [{ label: "Next question", prompt: "Give me another question." }, { label: "Explain that answer", prompt: "Explain why that answer is correct in more detail." }]
      : chatMode === 'tutor'
      ? [{ label: "Tell me more", prompt: "Can you explain that in more detail?" }, { label: "Give an example", prompt: "Can you give me a concrete example?" }, { label: "Quiz me on this", prompt: "Quiz me on what we just discussed." }]
      : chatMode === 'coach'
      ? [{ label: "What's my next step?", prompt: "What should I do right now?" }, { label: "Set a goal", prompt: "Set me a specific study goal for today." }]
      : [{ label: "Add to queue", prompt: "Add that to my study tasks." }, { label: "Show my schedule", prompt: "Show me what's on my schedule this week." }];
    return base;
  }, [messages, loading, chatMode]);

  // Course progress for context bar
  const courseProgress = useMemo(() => {
    if (!course) return null;
    const queue = data.taskQueue || [];
    const code = (course.courseCode || '').toUpperCase();
    const total = queue.filter(t => (t.course_code || '').toUpperCase() === code && t.category !== 'break').length;
    const done = queue.filter(t => (t.course_code || '').toUpperCase() === code && t.done && t.category !== 'break').length;
    return total > 0 ? { total, done, pct: Math.round(done / total * 100) } : null;
  }, [course, data.taskQueue]);

  const modeColors = { tutor: T.blue, quiz: T.purple, plan: T.accent, coach: '#f59e0b' };
  const modeIcons = { tutor: '📚', quiz: '🎯', plan: '📅', coach: '💪' };
  const modeLabels = { tutor: 'Tutor', quiz: 'Quiz', plan: 'Plan', coach: 'Coach' };

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: fs(22), fontWeight: 800, marginBottom: 1 }}>Study Chat</h1>
          <p style={{ color: T.dim, fontSize: fs(10), margin: 0 }}>AI study companion · {modeLabels[chatMode]} mode</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select value={selCourse} onChange={e => setSelCourse(e.target.value)} style={{ width: 200, fontSize: fs(11), padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
            <option value="">General Help</option>
            {(data.courses || []).map(c => <option key={c.id} value={c.id}>{c.courseCode ? `${c.courseCode} — ` : ''}{c.name} {hasCtx(c) ? "✓" : ""}</option>)}
          </select>
          {messages.length > 0 && <Btn small v="ghost" onClick={exportChat} title="Export chat as markdown">📋</Btn>}
          {messages.length >= 6 && <Btn small v="ghost" onClick={compactChat} disabled={compacting} title={`Condense ${messages.length} messages into a summary to reduce context size (~${contextTokensK}k tokens). Keeps the last 4 messages.`}>{compacting ? '⏳' : '⚡'} Compact</Btn>}
          <Btn small v="ghost" onClick={() => setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: [] } }))} title="Clear all messages">Clear</Btn>
        </div>
      </div>

      {/* Mode selector + concise toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', background: T.input, borderRadius: 8, padding: 2, flex: '0 0 auto' }}>
          {Object.entries(modeLabels).map(([key, label]) => (
            <button key={key} onClick={() => setChatMode(key)} style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: chatMode === key ? modeColors[key] : 'transparent',
              color: chatMode === key ? '#fff' : T.soft,
              fontWeight: chatMode === key ? 700 : 500, fontSize: fs(10), transition: 'all .12s',
            }}>{modeIcons[key]} {label}</button>
          ))}
        </div>
        <button onClick={() => setConcise(!concise)} title={concise ? 'Concise mode: AI gives short, bullet-point answers (2-3 sentences). Click to switch to detailed responses.' : 'Detailed mode: AI gives full explanations with examples and context. Click to switch to concise, brief answers.'} style={{
          padding: '5px 12px', borderRadius: 6, fontSize: fs(9), cursor: 'pointer',
          border: `1px solid ${concise ? T.accent : T.border}`, background: concise ? T.accentD : 'transparent',
          color: concise ? T.accent : T.dim, fontWeight: 600,
        }}>{concise ? 'Concise' : 'Detailed'}</button>
      </div>

      {/* Enhanced context bar */}
      {course && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 14px', marginBottom: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: fs(12), fontWeight: 700, color: T.text }}>{course.courseCode || ''} {course.name}</span>
            <Badge color={STATUS_C[course.status] || T.dim} bg={(STATUS_C[course.status] || T.dim) + "22"}>{STATUS_L[course.status] || course.status}</Badge>
            {course.assessmentType && <Badge color={T.blue} bg={T.blueD}>{course.assessmentType}</Badge>}
            {course.examDate && <Badge color={T.red} bg={`${T.red}22`}>{Math.max(0, diffDays(todayStr(), course.examDate))}d to exam</Badge>}
            {courseProgress && <span style={{ fontSize: fs(9), color: T.dim, marginLeft: 'auto' }}>{courseProgress.pct}% · {courseProgress.done}/{courseProgress.total} tasks</span>}
          </div>
          {/* Progress bar */}
          {courseProgress && (
            <div style={{ height: 3, borderRadius: 2, background: T.input, overflow: 'hidden', marginTop: 4 }}>
              <div style={{ height: '100%', width: `${courseProgress.pct}%`, background: T.accent, borderRadius: 2, transition: 'width .3s' }} />
            </div>
          )}
          {/* Weak areas */}
          {safeArr(course.preAssessmentWeakAreas).length > 0 && (
            <div style={{ fontSize: fs(9), color: T.orange, marginTop: 4 }}>Weak areas: {safeArr(course.preAssessmentWeakAreas).join(', ')}</div>
          )}
          {/* Expandable context drawer */}
          <button onClick={() => setShowContext(!showContext)} style={{ background: 'none', border: 'none', color: T.dim, fontSize: fs(8), cursor: 'pointer', marginTop: 2, padding: 0 }}>
            {showContext ? '▾ Hide AI context' : '▸ What the AI knows'}
          </button>
          {showContext && (
            <div style={{ fontSize: fs(9), color: T.dim, marginTop: 4, padding: '6px 8px', background: T.bg2, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 150, overflowY: 'auto', lineHeight: 1.4 }}>
              {buildContext()}
            </div>
          )}
        </div>
      )}

      {!profile && <div style={{ padding: "40px 0", textAlign: "center", color: T.dim }}><p style={{ fontSize: fs(13) }}>Connect an AI profile in Settings to start chatting.</p></div>}

      {/* Context size warning */}
      {contextTokens > 64000 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', marginBottom: 6, borderRadius: 8, background: contextTokens > 200000 ? `${T.red}15` : `${T.orange}15`, border: `1px solid ${contextTokens > 200000 ? T.red : T.orange}33`, flexShrink: 0 }}>
          <span style={{ fontSize: fs(10), color: contextTokens > 200000 ? T.red : T.orange, fontWeight: 600 }}>
            {contextTokens > 200000 ? '⚠️' : '💡'} Chat context: ~{contextTokensK}k tokens ({messages.length} messages)
            {contextTokens > 200000 ? ' — context is very large, responses may degrade.' : ' — consider compacting to keep responses sharp.'}
          </span>
          <button onClick={compactChat} disabled={compacting} style={{ padding: '3px 10px', borderRadius: 5, border: `1px solid ${T.accent}`, background: T.accentD, color: T.accent, fontSize: fs(9), cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
            {compacting ? 'Compacting...' : '⚡ Compact now'}
          </button>
        </div>
      )}

      {/* Search */}
      {profile && messages.length > 3 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexShrink: 0 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '0 10px', gap: 6 }}>
            <Ic.IcSearch s={12} c={T.dim} />
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search messages..." style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: T.text, fontSize: fs(11), padding: '6px 0' }} />
            {searchQ && <button onClick={() => setSearchQ('')} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer' }}><Ic.X s={10} /></button>}
          </div>
        </div>
      )}

      {/* Messages */}
      {profile && <div style={{ flex: 1, overflowY: "auto", marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ padding: "16px 0", color: T.dim }}>
            <p style={{ marginBottom: 12, textAlign: "center", fontSize: fs(13) }}>
              {chatMode === 'quiz' ? `Ready to test your knowledge on ${course?.name || 'your courses'}?` :
               chatMode === 'plan' ? 'Let me help you plan your study schedule.' :
               chatMode === 'coach' ? 'Let me check your progress and keep you on track.' :
               `Ask about ${course ? course.name : "anything"}.`}
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              {quickActions.map((q, i) => (
                <button key={i} onClick={() => sendMessage(q.prompt)} style={{
                  background: T.input, border: `1px solid ${modeColors[chatMode]}33`, borderRadius: 8,
                  padding: "8px 14px", color: T.soft, fontSize: fs(11), cursor: "pointer", fontWeight: 500,
                  transition: 'all .12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = modeColors[chatMode]; e.currentTarget.style.color = T.text; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${modeColors[chatMode]}33`; e.currentTarget.style.color = T.soft; }}
                >{q.label}</button>
              ))}
            </div>
          </div>
        )}
        {filteredMessages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "78%", padding: "10px 14px", borderRadius: 12, fontSize: fs(13), lineHeight: 1.6,
              background: m.role === "user" ? T.accent : T.card,
              color: m.role === "user" ? "#060e09" : T.text,
              border: m.role === "user" ? "none" : `1px solid ${T.border}`, whiteSpace: "pre-wrap",
            }}>
              {m.hasImage && <span style={{ fontSize: fs(10), opacity: .7 }}>📷 Image attached<br /></span>}
              {m.role === "assistant" ? renderMd(m.content) : m.content}
            </div>
          </div>
        ))}
        {/* "Just tell me" escape in Tutor mode */}
        {chatMode === 'tutor' && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !loading && messages[messages.length - 1]?.content?.includes('?') && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: -4 }}>
            <button onClick={() => sendMessage("Just tell me the answer directly.")} style={{
              padding: '4px 12px', borderRadius: 12, border: `1px solid ${T.border}`,
              background: T.input, color: T.dim, fontSize: fs(9), cursor: 'pointer',
            }}>Just tell me</button>
          </div>
        )}
        {loading && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", color: modeColors[chatMode], fontSize: fs(12) }}>
          <Ic.Spin s={14} />
          {chatMode === 'quiz' ? 'Preparing question...' : chatMode === 'plan' ? 'Checking your schedule...' : chatMode === 'coach' ? 'Analyzing your progress...' : 'Thinking...'}
        </div>}
        <div ref={messagesEnd} />
      </div>}

      {/* Follow-up suggestion chips */}
      {profile && followUpSuggestions.length > 0 && messages.length > 0 && !loading && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0, marginBottom: 6, overflowX: "auto", paddingBottom: 2 }}>
          {followUpSuggestions.map((q, i) => (
            <button key={i} onClick={() => sendMessage(q.prompt)} style={{
              background: T.input, border: `1px solid ${modeColors[chatMode]}33`, borderRadius: 7,
              padding: "5px 12px", color: T.dim, fontSize: fs(10), cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
            }}>{q.label}</button>
          ))}
        </div>
      )}

      {/* Image preview */}
      {imgPrev && <div style={{ padding: "4px 0", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <img src={imgPrev} style={{ height: 40, borderRadius: 6, border: `1px solid ${T.border}` }} alt="upload" />
        <span style={{ fontSize: fs(9), color: T.soft }}>{imgFile?.name}</span>
        <button onClick={() => { setImgFile(null); setImgPrev(null); }} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer" }}><Ic.X s={12} /></button>
      </div>}

      {/* Input bar */}
      {profile && <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button onClick={() => fileRef.current?.click()} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: "0 12px", cursor: "pointer", color: T.soft, display: "flex", alignItems: "center" }}><Ic.Img s={14} /></button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImg} />
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()} placeholder={`${chatMode === 'quiz' ? 'Answer or ask for a question' : chatMode === 'plan' ? 'Ask about scheduling' : chatMode === 'coach' ? 'Check in on progress' : `Ask about ${course ? course.name : "studying"}`}...`} style={{ flex: 1, padding: "10px 14px", fontSize: fs(13), borderRadius: 8, border: `1px solid ${T.border}`, background: T.input, color: T.text }} />
        <Btn onClick={() => sendMessage()} disabled={!loading && (!input.trim() && !imgFile)} style={{ padding: "10px 18px", background: loading ? T.red : modeColors[chatMode] }}>{loading ? <span style={{ fontSize: fs(11), fontWeight: 700 }}>Stop</span> : <Ic.Send s={14} />}</Btn>
      </div>}
      <div style={{ fontSize: fs(8), color: T.dim, textAlign: "center", padding: "3px 0 0", flexShrink: 0 }}>AI responses are not a substitute for your course materials or instructor.</div>
    </div>
  );
};

export default StudyChatPage;
