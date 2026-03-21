import { useState, useCallback, useRef, useEffect } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr } from "../../utils/helpers.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { buildSystemPrompt, callAIWithTools, isAnthProvider, getAuthHeaders, setApiStatus } from "../../systems/api.js";
import { safeArr } from "../../utils/toolExecution.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";

const PracticeExamPage = ({ data, setData, profile, Btn, Label }) => {
  const T = useTheme();
  const bp = useBreakpoint();
  const [selCourse, setSelCourse] = useState(data.courses?.[0]?.id || "");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("mixed");
  const [examAbort, setExamAbort] = useState(null);
  const [examTime, setExamTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const timerRef = useRef(null);

  const course = data.courses?.find(c => c.id === selCourse);

  // Exam timer
  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => setExamTime(t => t + 1), 1000);
      return () => clearInterval(timerRef.current);
    } else { clearInterval(timerRef.current); }
  }, [timerActive]);

  const stopExam = () => { if(examAbort) { examAbort.abort(); setExamAbort(null); setLoading(false); toast("Cancelled","info"); } };

  const generateExam = async () => {
    if (!profile || !course) return;
    const controller = new AbortController();
    setExamAbort(controller);
    setLoading(true); setSubmitted(false); setAnswers({}); setExamTime(0);
    toast("Generating practice exam...", "info");
    const diffPrompt = difficulty === "easy" ? "Make questions introductory-level." : difficulty === "hard" ? "Make questions challenging — focus on edge cases, exceptions, and deep understanding." : "Mix easy, medium, and hard questions.";
    const topicFocus = safeArr(course.topicBreakdown).length > 0 ? `Focus on topics (weighted by importance): ${safeArr(course.topicBreakdown).map(t=>`${t.topic} (${t.weight||"?"})`).join(", ")}` : "";
    const examContext = `You are generating a practice exam. Create exactly ${count} multiple-choice questions for: ${course.name}.
${topicFocus}
${safeArr(course.competencies).length > 0 ? `Competencies/objectives to cover: ${safeArr(course.competencies).slice(0,10).map(c=>`${c.code||""} ${c.title}`).join("; ")}` : ""}
${safeArr(course.knownFocusAreas).length > 0 ? `Known high-weight areas: ${safeArr(course.knownFocusAreas).join(", ")}` : ""}
${safeArr(course.commonMistakes).length > 0 ? `Common student mistakes: ${safeArr(course.commonMistakes).slice(0,5).join("; ")}` : ""}
${["OA","OA+PA","Exam","Mixed"].includes(course.assessmentType) ? "Model questions after the course's exam format — scenario-based, application-level, not just recall." : ""}
${diffPrompt}

Each question must have exactly 4 answer choices. Weight questions by topic importance.
Respond ONLY with a JSON array. Each item: {"question":"...","options":["A","B","C","D"],"correct":0,"explanation":"...","difficulty":"easy|medium|hard"}
Where correct is the 0-based index of the right answer. No markdown, no backticks, no preamble.`;
    const sys = buildSystemPrompt(data, examContext);
    try {
      const headers = getAuthHeaders(profile);
      const isAnth = isAnthProvider(profile);
      const body = isAnth
        ? { model:profile.model, max_tokens:16384, system:sys, messages:[{role:"user",content:`Generate ${count} practice questions for ${course.name}`}] }
        : { model:profile.model, max_tokens:16384, messages:[{role:"system",content:sys},{role:"user",content:`Generate ${count} practice questions for ${course.name}`}] };
      const res = await fetch(profile.baseUrl, { method:"POST", headers, body:JSON.stringify(body), signal:controller.signal });
      setApiStatus(res.ok, res.status);
      const rawText = await res.text();
      let rd; try { rd = JSON.parse(rawText); } catch(_e) { throw new Error("Bad response"); }
      let text = isAnth ? safeArr(rd.content).filter(b=>b.type==="text").map(b=>b.text).join("") : (rd.choices?.[0]?.message?.content||"");
      text = text.replace(/<think>[\s\S]*?<\/think>/g,'').replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setQuestions(parsed);
        setTimerActive(true);
        toast(`${parsed.length} questions generated! Timer started.`, "success");
      } else throw new Error("No questions returned");
    } catch(e) {
      if(e.name !== 'AbortError') {
        dlog('error','api',`Exam gen failed: ${e.message}`);
        toast(`Failed: ${e.message}`, "error");
      }
    }
    setLoading(false);
    setExamAbort(null);
  };

  const submitExam = () => {
    setSubmitted(true);
    setTimerActive(false);
  };

  const score = submitted ? questions.reduce((s,q,i) => s + (answers[i] === q.correct ? 1 : 0), 0) : 0;
  const fmtExamTime = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  return (
    <div className="fade">
      <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:4}}>Practice Exam</h1>
      <p style={{color:T.dim,fontSize:fs(13),marginBottom:20}}>AI-generated practice questions weighted by your course context</p>

      <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:20,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:180}}><Label>Course</Label><select value={selCourse} onChange={e=>setSelCourse(e.target.value)}>
          <option value="">Select a course...</option>
          {(data.courses||[]).filter(c=>c.status!=="completed").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select></div>
        <div style={{width:80}}><Label>Questions</Label><input type="number" min="5" max="30" value={count} onChange={e=>setCount(Number(e.target.value))}/></div>
        <div style={{width:120}}><Label>Difficulty</Label><select value={difficulty} onChange={e=>setDifficulty(e.target.value)}>
          <option value="easy">Easy</option><option value="mixed">Mixed</option><option value="hard">Hard</option>
        </select></div>
        {loading ? (
          <Btn v="ghost" onClick={stopExam} style={{borderColor:T.red,color:T.red}}>⬛ Stop</Btn>
        ) : (
          <Btn v="ai" onClick={generateExam} disabled={!profile||!selCourse}>Generate Exam</Btn>
        )}
      </div>

      {/* Topic coverage hint */}
      {course && safeArr(course.topicBreakdown).length > 0 && (
        <div style={{background:T.input,borderRadius:10,padding:10,marginBottom:16,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:fs(10),color:T.dim,fontWeight:600}}>Topics covered:</span>
          {safeArr(course.topicBreakdown).slice(0,8).map((t,i)=>(
            <span key={i} style={{fontSize:fs(9),padding:"2px 8px",borderRadius:5,background:T.purpleD,color:T.purple,fontWeight:500}}>{t.topic} {t.weight?`(${t.weight})`:""}</span>
          ))}
          {safeArr(course.topicBreakdown).length > 8 && <span style={{fontSize:fs(9),color:T.dim}}>+{safeArr(course.topicBreakdown).length-8} more</span>}
        </div>
      )}

      {questions.length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* Timer + Submit bar */}
          <div className="sf-section" style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:`linear-gradient(135deg,${T.card},${T.panel})`,border:`1.5px solid ${T.border}`,borderRadius:14,padding:"14px 20px",boxShadow:"0 2px 10px rgba(0,0,0,.08)"}}>
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:fs(10),color:T.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px"}}>Time</span>
                <span style={{fontSize:fs(18),fontWeight:800,color:T.accent,fontFamily:"'JetBrains Mono',monospace"}}>{fmtExamTime(examTime)}</span>
              </div>
              <div style={{width:1,height:24,background:T.border}}/>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:fs(10),color:T.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px"}}>Progress</span>
                <span style={{fontSize:fs(14),fontWeight:700,color:Object.keys(answers).length===questions.length?T.accent:T.soft}}>{Object.keys(answers).length}/{questions.length}</span>
              </div>
              {/* Mini progress bar */}
              <div style={{width:80,height:4,background:T.input,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",background:T.accent,borderRadius:2,width:`${Object.keys(answers).length/questions.length*100}%`,transition:"width .3s"}}/></div>
            </div>
            {!submitted && <Btn small onClick={submitExam} disabled={Object.keys(answers).length===0}>Submit Exam</Btn>}
            {submitted && <Btn small v="ai" onClick={()=>{setQuestions([]);setAnswers({});setSubmitted(false);setExamTime(0)}}>New Exam</Btn>}
          </div>

          {submitted && (
            <div className="slide-up" style={{background:`linear-gradient(135deg,${score/questions.length>=0.8?T.accentD:score/questions.length>=0.6?T.orangeD:T.redD},${T.card})`,border:`1.5px solid ${score/questions.length>=0.8?T.accent:score/questions.length>=0.6?T.orange:T.red}33`,borderRadius:16,padding:20,textAlign:"center"}}>
              <div style={{fontSize:fs(36),fontWeight:800,color:score/questions.length>=0.8?T.accent:score/questions.length>=0.6?T.orange:T.red,lineHeight:1}}>{score}/{questions.length}</div>
              <div style={{fontSize:fs(14),color:T.soft,marginTop:6}}>{Math.round(score/questions.length*100)}% in {fmtExamTime(examTime)}</div>
              <div style={{fontSize:fs(12),color:T.dim,marginTop:4}}>{score/questions.length>=0.8?"Excellent work!":score/questions.length>=0.6?"Getting there — review missed questions":score/questions.length>=0.4?"Needs improvement — focus on weak areas":"Keep studying and try again"}</div>
              <div style={{fontSize:fs(10),color:T.dim,textAlign:"center",marginTop:8,lineHeight:1.4}}>Questions are AI-generated and may not reflect your actual exam format, difficulty, or content. Use alongside official practice materials.</div>
            </div>
          )}
          {questions.map((q, qi) => (
            <div key={qi} className="sf-exam-q fade" style={{background:T.card,border:`1.5px solid ${submitted?(answers[qi]===q.correct?T.accent:answers[qi]!==undefined?T.red:T.border)+"44":T.border}`,borderRadius:16,padding:20,boxShadow:submitted&&answers[qi]===q.correct?"0 0 20px "+T.accent+"15":"0 1px 4px rgba(0,0,0,.06)"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:14}}>
                <div style={{width:32,height:32,borderRadius:10,background:submitted?(answers[qi]===q.correct?T.accentD:T.redD):`linear-gradient(135deg,${T.input},${T.card})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:fs(13),fontWeight:800,color:submitted?(answers[qi]===q.correct?T.accent:T.red):T.dim,flexShrink:0,border:`1px solid ${submitted?(answers[qi]===q.correct?T.accent:T.red)+"33":T.border}`}}>{qi+1}</div>
                <div style={{fontSize:fs(14),fontWeight:600,color:T.text,flex:1,lineHeight:1.6}}>{q.question}</div>
                {q.difficulty&&<span style={{fontSize:fs(9),padding:"3px 8px",borderRadius:6,flexShrink:0,background:q.difficulty==="hard"?T.redD:q.difficulty==="easy"?T.accentD:T.orangeD,color:q.difficulty==="hard"?T.red:q.difficulty==="easy"?T.accent:T.orange,fontWeight:700,letterSpacing:"0.3px",textTransform:"uppercase"}}>{q.difficulty}</span>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,paddingLeft:2}}>
                {safeArr(q.options).map((opt, oi) => {
                  const selected = answers[qi] === oi;
                  const isCorrect = oi === q.correct;
                  const showResult = submitted;
                  return (
                    <button key={oi} className="sf-exam-opt" onClick={()=>!submitted&&setAnswers(a=>({...a,[qi]:oi}))} disabled={submitted} style={{
                      textAlign:"left",padding:"12px 16px",borderRadius:12,cursor:submitted?"default":"pointer",fontSize:fs(12),display:"flex",alignItems:"center",gap:12,
                      border:`1.5px solid ${showResult?(isCorrect?T.accent:selected?T.red:T.border):(selected?T.blue:T.border)}`,
                      background:showResult?(isCorrect?T.accentD:selected?T.redD:T.input):(selected?T.blueD:T.input),
                      color:showResult?(isCorrect?T.accent:selected?T.red:T.text):(selected?T.blue:T.text),
                      fontWeight:selected||isCorrect?600:400,
                    }}>
                      <span style={{width:26,height:26,borderRadius:8,background:showResult?(isCorrect?T.accent+"22":selected?T.red+"22":"transparent"):(selected?T.blue+"22":"transparent"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:fs(11),fontWeight:700,flexShrink:0,border:`1.5px solid ${showResult?(isCorrect?T.accent:selected?T.red:T.border):(selected?T.blue:T.border)}`}}>{String.fromCharCode(65+oi)}</span>
                      <span style={{flex:1,lineHeight:1.5}}>{opt}</span>
                      {showResult && isCorrect && <span style={{fontSize:fs(14),color:T.accent}}>✓</span>}
                      {showResult && selected && !isCorrect && <span style={{fontSize:fs(14),color:T.red}}>✗</span>}
                    </button>
                  );
                })}
              </div>
              {submitted && q.explanation && <div style={{fontSize:fs(12),color:T.soft,marginTop:12,padding:"12px 16px",background:`linear-gradient(135deg,${T.input},${T.panel})`,borderRadius:12,borderLeft:`3px solid ${T.accent}`,lineHeight:1.7}}>💡 {q.explanation}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export { PracticeExamPage };
export default PracticeExamPage;
