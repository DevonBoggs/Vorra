// PracticeExamPage — Competency-Based Exam Prep
// Test Mode (simulates real exam) + Study Mode (learn as you go)
// Per-competency scoring, FSRS integration, adaptive difficulty, question navigation

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, uid, minsToStr, diffDays } from "../../utils/helpers.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { buildSystemPrompt, callAIWithTools, isAnthProvider, getAuthHeaders, setApiStatus } from "../../systems/api.js";
import { safeArr } from "../../utils/toolExecution.js";
import { Badge } from "../../components/ui/Badge.jsx";

const PRESETS = {
  quick: { label: 'Quick Check', count: 10, mins: 15 },
  practice: { label: 'Practice Set', count: 25, mins: 40 },
  full: { label: 'Full Simulation', count: 50, mins: 90 },
  custom: { label: 'Custom', count: 10, mins: 0 },
};

const PracticeExamPage = ({ data, setData, profile, Btn, Label }) => {
  const T = useTheme();
  const bp = useBreakpoint();

  // Config state
  const [selCourse, setSelCourse] = useState(data.courses?.[0]?.id || "");
  const [examMode, setExamMode] = useState('test'); // 'test' | 'study'
  const [preset, setPreset] = useState('quick');
  const [count, setCount] = useState(10);
  const [customCount, setCustomCount] = useState(15);
  const [customMins, setCustomMins] = useState(30);
  const [difficulty, setDifficulty] = useState('adaptive');
  const [focusArea, setFocusArea] = useState('all'); // 'all' | 'weak' | specific topic
  const [showAnswers, setShowAnswers] = useState(false); // post-exam answer reveal toggle

  // Restore active exam from persisted state (survives page navigation)
  const saved = data.activeExam;
  const [questions, setQuestions] = useState(saved?.questions || []);
  const [answers, setAnswers] = useState(saved?.answers || {});
  const [flagged, setFlagged] = useState(saved?.flagged || {});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [examAbort, setExamAbort] = useState(null);
  const [examTime, setExamTime] = useState(saved?.examTime || 0);
  const [timerActive, setTimerActive] = useState(!!saved?.questions?.length);
  const [currentQ, setCurrentQ] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showPreSubmit, setShowPreSubmit] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('all');
  const [reviewingExam, setReviewingExam] = useState(null);
  const timerRef = useRef(null);
  const qRefs = useRef({});

  // Restore course selection from saved exam
  useEffect(() => {
    if (saved?.courseId && saved.courseId !== selCourse) setSelCourse(saved.courseId);
    if (saved?.examMode) setExamMode(saved.examMode);
  }, []);

  // Persist exam state whenever it changes (survives navigation)
  useEffect(() => {
    if (questions.length > 0 && !submitted) {
      setData(d => ({ ...d, activeExam: { courseId: selCourse, questions, answers, flagged, examTime, examMode, startedAt: saved?.startedAt || new Date().toISOString() } }));
    } else if (submitted || questions.length === 0) {
      if (data.activeExam) setData(d => ({ ...d, activeExam: null }));
    }
  }, [questions, answers, flagged, examTime, submitted]);

  const course = data.courses?.find(c => c.id === selCourse);
  const hasExam = questions.length > 0;

  // Timer
  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => setExamTime(t => t + 1), 1000);
      return () => clearInterval(timerRef.current);
    } else clearInterval(timerRef.current);
  }, [timerActive]);

  // Preset sync
  useEffect(() => {
    if (preset === 'custom') { setCount(customCount); }
    else if (PRESETS[preset]) { setCount(PRESETS[preset].count); }
  }, [preset, customCount]);

  // Adaptive difficulty from history
  const adaptiveDifficulty = useMemo(() => {
    if (difficulty !== 'adaptive') return difficulty;
    const history = (data.examHistory || []).filter(h => h.courseId === selCourse);
    if (history.length === 0) return 'mixed';
    const avg = history.slice(-3).reduce((s, h) => s + h.score, 0) / Math.min(3, history.length);
    if (avg >= 0.85) return 'hard';
    if (avg >= 0.65) return 'mixed';
    return 'easy';
  }, [data.examHistory, selCourse, difficulty]);

  // Exam readiness from history
  const readiness = useMemo(() => {
    const history = (data.examHistory || []).filter(h => h.courseId === selCourse);
    if (history.length === 0) return null;
    const recent = history.slice(-5);
    const avg = Math.round(recent.reduce((s, h) => s + h.score, 0) / recent.length * 100);
    return avg;
  }, [data.examHistory, selCourse]);

  const stopExam = () => { if (examAbort) { examAbort.abort(); setExamAbort(null); setLoading(false); toast("Cancelled", "info"); } };

  const generateExam = async () => {
    if (!profile || !course) return;
    const controller = new AbortController();
    setExamAbort(controller);
    setLoading(true); setSubmitted(false); setAnswers({}); setFlagged({}); setExamTime(0); setCurrentQ(0); setShowFeedback(false); setShowPreSubmit(false); setReviewFilter('all');
    // Persist generation state so sidebar can show it
    setData(d => ({ ...d, examGenerating: { courseId: selCourse, courseName: course?.name, startedAt: new Date().toISOString() } }));
    toast("Generating practice exam...", "info");

    const diff = adaptiveDifficulty;
    const diffPrompt = diff === 'easy' ? 'Make questions introductory-level (recall and basic understanding).' : diff === 'hard' ? 'Make questions challenging — edge cases, deep analysis, scenario-based application.' : 'Mix 30% easy (recall), 50% medium (application), 20% hard (analysis/edge cases).';

    // Focus area targeting
    let focusPrompt = '';
    if (focusArea === 'weak') {
      const weakAreas = safeArr(course.preAssessmentWeakAreas);
      const historyWeak = []; // TODO: from past exam topicScores
      const allWeak = [...new Set([...weakAreas, ...historyWeak])];
      if (allWeak.length > 0) focusPrompt = `\nFOCUS: Weight 70% of questions toward these weak areas: ${allWeak.join(', ')}. The student needs extra practice here.`;
    } else if (focusArea !== 'all') {
      focusPrompt = `\nFOCUS: Generate questions ONLY about: ${focusArea}`;
    }

    const examPrompt = `Generate exactly ${count} practice exam questions for: ${course.name}.

${safeArr(course.topicBreakdown).length > 0 ? `Topics (weight by importance): ${safeArr(course.topicBreakdown).map(t => `${t.topic} (${t.weight || '?'})`).join(', ')}` : ''}
${safeArr(course.competencies).length > 0 ? `Competencies: ${safeArr(course.competencies).slice(0, 12).map(c => `${c.code || ''} ${c.title} (${c.weight || '?'})`).join('; ')}` : ''}
${safeArr(course.knownFocusAreas).length > 0 ? `High-weight areas: ${safeArr(course.knownFocusAreas).join(', ')}` : ''}
${safeArr(course.commonMistakes).length > 0 ? `Common mistakes: ${safeArr(course.commonMistakes).slice(0, 5).join('; ')}` : ''}
${['OA', 'OA+PA', 'Exam', 'Mixed'].includes(course.assessmentType) ? 'Model questions after proctored exam format — scenario-based, application-level. Include some "Select all that apply" questions.' : ''}
${diffPrompt}
${focusPrompt}

QUESTION TYPES TO INCLUDE:
- Multiple choice (single answer, 4 options) — majority of questions
- Multi-select ("Select ALL that apply", 4-6 options, 2+ correct) — include 2-4 of these
- Scenario-based (present a real-world situation, then ask a question) — include at least 2

FOR EACH QUESTION, include:
- "question": the question text
- "type": "single" or "multi-select"
- "options": array of answer choices (4 for single, 4-6 for multi-select)
- "correct": for single = index (0-based), for multi-select = array of correct indices
- "explanation": WHY the correct answer is right and WHY the most common wrong answer is wrong
- "topic": which topic/subject area this tests (match course topics above)
- "competency": which competency code this tests (if available)
- "difficulty": "easy" | "medium" | "hard"

Respond ONLY with a JSON array. No markdown, no backticks, no preamble.`;

    const sys = buildSystemPrompt(data, examPrompt);
    try {
      const headers = getAuthHeaders(profile);
      const isAnth = isAnthProvider(profile);
      const body = isAnth
        ? { model: profile.model, max_tokens: 16384, stream: false, system: sys, messages: [{ role: 'user', content: `Generate ${count} practice questions for ${course.name}` }] }
        : { model: profile.model, max_tokens: 16384, stream: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: `Generate ${count} practice questions for ${course.name}` }] };
      dlog('info', 'exam', `Sending ${count} question request to ${profile.name} (${profile.model})`);
      const res = await fetch(profile.baseUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      setApiStatus(res.ok, res.status);
      dlog('info', 'exam', `Response: HTTP ${res.status}`);
      if (!res.ok) { const errText = await res.text().catch(() => ''); dlog('error', 'exam', `API error: ${errText.slice(0, 300)}`); throw new Error(`API ${res.status}: ${errText.slice(0, 100)}`); }
      const rawText = await res.text();
      dlog('debug', 'exam', `Raw response: ${rawText.length} chars, first 200: ${rawText.slice(0, 200)}`);
      let rd; try { rd = JSON.parse(rawText); } catch (_) { dlog('error', 'exam', `Failed to parse response JSON: ${rawText.slice(0, 300)}`); throw new Error('Bad response — could not parse API response as JSON'); }
      let text = isAnth ? safeArr(rd.content).filter(b => b.type === 'text').map(b => b.text).join('') : (rd.choices?.[0]?.message?.content || '');
      dlog('info', 'exam', `Extracted text: ${text.length} chars`);
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json|```/g, '').trim();
      // Try direct parse first, then extract JSON array from preamble text
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) {
        const arrMatch = text.match(/\[[\s\S]*\]/);
        if (arrMatch) { try { parsed = JSON.parse(arrMatch[0]); } catch (_2) {} }
        if (!parsed) throw new Error('Could not parse questions from AI response. Try a different model.');
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Normalize questions
        const normalized = parsed.map(q => ({
          ...q,
          type: q.type || 'single',
          correct: q.correct ?? 0,
          options: safeArr(q.options),
          topic: q.topic || '',
          competency: q.competency || '',
          difficulty: q.difficulty || 'medium',
        }));
        setQuestions(normalized);
        setTimerActive(true);
        // Immediately persist to data so it survives if the user navigated away during generation
        setData(d => ({ ...d, activeExam: { courseId: selCourse, questions: normalized, answers: {}, flagged: {}, examTime: 0, examMode, startedAt: new Date().toISOString() } }));
        toast(`${normalized.length} questions generated!`, 'success');
      } else throw new Error('No questions returned');
    } catch (e) {
      if (e.name !== 'AbortError') {
        dlog('error', 'api', `Exam gen failed: ${e.message}`);
        toast(`Failed: ${e.message}`, 'error');
      }
    }
    setLoading(false); setExamAbort(null);
    setData(d => ({ ...d, examGenerating: null }));
  };

  // Handle answer for single-choice
  const handleAnswer = (qi, oi) => {
    if (submitted) return;
    const q = questions[qi];
    if (q.type === 'multi-select') {
      // Toggle selection
      const current = Array.isArray(answers[qi]) ? [...answers[qi]] : [];
      const idx = current.indexOf(oi);
      if (idx >= 0) current.splice(idx, 1); else current.push(oi);
      setAnswers(a => ({ ...a, [qi]: current }));
    } else {
      setAnswers(a => ({ ...a, [qi]: oi }));
    }
    // Study mode: show feedback immediately
    if (examMode === 'study' && q.type !== 'multi-select') {
      setShowFeedback(true);
    }
  };

  // Check if answer is correct
  const isCorrect = (qi) => {
    const q = questions[qi];
    if (q.type === 'multi-select') {
      const ans = Array.isArray(answers[qi]) ? [...answers[qi]].sort() : [];
      const cor = Array.isArray(q.correct) ? [...q.correct].sort() : [];
      return JSON.stringify(ans) === JSON.stringify(cor);
    }
    return answers[qi] === q.correct;
  };

  // Submit exam
  const submitExam = () => {
    setSubmitted(true);
    setTimerActive(false);
    setShowPreSubmit(false);
    const correctCount = questions.reduce((s, q, i) => s + (isCorrect(i) ? 1 : 0), 0);

    // Build topic scores
    const topicScores = {};
    questions.forEach((q, i) => {
      const t = q.topic || 'General';
      if (!topicScores[t]) topicScores[t] = { correct: 0, total: 0 };
      topicScores[t].total++;
      if (isCorrect(i)) topicScores[t].correct++;
    });

    setData(d => ({
      ...d,
      examHistory: [...(d.examHistory || []), {
        id: uid(), courseId: selCourse, courseName: course?.name || 'Unknown',
        date: todayStr(), timestamp: new Date().toISOString(),
        score: correctCount / questions.length, correctCount, totalQuestions: questions.length,
        difficulty: adaptiveDifficulty, timeSeconds: examTime, mode: examMode, topicScores,
        // Store questions + answers for historical review
        savedQuestions: questions.map((q, i) => ({
          question: q.question, options: q.options, correct: q.correct,
          explanation: q.explanation, topic: q.topic, difficulty: q.difficulty,
          type: q.type, userAnswer: answers[i] ?? null,
        })),
      }],
    }));
  };

  const score = submitted ? questions.reduce((s, q, i) => s + (isCorrect(i) ? 1 : 0), 0) : 0;
  const scorePct = questions.length > 0 ? Math.round(score / questions.length * 100) : 0;
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // Topic breakdown for results
  const topicBreakdown = useMemo(() => {
    if (!submitted) return [];
    const topics = {};
    questions.forEach((q, i) => {
      const t = q.topic || 'General';
      if (!topics[t]) topics[t] = { correct: 0, total: 0 };
      topics[t].total++;
      if (isCorrect(i)) topics[t].correct++;
    });
    return Object.entries(topics).sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total));
  }, [submitted, questions, answers]);

  // Weak areas from results
  const weakTopics = topicBreakdown.filter(([, v]) => v.correct / v.total < 0.7);

  // Filtered questions for review
  const filteredQs = useMemo(() => {
    if (reviewFilter === 'incorrect') return questions.map((q, i) => ({ q, i })).filter(({ i }) => !isCorrect(i));
    if (reviewFilter === 'correct') return questions.map((q, i) => ({ q, i })).filter(({ i }) => isCorrect(i));
    if (reviewFilter === 'flagged') return questions.map((q, i) => ({ q, i })).filter(({ i }) => flagged[i]);
    return questions.map((q, i) => ({ q, i }));
  }, [reviewFilter, questions, answers, flagged, submitted]);

  // Score history for this course
  const history = useMemo(() => (data.examHistory || []).filter(h => h.courseId === selCourse).sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [data.examHistory, selCourse]);

  const scrollToQ = (i) => { qRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setCurrentQ(i); };

  const modeColors = { test: T.blue, study: T.accent };

  // ═══ CONFIG SCREEN (no exam active) ═══
  if (!hasExam) return (
    <div className="fade">
      <h1 style={{ fontSize: fs(22), fontWeight: 800, marginBottom: 4 }}>Practice Exam</h1>
      <p style={{ color: T.dim, fontSize: fs(11), marginBottom: 16 }}>AI-generated practice questions matched to your course competencies</p>

      {/* Course selector */}
      <div style={{ marginBottom: 12 }}>
        <Label>Course</Label>
        <select value={selCourse} onChange={e => setSelCourse(e.target.value)} style={{ width: '100%', padding: '8px 12px', fontSize: fs(12) }}>
          <option value="">Select a course...</option>
          {(data.courses || []).filter(c => c.status !== 'completed').map(c => <option key={c.id} value={c.id}>{c.courseCode ? `${c.courseCode} — ` : ''}{c.name}</option>)}
        </select>
      </div>

      {course && (
        <>
          {/* Mode selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[
              { key: 'test', icon: '📝', label: 'Test Mode', desc: 'Timer ON · Answers at end · Simulates real exam' },
              { key: 'study', icon: '📚', label: 'Study Mode', desc: 'Timer OFF · Instant feedback · Learn as you go' },
            ].map(m => (
              <div key={m.key} onClick={() => setExamMode(m.key)} style={{
                padding: '14px 16px', borderRadius: 10, cursor: 'pointer', transition: 'all .12s',
                border: `2px solid ${examMode === m.key ? modeColors[m.key] : T.border}`,
                background: examMode === m.key ? `${modeColors[m.key]}11` : T.card,
              }}>
                <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text, marginBottom: 4 }}>{m.icon} {m.label}</div>
                <div style={{ fontSize: fs(10), color: T.dim }}>{m.desc}</div>
              </div>
            ))}
          </div>

          {/* Presets */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {Object.entries(PRESETS).map(([k, v]) => (
              <button key={k} onClick={() => setPreset(k)} style={{
                flex: k === 'custom' ? '1 1 100%' : 1, padding: '10px 8px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                border: `1.5px solid ${preset === k ? T.accent : T.border}`,
                background: preset === k ? T.accentD : T.card, color: preset === k ? T.accent : T.soft,
                fontSize: fs(11), fontWeight: preset === k ? 700 : 500, transition: 'all .12s',
              }}>
                {v.label}
                {k !== 'custom' && <><br /><span style={{ fontSize: fs(9), color: T.dim }}>{v.count}q{examMode === 'test' ? ` · ${v.mins}min` : ''}</span></>}
                {k === 'custom' && <><br /><span style={{ fontSize: fs(9), color: T.dim }}>Set your own questions{examMode === 'test' ? ' & time' : ''}</span></>}
              </button>
            ))}
          </div>

          {/* Custom preset inputs */}
          {preset === 'custom' && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <Label>Questions</Label>
                <input type="number" min="1" max="100" value={customCount} onChange={e => setCustomCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} style={{ width: '100%', padding: '8px 10px', fontSize: fs(12) }} />
              </div>
              {examMode === 'test' && (
                <div style={{ flex: 1 }}>
                  <Label>Time Limit (min)</Label>
                  <input type="number" min="1" max="300" value={customMins} onChange={e => setCustomMins(Math.max(1, Math.min(300, Number(e.target.value) || 1)))} style={{ width: '100%', padding: '8px 10px', fontSize: fs(12) }} />
                </div>
              )}
            </div>
          )}

          {/* Config — locked for standard presets, editable for custom */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            {preset === 'custom' && (
              <div style={{ flex: 1 }}>
                <Label>Difficulty</Label>
                <select value={difficulty} onChange={e => setDifficulty(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: fs(12) }}>
                  <option value="adaptive">Adaptive (based on history)</option>
                  <option value="easy">Easy</option>
                  <option value="mixed">Mixed</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            )}
            {preset !== 'custom' && (
              <div style={{ flex: 1, opacity: 0.6 }}>
                <Label>Difficulty</Label>
                <div style={{ padding: '8px 10px', fontSize: fs(12), background: T.input, borderRadius: 10, border: `1.5px solid ${T.border}`, color: T.dim }}>Adaptive</div>
              </div>
            )}
            <div style={{ flex: 1 }}>
              <Label>Focus</Label>
              <select value={focusArea} onChange={e => setFocusArea(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: fs(12) }}>
                <option value="all">All Topics</option>
                <option value="weak">Weak Areas Only</option>
                {safeArr(course?.topicBreakdown).map((t, i) => <option key={i} value={t.topic}>{t.topic}</option>)}
              </select>
            </div>
          </div>

          {/* Readiness + exam date */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            {readiness !== null && (
              <div style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: fs(20), fontWeight: 800, color: readiness >= 80 ? T.accent : readiness >= 60 ? T.orange : T.red }}>{readiness}%</div>
                <div style={{ fontSize: fs(9), color: T.dim }}>Exam Readiness</div>
              </div>
            )}
            {course.examDate && (
              <div style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: fs(20), fontWeight: 800, color: diffDays(todayStr(), course.examDate) <= 7 ? T.red : T.text }}>{Math.max(0, diffDays(todayStr(), course.examDate))}d</div>
                <div style={{ fontSize: fs(9), color: T.dim }}>Until Exam</div>
              </div>
            )}
            <div style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: fs(20), fontWeight: 800, color: T.text }}>{history.length}</div>
              <div style={{ fontSize: fs(9), color: T.dim }}>Attempts</div>
            </div>
          </div>

          {/* Topic coverage */}
          {safeArr(course.topicBreakdown).length > 0 && (
            <div style={{ background: T.input, borderRadius: 8, padding: 10, marginBottom: 12, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: fs(9), color: T.dim, fontWeight: 600, width: '100%', marginBottom: 4 }}>Topics covered:</span>
              {safeArr(course.topicBreakdown).slice(0, 10).map((t, i) => (
                <span key={i} style={{ fontSize: fs(9), padding: '2px 8px', borderRadius: 5, background: T.purpleD, color: T.purple, fontWeight: 500 }}>{t.topic} {t.weight ? `(${t.weight})` : ''}</span>
              ))}
            </div>
          )}

          {/* Generate button */}
          <div style={{ display: 'flex', gap: 8 }}>
            {loading ? (
              <Btn v="ghost" onClick={stopExam} style={{ flex: 1, borderColor: T.red, color: T.red }}>Stop</Btn>
            ) : (
              <Btn v="ai" onClick={generateExam} disabled={!profile || !selCourse} style={{ flex: 1, padding: '14px 24px', fontSize: fs(14) }}>
                Generate {count}-Question {examMode === 'test' ? 'Test' : 'Practice'}
              </Btn>
            )}
          </div>

          {/* Score history */}
          {history.length > 0 && (
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: fs(12), fontWeight: 700, color: T.text }}>Score History</span>
                {history.length >= 2 && (() => {
                  const trend = history[0].score > history[1].score ? 'improving' : history[0].score < history[1].score ? 'declining' : 'stable';
                  return <Badge color={trend === 'improving' ? T.accent : trend === 'declining' ? T.red : T.dim} bg={trend === 'improving' ? T.accentD : trend === 'declining' ? T.redD : T.input}>{trend === 'improving' ? 'Improving' : trend === 'declining' ? 'Declining' : 'Stable'}</Badge>;
                })()}
              </div>
              {/* SVG trend chart with axes */}
              {history.length >= 2 && (() => {
                const pts = history.slice(0, 10).reverse();
                const cW = 440, cH = 120, pL = 34, pR = 22, pT = 10, pB = 26;
                const plotW = cW - pL - pR, plotH = cH - pT - pB;
                const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
                return (
                  <div style={{ marginBottom: 8 }}>
                    <svg viewBox={`0 0 ${cW} ${cH}`} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 140 }}>
                      {/* Y-axis labels + gridlines */}
                      {yTicks.map(v => {
                        const y = pT + (1 - v) * plotH;
                        return <g key={v}>
                          <text x={pL - 4} y={y + 3} textAnchor="end" fontSize={9} fill={T.dim}>{Math.round(v * 100)}%</text>
                          <line x1={pL} x2={pL + plotW} y1={y} y2={y} stroke={T.border} strokeWidth={0.5} />
                        </g>;
                      })}
                      {/* 80% passing threshold */}
                      <line x1={pL} x2={pL + plotW} y1={pT + (1 - 0.8) * plotH} y2={pT + (1 - 0.8) * plotH} stroke={T.accent} strokeDasharray="4,3" opacity={0.4} />
                      <text x={pL + plotW + 2} y={pT + (1 - 0.8) * plotH + 3} fontSize={8} fill={T.accent} opacity={0.6}>pass</text>
                      {/* Score line */}
                      <path d={pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${pL + i / Math.max(1, pts.length - 1) * plotW} ${pT + (1 - p.score) * plotH}`).join(' ')} fill="none" stroke={T.accent} strokeWidth={2} />
                      {/* Score dots */}
                      {pts.map((p, i) => (
                        <circle key={i} cx={pL + i / Math.max(1, pts.length - 1) * plotW} cy={pT + (1 - p.score) * plotH} r={4}
                          fill={p.score >= 0.8 ? T.accent : p.score >= 0.6 ? T.orange : T.red} stroke={T.card} strokeWidth={1.5} />
                      ))}
                      {/* X-axis date labels */}
                      {pts.map((p, i) => {
                        if (pts.length > 4 && i > 0 && i < pts.length - 1 && i !== Math.floor(pts.length / 2)) return null;
                        return <text key={i} x={pL + i / Math.max(1, pts.length - 1) * plotW} y={cH - 4} textAnchor="middle" fontSize={8} fill={T.dim}>{p.date?.slice(5)}</text>;
                      })}
                    </svg>
                  </div>
                );
              })()}
              {history.slice(0, 8).map(h => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, background: T.input, fontSize: fs(11), marginBottom: 4, cursor: h.savedQuestions ? 'pointer' : 'default', transition: 'border-color .15s', border: `1px solid ${reviewingExam?.id === h.id ? T.accent + '44' : 'transparent'}` }}
                  onClick={() => h.savedQuestions && setReviewingExam(reviewingExam?.id === h.id ? null : h)}
                  onMouseEnter={e => { if (h.savedQuestions) e.currentTarget.style.borderColor = T.accent + '33'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = reviewingExam?.id === h.id ? T.accent + '44' : 'transparent'; }}>
                  <span style={{ color: T.dim, minWidth: 65 }}>{h.date}</span>
                  <span style={{ fontWeight: 700, color: h.score >= 0.8 ? T.accent : h.score >= 0.6 ? T.orange : T.red, minWidth: 38 }}>{Math.round(h.score * 100)}%</span>
                  <span style={{ color: T.dim }}>{h.correctCount}/{h.totalQuestions}</span>
                  <Badge color={h.difficulty === 'hard' ? T.red : h.difficulty === 'easy' ? T.accent : T.orange} bg={h.difficulty === 'hard' ? T.redD : h.difficulty === 'easy' ? T.accentD : T.orangeD}>{h.difficulty}</Badge>
                  <span style={{ color: T.dim }}>{fmtTime(h.timeSeconds)}</span>
                  {h.savedQuestions && <span style={{ marginLeft: 'auto', fontSize: fs(10), color: T.accent, fontWeight: 600 }}>{reviewingExam?.id === h.id ? 'Hide' : 'Review'}</span>}
                  {!h.savedQuestions && <span style={{ marginLeft: 'auto', fontSize: fs(9), color: T.dim, fontStyle: 'italic' }}>no data</span>}
                </div>
              ))}

              {/* Historical exam review panel */}
              {reviewingExam?.savedQuestions && (() => {
                const qs = reviewingExam.savedQuestions;
                const incorrectCount = qs.filter(sq => sq.userAnswer !== sq.correct).length;
                const correctCount = qs.filter(sq => sq.userAnswer === sq.correct).length;
                const scorePctH = Math.round(reviewingExam.score * 100);
                const scoreColor = scorePctH >= 80 ? T.accent : scorePctH >= 60 ? T.orange : T.red;
                return (
                <div style={{ marginTop: 16 }}>
                  {/* Score summary card */}
                  <div style={{ background: `linear-gradient(135deg, ${scoreColor}10, ${T.card})`, border: `1.5px solid ${scoreColor}33`, borderRadius: 14, padding: '16px 20px', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: fs(12), color: T.dim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Historical Exam Review</div>
                        <div style={{ fontSize: fs(18), fontWeight: 800, color: T.text }}>{reviewingExam.courseName || 'Unknown'}</div>
                        <div style={{ fontSize: fs(12), color: T.dim, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span>{reviewingExam.date}</span>
                          <span style={{ fontWeight: 700, color: scoreColor }}>{scorePctH}%</span>
                          <span>{reviewingExam.correctCount}/{reviewingExam.totalQuestions} correct</span>
                          <span>{reviewingExam.difficulty}</span>
                          {reviewingExam.timeSeconds > 0 && <span>{Math.floor(reviewingExam.timeSeconds / 60)}:{String(reviewingExam.timeSeconds % 60).padStart(2, '0')}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        {[
                          { key: 'all', label: 'All', count: qs.length, color: T.blue },
                          { key: 'incorrect', label: 'Incorrect', count: incorrectCount, color: T.red },
                          { key: 'correct', label: 'Correct', count: correctCount, color: T.accent },
                        ].map(f => (
                          <button key={f.key} onClick={() => setReviewFilter(f.key)} style={{
                            padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                            background: reviewFilter === f.key ? f.color : T.input,
                            color: reviewFilter === f.key ? '#fff' : T.dim,
                            fontSize: fs(11), fontWeight: 600, transition: 'all .12s',
                          }}>{f.label} ({f.count})</button>
                        ))}
                        <button onClick={() => setReviewingExam(null)} style={{ padding: '5px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.soft, fontSize: fs(11), cursor: 'pointer', fontWeight: 600 }}>Close</button>
                      </div>
                    </div>
                  </div>
                  {/* Questions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {reviewingExam.savedQuestions
                      .map((sq, idx) => ({ sq, idx }))
                      .filter(({ sq }) => {
                        if (reviewFilter === 'incorrect') return sq.userAnswer !== sq.correct;
                        if (reviewFilter === 'correct') return sq.userAnswer === sq.correct;
                        return true;
                      })
                      .map(({ sq, idx }) => {
                        const wasCorrect = sq.userAnswer === sq.correct;
                        return (
                          <div key={idx} style={{ background: T.bg2, border: `1px solid ${wasCorrect ? T.accent + '33' : T.red + '33'}`, borderRadius: 10, padding: '12px 14px' }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                              <span style={{ fontSize: fs(12), fontWeight: 700, color: wasCorrect ? T.accent : T.red, flexShrink: 0, minWidth: 24 }}>
                                {wasCorrect ? '✓' : '✗'} Q{idx + 1}
                              </span>
                              <span style={{ fontSize: fs(14), color: T.text, lineHeight: 1.6, fontWeight: 600 }}>{sq.question}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 32 }}>
                              {safeArr(sq.options).map((opt, oi) => {
                                const isUserPick = sq.userAnswer === oi;
                                const isCorrectOpt = sq.correct === oi;
                                const bg = isCorrectOpt ? T.accentD : isUserPick && !wasCorrect ? T.redD : 'transparent';
                                const border = isCorrectOpt ? T.accent + '44' : isUserPick && !wasCorrect ? T.red + '44' : T.border;
                                return (
                                  <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 6, background: bg, border: `1px solid ${border}`, fontSize: fs(11) }}>
                                    <span style={{ fontWeight: 700, color: isCorrectOpt ? T.accent : isUserPick ? T.red : T.dim, minWidth: 16 }}>
                                      {String.fromCharCode(65 + oi)}
                                    </span>
                                    <span style={{ color: T.text }}>{opt}</span>
                                    {isCorrectOpt && <span style={{ marginLeft: 'auto', fontSize: fs(9), color: T.accent, fontWeight: 700 }}>CORRECT</span>}
                                    {isUserPick && !wasCorrect && <span style={{ marginLeft: 'auto', fontSize: fs(9), color: T.red, fontWeight: 700 }}>YOUR ANSWER</span>}
                                  </div>
                                );
                              })}
                            </div>
                            {sq.explanation && (
                              <div style={{ marginTop: 8, marginLeft: 32, padding: '6px 10px', borderRadius: 6, background: `${T.blue}08`, borderLeft: `3px solid ${T.blue}44`, fontSize: fs(11), color: T.soft, lineHeight: 1.5 }}>
                                {sq.explanation}
                              </div>
                            )}
                            {sq.topic && <div style={{ marginTop: 4, marginLeft: 32, fontSize: fs(10), color: T.dim }}>Topic: {sq.topic}</div>}
                          </div>
                        );
                      })}
                  </div>
                </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );

  // ═══ EXAM ACTIVE ═══
  return (
    <div className="fade" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      {/* Full-width progress bar */}
      <div style={{ height: 6, background: T.input, borderRadius: 3, overflow: 'hidden', flexShrink: 0, marginBottom: 8 }}>
        <div style={{ height: '100%', background: `linear-gradient(90deg, ${T.accent}, ${T.blue})`, borderRadius: 3, width: `${Object.keys(answers).length / questions.length * 100}%`, transition: 'width .4s ease-out' }} />
      </div>

      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexShrink: 0, padding: '8px 12px', background: T.panel, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Badge color={modeColors[examMode]} bg={modeColors[examMode] + '22'}>{examMode === 'test' ? 'TEST' : 'STUDY'}</Badge>
          <span style={{ fontSize: fs(11), color: T.text, fontWeight: 600 }}>{course?.courseCode || ''} {course?.name || ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {examMode === 'test' && <span style={{ fontSize: fs(16), fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmtTime(examTime)}</span>}
          <span style={{ fontSize: fs(12), fontWeight: 700, color: Object.keys(answers).length === questions.length ? T.accent : T.soft }}>{Object.keys(answers).length}/{questions.length}</span>
          {!submitted && (
            <Btn small onClick={() => {
              const unanswered = questions.length - Object.keys(answers).length;
              const flaggedCount = Object.keys(flagged).filter(k => flagged[k]).length;
              if (unanswered > 0 || flaggedCount > 0) setShowPreSubmit(true);
              else submitExam();
            }}>Submit</Btn>
          )}
          {submitted && <Btn small v="ai" onClick={() => { setQuestions([]); setAnswers({}); setSubmitted(false); setExamTime(0); setFlagged({}); }}>New Exam</Btn>}
        </div>
      </div>

      {/* Pre-submit review */}
      {showPreSubmit && (
        <div style={{ padding: '14px 18px', background: T.card, border: `1px solid ${T.orange}44`, borderRadius: 10, marginBottom: 8, flexShrink: 0 }}>
          <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, marginBottom: 8 }}>Review Before Submitting</div>
          <div style={{ display: 'flex', gap: 16, fontSize: fs(11), color: T.soft, marginBottom: 10 }}>
            <span>Answered: <strong style={{ color: T.accent }}>{Object.keys(answers).length}</strong></span>
            <span>Unanswered: <strong style={{ color: T.red }}>{questions.length - Object.keys(answers).length}</strong></span>
            <span>Flagged: <strong style={{ color: T.orange }}>{Object.keys(flagged).filter(k => flagged[k]).length}</strong></span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {Object.keys(flagged).some(k => flagged[k]) && <Btn small v="ghost" onClick={() => { const fi = Object.keys(flagged).find(k => flagged[k]); if (fi) scrollToQ(Number(fi)); setShowPreSubmit(false); }}>Review Flagged</Btn>}
            <Btn small v="ghost" onClick={() => setShowPreSubmit(false)}>Go Back</Btn>
            <Btn small onClick={submitExam}>Submit Anyway</Btn>
          </div>
        </div>
      )}

      {/* Results dashboard */}
      {submitted && (
        <div className="slide-up" style={{ flexShrink: 0, marginBottom: 10 }}>
          {/* Score banner */}
          <div style={{ background: `linear-gradient(135deg, ${scorePct >= 80 ? T.accentD : scorePct >= 60 ? T.orangeD : T.redD}, ${T.card})`, border: `1.5px solid ${scorePct >= 80 ? T.accent : scorePct >= 60 ? T.orange : T.red}33`, borderRadius: 12, padding: '16px 20px', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: fs(28), fontWeight: 800, color: scorePct >= 80 ? T.accent : scorePct >= 60 ? T.orange : T.red }}>{score}/{questions.length} <span style={{ fontSize: fs(16) }}>({scorePct}%)</span></div>
                <div style={{ fontSize: fs(11), color: T.dim }}>{fmtTime(examTime)} · {adaptiveDifficulty} difficulty</div>
              </div>
              <div style={{ fontSize: fs(12), color: T.soft, textAlign: 'right' }}>
                {scorePct >= 80 ? 'Excellent!' : scorePct >= 60 ? 'Getting there' : scorePct >= 40 ? 'Needs work' : 'Keep studying'}
              </div>
            </div>
          </div>

          {/* Show answers toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 10 }}>
            <span style={{ fontSize: fs(12), fontWeight: 600, color: T.text }}>Show Correct Answers</span>
            <button onClick={() => setShowAnswers(!showAnswers)} style={{
              width: 44, height: 24, borderRadius: 12, cursor: 'pointer', border: 'none',
              background: showAnswers ? T.accent : T.input, position: 'relative', transition: 'background .2s',
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3,
                left: showAnswers ? 23 : 3, transition: 'left .2s',
                boxShadow: '0 1px 3px rgba(0,0,0,.3)',
              }} />
            </button>
          </div>

          {/* Topic breakdown */}
          {topicBreakdown.length > 0 && (
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 10 }}>
              <div style={{ fontSize: fs(11), fontWeight: 700, color: T.text, marginBottom: 8 }}>Performance by Topic</div>
              {topicBreakdown.map(([topic, { correct, total }]) => {
                const pct = Math.round(correct / total * 100);
                const color = pct >= 80 ? T.accent : pct >= 60 ? T.orange : T.red;
                return (
                  <div key={topic} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ width: 140, fontSize: fs(10), color: T.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topic}</span>
                    <div style={{ flex: 1, height: 6, background: T.input, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .5s' }} />
                    </div>
                    <span style={{ width: 36, fontSize: fs(10), fontWeight: 700, color, textAlign: 'right' }}>{pct}%</span>
                    <span style={{ width: 30, fontSize: fs(9), color: T.dim }}>{correct}/{total}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Weak area actions */}
          {weakTopics.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <Btn small v="ai" onClick={() => { setFocusArea('weak'); setQuestions([]); setSubmitted(false); toast('Generating focused exam on weak areas...', 'info'); setTimeout(generateExam, 100); }}>Retry Weak Areas</Btn>
              <Btn small v="ghost" onClick={() => { setQuestions([]); setSubmitted(false); }}>New Exam</Btn>
            </div>
          )}

          {/* Review filter */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {['all', 'incorrect', 'correct', 'flagged'].map(f => {
              const counts = {
                all: questions.length,
                incorrect: questions.filter((_, i) => !isCorrect(i)).length,
                correct: questions.filter((_, i) => isCorrect(i)).length,
                flagged: Object.keys(flagged).filter(k => flagged[k]).length,
              };
              return (
                <button key={f} onClick={() => setReviewFilter(f)} style={{
                  padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: reviewFilter === f ? (f === 'incorrect' ? T.red : f === 'correct' ? T.accent : T.blue) : T.input,
                  color: reviewFilter === f ? '#fff' : T.dim,
                  fontSize: fs(10), fontWeight: reviewFilter === f ? 700 : 500,
                }}>{f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})</button>
              );
            })}
          </div>
        </div>
      )}

      {/* Question navigation map (test mode) */}
      {examMode === 'test' && !submitted && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8, flexShrink: 0, padding: '6px 8px', background: T.panel, borderRadius: 8 }}>
          {questions.map((q, i) => (
            <button key={i} onClick={() => scrollToQ(i)} style={{
              width: 28, height: 28, borderRadius: 5, border: `1.5px solid ${flagged[i] ? T.orange : answers[i] !== undefined ? T.accent : T.border}`,
              background: flagged[i] ? T.orangeD : answers[i] !== undefined ? T.accentD : T.input,
              color: flagged[i] ? T.orange : answers[i] !== undefined ? T.accent : T.dim,
              fontSize: fs(9), fontWeight: 700, cursor: 'pointer',
            }}>{i + 1}</button>
          ))}
        </div>
      )}

      {/* Questions */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {(submitted ? filteredQs : questions.map((q, i) => ({ q, i }))).map(({ q, i: qi }) => {
          const showResult = (submitted && showAnswers) || (examMode === 'study' && showFeedback && answers[qi] !== undefined);
          const correct = isCorrect(qi);
          return (
            <div key={qi} ref={el => qRefs.current[qi] = el} style={{ background: T.card, border: `1.5px solid ${showResult ? (correct ? T.accent : T.red) + '44' : T.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 12, boxShadow: showResult && correct ? `0 0 16px ${T.accent}10` : '0 1px 4px rgba(0,0,0,.08)' }}>
              {/* Question zone — distinct background */}
              <div style={{ padding: '14px 18px', background: `linear-gradient(135deg, ${showResult ? (correct ? T.accent : T.red) + '08' : T.bg2}, ${T.card})`, borderBottom: `1px solid ${T.border}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: showResult ? (correct ? T.accentD : T.redD) : T.input, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(12), fontWeight: 800, color: showResult ? (correct ? T.accent : T.red) : T.soft, flexShrink: 0, border: `1.5px solid ${showResult ? (correct ? T.accent : T.red) + '33' : T.border}` }}>Q{qi + 1}</div>
                  <div style={{ flex: 1, fontSize: fs(15), fontWeight: 600, color: T.text, lineHeight: 1.6 }}>{q.question}</div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                    {q.type === 'multi-select' && <Badge color={T.purple} bg={T.purpleD}>Multi-Select</Badge>}
                    {q.difficulty && <Badge color={q.difficulty === 'hard' ? T.red : q.difficulty === 'easy' ? T.accent : T.orange} bg={q.difficulty === 'hard' ? T.redD : q.difficulty === 'easy' ? T.accentD : T.orangeD}>{q.difficulty}</Badge>}
                    {!submitted && <button onClick={() => setFlagged(f => ({ ...f, [qi]: !f[qi] }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: flagged[qi] ? T.orange : T.dim, fontSize: fs(14) }} title="Flag for review">{flagged[qi] ? '🚩' : '⚐'}</button>}
                  </div>
                </div>
                {q.topic && <div style={{ fontSize: fs(10), color: T.dim, marginTop: 6, marginLeft: 40 }}>Topic: {q.topic}</div>}
              </div>
              {/* Answer zone — separate visual area */}
              <div style={{ padding: '12px 18px' }}>
                {q.type === 'multi-select' && !showResult && <div style={{ fontSize: fs(10), color: T.orange, marginBottom: 8, fontWeight: 600 }}>Select ALL that apply</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {safeArr(q.options).map((opt, oi) => {
                  const isMulti = q.type === 'multi-select';
                  const selected = isMulti ? (Array.isArray(answers[qi]) && answers[qi].includes(oi)) : answers[qi] === oi;
                  const isCorrectOpt = isMulti ? (Array.isArray(q.correct) && q.correct.includes(oi)) : oi === q.correct;
                  return (
                    <button key={oi} onClick={() => handleAnswer(qi, oi)} disabled={submitted || (examMode === 'study' && showFeedback && answers[qi] !== undefined && !isMulti)} style={{
                      textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: submitted ? 'default' : 'pointer', fontSize: fs(12), display: 'flex', alignItems: 'center', gap: 10,
                      border: `1.5px solid ${showResult ? (isCorrectOpt ? T.accent : selected ? T.red : T.border) : (selected ? T.blue : T.border)}`,
                      background: showResult ? (isCorrectOpt ? T.accentD : selected ? T.redD : T.input) : (selected ? T.blueD : T.input),
                      color: showResult ? (isCorrectOpt ? T.accent : selected ? T.red : T.text) : (selected ? T.blue : T.text),
                      fontWeight: selected || (showResult && isCorrectOpt) ? 600 : 400,
                    }}>
                      <span style={{ width: 24, height: 24, borderRadius: isMulti ? 4 : 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(10), fontWeight: 700, flexShrink: 0, border: `1.5px solid ${showResult ? (isCorrectOpt ? T.accent : selected ? T.red : T.border) : (selected ? T.blue : T.border)}`, background: showResult ? (isCorrectOpt ? T.accent + '22' : selected ? T.red + '22' : 'transparent') : (selected ? T.blue + '22' : 'transparent') }}>
                        {String.fromCharCode(65 + oi)}
                      </span>
                      <span style={{ flex: 1, lineHeight: 1.5 }}>{opt}</span>
                      {showResult && isCorrectOpt && <span style={{ color: T.accent }}>✓</span>}
                      {showResult && selected && !isCorrectOpt && <span style={{ color: T.red }}>✗</span>}
                    </button>
                  );
                })}
              </div>
              {/* Study mode: confirm multi-select */}
              {examMode === 'study' && q.type === 'multi-select' && !showResult && Array.isArray(answers[qi]) && answers[qi].length > 0 && (
                <button onClick={() => setShowFeedback(true)} style={{ marginTop: 8, padding: '6px 16px', borderRadius: 6, border: `1px solid ${T.accent}`, background: T.accentD, color: T.accent, fontSize: fs(10), fontWeight: 600, cursor: 'pointer' }}>Check Answer</button>
              )}
              {/* Explanation */}
              {showResult && q.explanation && (
                <div style={{ fontSize: fs(11), color: T.soft, marginTop: 10, padding: '10px 14px', background: `linear-gradient(135deg, ${T.input}, ${T.panel})`, borderRadius: 10, borderLeft: `3px solid ${T.accent}`, lineHeight: 1.6 }}>
                  💡 {q.explanation}
                  {q.competency && <div style={{ fontSize: fs(9), color: T.dim, marginTop: 4 }}>Competency: {q.competency}</div>}
                </div>
              )}
              {/* Study mode: next button */}
              {examMode === 'study' && showResult && qi < questions.length - 1 && !submitted && (
                <button onClick={() => { setShowFeedback(false); scrollToQ(qi + 1); }} style={{ marginTop: 8, padding: '6px 16px', borderRadius: 6, border: `1px solid ${T.accent}`, background: T.accentD, color: T.accent, fontSize: fs(10), fontWeight: 600, cursor: 'pointer' }}>Next Question →</button>
              )}
              {examMode === 'study' && showResult && qi === questions.length - 1 && !submitted && (
                <button onClick={submitExam} style={{ marginTop: 8, padding: '6px 16px', borderRadius: 6, border: `1px solid ${T.accent}`, background: T.accent, color: '#fff', fontSize: fs(10), fontWeight: 600, cursor: 'pointer' }}>Finish Exam</button>
              )}
              </div>{/* close answer zone */}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: fs(8), color: T.dim, textAlign: 'center', padding: '4px 0', flexShrink: 0 }}>AI-generated questions may not reflect actual exam format or content. Use alongside official materials.</div>
    </div>
  );
};

export { PracticeExamPage };
export default PracticeExamPage;
