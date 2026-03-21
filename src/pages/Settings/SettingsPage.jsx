import { useState, useEffect } from "react";
import { useTheme, fs, THEMES, setTheme as setThemeGlobal, setFontScale } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, uid, pad } from "../../utils/helpers.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog, useDebugLog, getLogText } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { isAnthProvider, guessModelsUrl, APP_VERSION, setApiStatus, useApiStatus } from "../../systems/api.js";
import { useYtStats, fetchYtStats, useYtHealth, useYtCheckProgress, checkYtStreamHealth, getYtApiKey, DEFAULT_YT_API_KEY } from "../../systems/youtube.js";
import { Modal } from "../../components/ui/Modal.jsx";
import { Label } from "../../components/ui/Label.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { INIT } from "../../systems/storage.js";

const PRESETS = {
  anthropic: { name:"Anthropic", url:"https://api.anthropic.com/v1/messages", model:"claude-sonnet-4-20250514" },
  openai: { name:"OpenAI", url:"https://api.openai.com/v1/chat/completions", model:"gpt-4o" },
  custom: { name:"Custom", url:"", model:"" },
};
function getAuthHeaders(profile) {
  const h = { "Content-Type": "application/json" };
  const url = profile.baseUrl || "";
  if (profile.provider === "anthropic" || url.includes("anthropic.com")) {
    h["x-api-key"] = profile.apiKey;
    h["anthropic-version"] = "2023-06-01";
    h["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    h["Authorization"] = "Bearer " + profile.apiKey;
  }
  return h;
}

const SettingsPage = ({ data, setData, setPage }) => {
  const T = useTheme();
  const bp = useBreakpoint();
  const ytStats = useYtStats();
  const [showAdd, setShowAdd] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ provider:"anthropic", name:"", apiKey:"", baseUrl:"", model:"" });
  const [showSchema, setShowSchema] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const profiles = data.profiles || [];

  const openAdd = (prov = "anthropic") => {
    const p = PRESETS[prov];
    dlog('debug', 'profile', `Opening add: ${prov}`);
    setForm({ provider:prov, name:p.name, apiKey:"", baseUrl:p.url, model:p.model });
    setEditId(null); setTestResult(null); setModels([]);
    setShowAdd(true);
  };
  const openEdit = (prof) => {
    dlog('debug', 'profile', `Editing: ${prof.name}`);
    setForm({ provider:prof.provider||"custom", name:prof.name, apiKey:prof.apiKey, baseUrl:prof.baseUrl, model:prof.model });
    setEditId(prof.id); setTestResult(null); setModels([]);
    setShowAdd(true);
  };
  const saveProfile = () => {
    if (!form.name) { dlog('warn','profile','No name'); return; }
    if (!form.apiKey) { dlog('warn','profile','No key'); return; }
    if (!form.baseUrl) { dlog('warn','profile','No URL'); return; }
    dlog('info', 'profile', `Saving: ${form.name} (${form.model}) to ${form.baseUrl}`);
    const prof = { ...form, headerKey: isAnthProvider(form)?"x-api-key":"Authorization", headerPrefix: isAnthProvider(form)?"":"Bearer " };
    if (editId) setData(d => ({...d, profiles: d.profiles.map(p => p.id === editId ? {...prof, id:editId} : p)}));
    else { const np = {...prof, id: uid()}; setData(d => ({...d, profiles: [...d.profiles, np], activeProfileId: d.activeProfileId || np.id})); }
    setShowAdd(false);
    toast(`Profile saved: ${form.name}`,"success");
  };
  const removeProfile = (id) => {
    dlog('info', 'profile', `Removing: ${id}`);
    setData(d => ({...d, profiles:d.profiles.filter(p=>p.id!==id), activeProfileId:d.activeProfileId===id?(d.profiles.find(p=>p.id!==id)?.id||null):d.activeProfileId}));
  };

  const testConnection = async () => {
    if (!form.apiKey || !form.baseUrl) { setTestResult({ok:false,msg:"Need API key and base URL"}); return; }
    setTesting(true); setTestResult(null); setModels([]);
    dlog('info','profile',`Testing: ${form.baseUrl}`);
    const headers = getAuthHeaders(form);
    const isAnth = isAnthProvider(form);

    // Step 1: Fetch models FIRST — we need a valid model name to test
    let fetchedModels = [];
    setModelsLoading(true);
    try {
      if (isAnth) {
        fetchedModels = ["claude-opus-4-20250514","claude-sonnet-4-20250514","claude-haiku-4-5-20251001"];
      } else {
        const mUrl = guessModelsUrl(form.baseUrl);
        if (mUrl) {
          dlog('api','profile',`Fetching models: ${mUrl}`);
          const mHeaders = {...headers}; // use same auth
          const mRes = await fetch(mUrl, { headers: mHeaders });
          if (mRes.ok) {
            const mData = await mRes.json();
            let ids = [];
            if (Array.isArray(mData.data)) ids = mData.data.map(m => m.id).sort();
            else if (Array.isArray(mData)) ids = mData.map(m => typeof m === 'string' ? m : (m.id || m.name || "")).filter(Boolean).sort();
            dlog('info','profile',`Got ${ids.length} models`);
            fetchedModels = ids;
          } else {
            const errText = await mRes.text();
            dlog('warn','profile',`Models fetch HTTP ${mRes.status}`, errText.slice(0,200));
          }
        }
      }
    } catch (e) { dlog('warn','profile',`Models error: ${e.message}`); }
    if (fetchedModels.length > 0) setModels(fetchedModels);
    setModelsLoading(false);

    // Pick a model to test with: user-selected > first fetched > fallback
    const testModel = form.model || fetchedModels[0] || (isAnth ? "claude-sonnet-4-20250514" : "");
    if (!testModel) {
      setTestResult({ ok: false, msg: "Could not determine a model to test with. Select a model from the dropdown above." });
      setTesting(false); return;
    }
    dlog('info','profile',`Testing with model: ${testModel}`);

    // Auto-fill model field if empty and we found models
    if (!form.model && testModel) setForm(f => ({...f, model: testModel}));

    // Step 2: Test the chat endpoint
    try {
      const testBody = isAnth
        ? { model: testModel, max_tokens: 10, system: "Reply OK", messages: [{ role: "user", content: "ping" }] }
        : { model: testModel, max_tokens: 10, messages: [{ role: "system", content: "Reply OK" }, { role: "user", content: "ping" }] };
      const t0 = Date.now();
      const res = await fetch(form.baseUrl, { method: "POST", headers, body: JSON.stringify(testBody) });
      const ms = Date.now() - t0;
      dlog('api','profile',`Test: HTTP ${res.status} (${ms}ms)`);
      setApiStatus(res.ok, res.status);
      if (!res.ok) {
        const err = await res.text();
        dlog('error','profile',`Test failed: ${res.status}`, err.slice(0,500));
        setTestResult({ ok: false, msg: `HTTP ${res.status}: ${err.slice(0,150)}` });
        setTesting(false); return;
      }
      const rdText = await res.text();
      let rd; try { rd = JSON.parse(rdText); } catch(e) { setTestResult({ok:true,msg:`Connected (${ms}ms) — response wasn't JSON but auth works`}); setTesting(false); return; }
      let got = isAnth ? safeArr(rd.content).map(b=>b.text||"").join("") : (rd.choices?.[0]?.message?.content || "");
      dlog('info','profile',`Test OK: "${got.slice(0,50)}" (${ms}ms)`);
      setTestResult({ ok: true, msg: `Connected! (${ms}ms) ${fetchedModels.length > 0 ? `· ${fetchedModels.length} models available` : ""}` });
    } catch (e) {
      dlog('error','profile',`Test error`, e.message);
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  return (
    <div className="fade">
      <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:4}}>Settings</h1>
      <p style={{color:T.dim,fontSize:fs(13),marginBottom:20}}>Configure your DevonSYNC experience · <span style={{color:T.soft}}>v{APP_VERSION}</span></p>

      {/* Quick nav */}
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        {[{id:"s-ai",l:"AI Profiles",c:T.accent},{id:"s-you",l:"About You",c:T.blue},{id:"s-look",l:"Appearance",c:T.purple},{id:"s-int",l:"Integrations",c:T.cyan},{id:"s-data",l:"Data",c:T.orange},{id:"s-adv",l:"Advanced",c:T.dim}].map(b=>
          <button key={b.id} className="sf-chip" onClick={()=>document.getElementById(b.id)?.scrollIntoView({behavior:"smooth"})} style={{padding:"6px 14px",borderRadius:8,fontSize:fs(11),fontWeight:600,border:`1px solid ${b.c}44`,background:`${b.c}11`,color:b.c,cursor:"pointer"}}>{b.l}</button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* AI CONNECTION — most important, goes first */}
      {/* ═══════════════════════════════════════════════ */}
      <div id="s-ai" className="sf-section" style={{background:T.card,border:`1.5px solid ${T.accent}44`,borderRadius:14,padding:22,marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:2}}>AI Connection Profiles</h3>
            <p style={{fontSize:fs(11),color:T.dim}}>Connect to Claude, GPT, or any OpenAI-compatible API</p>
          </div>
          <div style={{display:"flex",gap:6}}>
            <Btn small v="ai" onClick={()=>openAdd("anthropic")}>+ Anthropic</Btn>
            <Btn small v="secondary" onClick={()=>openAdd("openai")}>+ OpenAI</Btn>
            <Btn small v="ghost" onClick={()=>openAdd("custom")}>+ Custom</Btn>
          </div>
        </div>
        {profiles.length===0?<p style={{fontSize:fs(12),color:T.dim,textAlign:"center",padding:20,background:T.input,borderRadius:10}}>No AI profiles yet — add one to get started</p>:(
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {profiles.map(p=>(
              <div key={p.id} className="sf-profile" onClick={()=>{dlog('info','profile',`Activated: ${p.name}`);setData(d=>({...d,activeProfileId:p.id}))}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderRadius:10,cursor:"pointer",background:data.activeProfileId===p.id?T.accentD:T.input,border:`1.5px solid ${data.activeProfileId===p.id?T.accent:T.border}`}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:data.activeProfileId===p.id?T.accent:T.dim,boxShadow:data.activeProfileId===p.id?`0 0 8px ${T.accent}`:"none"}}/>
                  <div><div style={{fontSize:fs(13),fontWeight:600}}>{p.name}</div><div className="mono" style={{fontSize:fs(10),color:T.dim}}>{p.model}</div></div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  {data.activeProfileId===p.id&&<Badge color={T.accent} bg={T.accentD}>ACTIVE</Badge>}
                  <button className="sf-icon-btn" onClick={e=>{e.stopPropagation();openEdit(p)}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Edit/></button>
                  <button className="sf-icon-btn" onClick={e=>{e.stopPropagation();removeProfile(p.id)}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Trash/></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* ABOUT YOU */}
      {/* ═══════════════════════════════════════════════ */}
      <div id="s-you" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:3}}>About You</h3>
        <p style={{fontSize:fs(11),color:T.dim,marginBottom:10}}>Tell the AI about your study habits, schedule, and goals. Included in every AI request for personalized recommendations.</p>
        <textarea value={data.userContext||""} onChange={e=>setData(d=>({...d,userContext:e.target.value}))} placeholder="e.g. I'm a visual learner working full-time M-F 9-5. I prefer 2-hour study blocks in evenings and weekends. I struggle with memorization-heavy courses." style={{minHeight:90,fontSize:fs(12)}}/>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* APPEARANCE — theme, font, zoom combined */}
      {/* ═══════════════════════════════════════════════ */}
      <div id="s-look" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:14}}>Appearance</h3>

        {/* Theme */}
        <div style={{marginBottom:18}}>
          <div style={{fontSize:fs(12),fontWeight:600,color:T.soft,marginBottom:8}}>Theme</div>
          <div style={{display:"flex",gap:8}}>
            {Object.entries(THEMES).map(([key, theme]) => {
              const active = (data.theme || "dark") === key;
              return (
                <button key={key} onClick={() => { setData(d => ({...d, theme: key})); setThemeGlobal(key); toast(`Theme: ${theme.name}`, "success"); }} style={{
                  flex:1, padding:"12px 8px", borderRadius:10, cursor:"pointer", textAlign:"center",
                  border: `2px solid ${active ? theme.accent : theme.border}`,
                  background: theme.bg, color: theme.text, transition:"all .2s"
                }}>
                  <div style={{display:"flex",gap:3,justifyContent:"center",marginBottom:6}}>
                    <div style={{width:12,height:12,borderRadius:"50%",background:theme.accent}}/>
                    <div style={{width:12,height:12,borderRadius:"50%",background:theme.blue}}/>
                    <div style={{width:12,height:12,borderRadius:"50%",background:theme.purple}}/>
                  </div>
                  <div style={{fontSize:fs(12),fontWeight:600}}>{theme.name}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font + Zoom side by side */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <div style={{fontSize:fs(12),fontWeight:600,color:T.soft,marginBottom:8}}>Font Size</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:fs(11),color:T.dim}}>A</span>
              <input type="range" min="75" max="300" step="5" value={data.fontScale||100} onChange={e=>{const v=Number(e.target.value);_fontScale=v;setData(d=>({...d,fontScale:v}))}} style={{flex:1,accentColor:T.accent}}/>
              <span style={{fontSize:fs(16),color:T.dim}}>A</span>
              <span style={{fontSize:fs(12),fontWeight:700,color:T.accent,minWidth:36,textAlign:"center"}}>{data.fontScale||100}%</span>
              {(data.fontScale||100)!==100&&<Btn small v="ghost" onClick={()=>setData(d=>({...d,fontScale:100}))}>Reset</Btn>}
            </div>
          </div>
          <div>
            <div style={{fontSize:fs(12),fontWeight:600,color:T.soft,marginBottom:8}}>UI Zoom</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:fs(11),color:T.dim}}>-</span>
              <input type="range" min="75" max="200" step="5" value={data.uiZoom||100} onChange={e=>setData(d=>({...d,uiZoom:Number(e.target.value)}))} style={{flex:1,accentColor:T.blue}}/>
              <span style={{fontSize:fs(14),color:T.dim}}>+</span>
              <span style={{fontSize:fs(12),fontWeight:700,color:T.blue,minWidth:36,textAlign:"center"}}>{data.uiZoom||100}%</span>
              {(data.uiZoom||100)!==100&&<Btn small v="ghost" onClick={()=>setData(d=>({...d,uiZoom:100}))}>Reset</Btn>}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══════════════════════════════════════════════ */}
      <div id="s-int" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:14}}>Integrations</h3>

        {/* YouTube */}
        <div style={{marginBottom:18,paddingBottom:16,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:fs(14)}}>📊</span>
            <div style={{fontSize:fs(13),fontWeight:700}}>YouTube Data API</div>
            <Badge color={data.ytApiKey?T.blue:T.accent} bg={data.ytApiKey?T.blueD:T.accentD}>{data.ytApiKey?"Custom Key":"Built-in"}</Badge>
          </div>
          <p style={{fontSize:fs(11),color:T.dim,marginBottom:8}}>Enables live stats, stream detection, and viewer counts in Study Radio. Override below if the built-in key hits rate limits.</p>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input value={data.ytApiKey||""} onChange={e=>setData(d=>({...d,ytApiKey:e.target.value}))} placeholder="Using built-in key" type="password" autoComplete="off" style={{flex:1,fontSize:fs(11)}} />
            <Btn small v="ai" onClick={()=>{fetchYtStats(getYtApiKey(data));toast("Fetching stats...","info")}}>Refresh</Btn>
            {data.ytApiKey && <Btn small v="ghost" onClick={()=>{setData(d=>({...d,ytApiKey:""}));toast("Reverted to built-in","info")}}>Reset</Btn>}
          </div>
          {Object.keys(ytStats).length > 0 ? (
            <div style={{marginTop:6,fontSize:fs(10),color:T.accent,display:"flex",gap:12}}>
              <span>{Object.keys(ytStats).length} streams</span>
              <span>{Object.values(ytStats).filter(s=>s.live).length} live</span>
            </div>
          ) : (
            <div style={{marginTop:6,fontSize:fs(10),color:T.orange}}>Stats unavailable — add your own YouTube API key for live data</div>
          )}
        </div>
      </div>

      {/* DATA MANAGEMENT */}
      <div id="s-data" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:3}}>Data Management</h3>
        <p style={{fontSize:fs(11),color:T.dim,marginBottom:14}}>Export/import full backups or settings-only snapshots.</p>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <Btn v="secondary" onClick={() => {
            const fullBackup = { ...data, _meta: { version: APP_VERSION, exportDate: new Date().toISOString(), type: "devonsync-backup" }, _favorites: JSON.parse(localStorage.getItem('ds-favs') || '{"soma":[],"yt":[]}'), _customStreams: JSON.parse(localStorage.getItem('ds-custom-streams') || '[]') };
            const blob = new Blob([JSON.stringify(fullBackup, null, 2)], {type:"application/json"});
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `devonsync-backup-${todayStr()}.json`; a.click(); URL.revokeObjectURL(url);
            toast("Backup exported", "success");
          }}><Ic.Download s={14}/> Export Backup</Btn>
          <Btn v="secondary" onClick={() => {
            const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
            input.onchange = (ev) => {
              const file = ev.target.files[0]; if (!file) return;
              const reader = new FileReader();
              reader.onload = (e) => {
                try {
                  const imported = JSON.parse(e.target.result);
                  if (imported._favorites) { localStorage.setItem('ds-favs', JSON.stringify(imported._favorites)); delete imported._favorites; }
                  if (imported._customStreams) { localStorage.setItem('ds-custom-streams', JSON.stringify(imported._customStreams)); delete imported._customStreams; }
                  delete imported._meta;
                  setData(d => ({...d, ...imported}));
                  if (imported.theme) { setThemeGlobal(imported.theme); }
                  toast("Backup restored", "success");
                } catch (err) { toast("Invalid file: " + err.message, "error"); }
              };
              reader.readAsText(file);
            };
            input.click();
          }}><Ic.Upload s={14}/> Import Backup</Btn>
        </div>
      </div>

      {/* ADVANCED */}
      <div id="s-adv" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:14}}>Advanced</h3>
        <div style={{marginBottom:16,paddingBottom:14,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Ic.Bug s={15}/><div style={{fontSize:fs(13),fontWeight:700}}>Debug Log</div></div>
            <div style={{display:"flex",gap:6}}>
              <Btn small v="secondary" onClick={()=>{navigator.clipboard.writeText(getLogText());toast("Log copied","success")}}>Copy</Btn>
              <Btn small v="ghost" onClick={()=>setShowDebug(p=>!p)}>{showDebug?"Hide":"Show"}</Btn>
            </div>
          </div>
          {showDebug && <DebugPage/>}
        </div>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Ic.Tool s={15}/><div style={{fontSize:fs(13),fontWeight:700}}>AI Tool Schema</div><Badge color={T.purple} bg={T.purpleD}>{TOOLS.length} tools</Badge></div>
            <Btn small v="ghost" onClick={()=>setShowSchema(!showSchema)}>{showSchema?"Hide":"View"}</Btn>
          </div>
          {showSchema&&<div style={{background:T.input,borderRadius:10,padding:14,maxHeight:300,overflowY:"auto",marginTop:10}}><pre className="mono" style={{fontSize:fs(10),color:T.soft,whiteSpace:"pre-wrap",lineHeight:1.5}}>{JSON.stringify(TOOLS,null,2)}</pre></div>}
        </div>
      </div>

      {/* CHANGELOG */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setShowChangelog(!showChangelog)}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:fs(14)}}>📋</span><h3 style={{fontSize:fs(16),fontWeight:700}}>Changelog</h3></div>
          <span style={{color:T.dim,fontSize:fs(12)}}>{showChangelog?"▲":"▼"}</span>
        </div>
        {showChangelog && (
          <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:16}}>
            {[
              {v:"7.3.0",d:"Mar 20, 2026",items:[
                {t:"removed",m:"Spotify integration completely removed (SDK, UI, settings, mini player)"},
                {t:"changed",m:"Electron reverted to stock v35.2.1 (no castlabs/Widevine)"},
                {t:"changed",m:"Setup reduced to 6 steps (removed DRM verification)"},
                {t:"changed",m:"Setup uses streaming output — no more hanging on npm install"},
                {t:"fixed",m:"Setup.bat runs in same window (errors visible instead of flash-closing)"},
              ]},
              {v:"7.1.0",d:"Mar 20, 2026",items:[
                {t:"added",m:"Study Radio: 541 YouTube + 44 SomaFM stations with live stats"},
                {t:"added",m:"Mini media player with visualizer, per-source volume, transport controls"},
                {t:"added",m:"YouTube chat integration for live streams"},
                {t:"added",m:"SomaFM real-time audio level visualizer"},
                {t:"added",m:"Est. finish vs term end check — red warning when exceeding deadline"},
                {t:"changed",m:"Setup uses PowerShell for all display (eliminates batch escape issues)"},
                {t:"fixed",m:"BufferedInput number arrows reverting — now commits directly"},
              ]},
              {v:"7.0.0",d:"Mar 20, 2026",items:[
                {t:"added",m:"4-step Course Planner: Import → Configure → Enrich → Generate"},
                {t:"added",m:"Override safeguards, auto-calculated min hours/day"},
                {t:"added",m:"Days Off panel with recurring day toggles + date pills"},
                {t:"added",m:"Responsive breakpoint system: sm/md/lg/xl"},
                {t:"added",m:"Changelog in Settings with categorized version history"},
                {t:"changed",m:"Sequential field gating — each field enables after previous is filled"},
              ]},
              {v:"6.0.0",d:"Mar 19, 2026",items:[
                {t:"added",m:"Course Planner with AI parsing, enrichment, and plan generation"},
                {t:"added",m:"Study Radio: YouTube streams + SomaFM stations"},
                {t:"added",m:"Study Chat with 30+ quick actions and calendar context"},
                {t:"added",m:"Practice Exam, Pomodoro timer, Focus Mode, Weekly Report"},
                {t:"added",m:"Multi-profile AI connections (Anthropic + OpenAI compatible)"},
              ]},
            ].map(release => (
              <div key={release.v}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:fs(14),fontWeight:800,color:T.accent}}>{release.v}</span>
                  <span style={{fontSize:fs(10),color:T.dim}}>{release.d}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:3,paddingLeft:12}}>
                  {release.items.map((item,j) => (
                    <div key={j} style={{display:"flex",alignItems:"center",gap:8,fontSize:fs(11)}}>
                      <span style={{fontSize:fs(9),padding:"2px 6px",borderRadius:4,fontWeight:700,
                        background:item.t==="added"?T.accentD:item.t==="changed"?T.blueD:item.t==="fixed"?T.orangeD:item.t==="removed"?`${T.red}15`:T.input,
                        color:item.t==="added"?T.accent:item.t==="changed"?T.blue:item.t==="fixed"?T.orange:item.t==="removed"?T.red:T.dim,
                      }}>{item.t}</span>
                      <span style={{color:T.soft}}>{item.m}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DANGER ZONE */}
      <div style={{background:`${T.red}08`,border:`1px solid ${T.red}33`,borderRadius:12,padding:20,marginTop:32}}>
        <h3 style={{fontSize:fs(14),fontWeight:700,color:T.red,marginBottom:12}}>Danger Zone</h3>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:8,background:T.input,border:`1px solid ${T.border}`}}>
            <div><div style={{fontSize:fs(12),fontWeight:600,color:T.text}}>Clear All Courses</div><div style={{fontSize:fs(10),color:T.dim}}>Removes courses, enrichment, and study settings. Calendar tasks kept.</div></div>
            <Btn small v="ghost" onClick={() => {
              const count = (data.courses||[]).length;
              if(!count){toast("No courses to clear","info");return}
              if(!confirm(`Remove all ${count} courses and reset study settings?`)) return;
              setData(d => ({...d, courses:[], chatHistories:{}, studyStartDate:"", studyStartTime:"", targetCompletionDate:"", targetDate:"", studyHoursPerDay:4, exceptionDates:[], overrideSafeguards:false}));
              toast(`${count} courses cleared`, "warn");
            }} style={{color:T.red,borderColor:T.red+"55"}}>Clear Courses</Btn>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:8,background:T.input,border:`1px solid ${T.border}`}}>
            <div><div style={{fontSize:fs(12),fontWeight:600,color:T.text}}>Clear Study Plan Tasks</div><div style={{fontSize:fs(10),color:T.dim}}>Removes AI-generated tasks. Personal/health/work kept.</div></div>
            <Btn small v="ghost" onClick={() => {
              const allDates = Object.keys(data.tasks||{});
              if(!allDates.length){toast("No tasks","info");return}
              if(!confirm("Remove all study plan tasks?")) return;
              let removed = 0;
              setData(d => {
                const tasks = {};
                for (const [dt, dayTasks] of Object.entries(d.tasks||{})) {
                  const kept = safeArr(dayTasks).filter(t => !AI_CATS.includes(t.category));
                  removed += safeArr(dayTasks).length - kept.length;
                  if(kept.length > 0) tasks[dt] = kept;
                }
                return {...d, tasks};
              });
              toast(`${removed} tasks removed`, "warn");
            }} style={{color:T.red,borderColor:T.red+"55"}}>Clear Study Plan</Btn>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:8,background:T.input,border:`1px solid ${T.border}`}}>
            <div><div style={{fontSize:fs(12),fontWeight:600,color:T.text}}>Clear ALL Calendar Tasks</div><div style={{fontSize:fs(10),color:T.dim}}>Wipes every task on every date.</div></div>
            <Btn small v="ghost" onClick={() => {
              const count = Object.values(data.tasks||{}).flat().length;
              if(!count){toast("Calendar empty","info");return}
              if(!confirm(`Delete ALL ${count} tasks?`)) return;
              setData(d => ({...d, tasks:{}}));
              toast(`${count} tasks removed`, "warn");
            }} style={{color:T.red,borderColor:T.red+"55"}}>Clear All Tasks</Btn>
          </div>
        </div>
        <div style={{borderTop:`1px solid ${T.red}22`,paddingTop:12}}>
          <p style={{fontSize:fs(11),color:T.dim,marginBottom:10}}>Full reset permanently erases everything.</p>
          <Btn small v="danger" onClick={() => {
            if (!confirm("WARNING: This will permanently delete ALL data.\n\nAre you absolutely sure?")) return;
            if (!confirm("Last chance. Click OK to confirm full reset.")) return;
            localStorage.removeItem('ds-v1'); localStorage.removeItem('ds-favs'); localStorage.removeItem('ds-custom-streams');
            setData({...INIT});
            toast("All data erased", "warn");
            dlog('warn','settings',"Full data reset");
          }}>Reset All Data</Btn>
        </div>
      </div>
    </div>
  );
};

export { SettingsPage };
export default SettingsPage;
