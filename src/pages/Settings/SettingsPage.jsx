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
import { TOOLS } from "../../constants/tools.js";
import { INIT } from "../../systems/storage.js";

const PROVIDERS = {
  // ── Direct API (sorted by popularity) ──
  openai:    { cat:"direct", name:"OpenAI",       icon:"ProvOpenAI",    url:"https://api.openai.com/v1/chat/completions", models:["gpt-4o","gpt-4o-mini","gpt-4.1","gpt-4.1-mini","o3","o4-mini"], default:"gpt-4o", keyHint:"sk-...", color:"#10a37f" },
  anthropic: { cat:"direct", name:"Anthropic",    icon:"ProvAnthropic", url:"https://api.anthropic.com/v1/messages", models:["claude-opus-4-20250514","claude-sonnet-4-20250514","claude-haiku-4-5-20251001"], default:"claude-sonnet-4-20250514", keyHint:"sk-ant-...", color:"#d97706" },
  deepseek:  { cat:"direct", name:"DeepSeek",     icon:"ProvDeepSeek",  url:"https://api.deepseek.com/v1/chat/completions", models:["deepseek-chat","deepseek-reasoner","deepseek-coder"], default:"deepseek-chat", keyHint:"sk-...", color:"#4f6df5" },
  gemini:    { cat:"direct", name:"Google Gemini", icon:"ProvGemini",   url:"https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", models:["gemini-2.5-pro","gemini-2.5-flash","gemini-2.0-flash"], default:"gemini-2.5-flash", keyHint:"AIza...", color:"#4285f4" },
  mistral:   { cat:"direct", name:"Mistral",      icon:"ProvMistral",   url:"https://api.mistral.ai/v1/chat/completions", models:["mistral-large-latest","mistral-small-latest","codestral-latest","mistral-medium-latest"], default:"mistral-large-latest", keyHint:"...", color:"#ff7000" },
  xai:       { cat:"direct", name:"xAI (Grok)",   icon:"ProvXAI",      url:"https://api.x.ai/v1/chat/completions", models:["grok-3","grok-3-mini","grok-2"], default:"grok-3-mini", keyHint:"xai-...", color:"#1da1f2" },
  zai:       { cat:"direct", name:"Z.AI",         icon:"ProvZAI",      url:"https://api.z.ai/api/coding/paas/v4/chat/completions", models:["glm-5-turbo","claude-sonnet-4","gpt-4o","deepseek-chat"], default:"glm-5-turbo", keyHint:"sk-...", color:"#06d6a0" },
  cohere:    { cat:"direct", name:"Cohere",       icon:"ProvCohere",   url:"https://api.cohere.com/v2/chat", models:["command-r-plus","command-r","command-a"], default:"command-r-plus", keyHint:"...", color:"#39594d" },
  ai21:      { cat:"direct", name:"AI21",         icon:"ProvAI21",     url:"https://api.ai21.com/studio/v1/chat/completions", models:["jamba-1.5-large","jamba-1.5-mini"], default:"jamba-1.5-large", keyHint:"...", color:"#6c3ea0" },

  // ── Aggregators / Proxies (sorted by popularity) ──
  openrouter: { cat:"aggregator", name:"OpenRouter",   icon:"ProvOpenRouter", url:"https://openrouter.ai/api/v1/chat/completions", models:["anthropic/claude-sonnet-4","openai/gpt-4o","deepseek/deepseek-chat","google/gemini-2.5-pro","meta-llama/llama-3.3-70b-instruct"], default:"anthropic/claude-sonnet-4", keyHint:"sk-or-...", color:"#7c3aed" },
  groq:       { cat:"aggregator", name:"Groq",         icon:"ProvGroq",      url:"https://api.groq.com/openai/v1/chat/completions", models:["llama-3.3-70b-versatile","deepseek-r1-distill-llama-70b","mixtral-8x7b-32768","gemma2-9b-it"], default:"llama-3.3-70b-versatile", keyHint:"gsk_...", color:"#f55036" },
  together:   { cat:"aggregator", name:"Together AI",  icon:"ProvTogether",  url:"https://api.together.xyz/v1/chat/completions", models:["meta-llama/Llama-3.3-70B-Instruct","deepseek-ai/DeepSeek-R1","Qwen/Qwen2.5-72B-Instruct","mistralai/Mixtral-8x22B-Instruct-v0.1"], default:"meta-llama/Llama-3.3-70B-Instruct", keyHint:"...", color:"#0ea5e9" },
  cerebras:   { cat:"aggregator", name:"Cerebras",     icon:"ProvCerebras",  url:"https://api.cerebras.ai/v1/chat/completions", models:["llama-3.3-70b","llama-3.1-8b"], default:"llama-3.3-70b", keyHint:"csk-...", color:"#ff4500" },
  fireworks:  { cat:"aggregator", name:"Fireworks AI", icon:"ProvFireworks", url:"https://api.fireworks.ai/inference/v1/chat/completions", models:["accounts/fireworks/models/llama-v3p3-70b-instruct","accounts/fireworks/models/deepseek-r1","accounts/fireworks/models/qwen2p5-72b-instruct"], default:"accounts/fireworks/models/llama-v3p3-70b-instruct", keyHint:"fw_...", color:"#ff6b35" },
  sambanova:  { cat:"aggregator", name:"SambaNova",    icon:"ProvSambaNova", url:"https://api.sambanova.ai/v1/chat/completions", models:["Meta-Llama-3.3-70B-Instruct","DeepSeek-R1","Qwen2.5-72B-Instruct"], default:"Meta-Llama-3.3-70B-Instruct", keyHint:"...", color:"#00b4d8" },
  perplexity: { cat:"aggregator", name:"Perplexity",   icon:"ProvPerplexity",url:"https://api.perplexity.ai/chat/completions", models:["sonar-pro","sonar","sonar-deep-research"], default:"sonar-pro", keyHint:"pplx-...", color:"#20b2aa" },
  nanogpt:    { cat:"aggregator", name:"NanoGPT",      icon:"ProvNanoGPT",   url:"https://api.nano-gpt.com/v1/chat/completions", models:["chatgpt-4o-latest","claude-sonnet-4","deepseek-chat","llama-3.3-70b"], default:"chatgpt-4o-latest", keyHint:"nano-...", color:"#a855f7" },
  novita:     { cat:"aggregator", name:"Novita AI",    icon:"ProvNovita",    url:"https://api.novita.ai/v3/openai/chat/completions", models:["meta-llama/llama-3.3-70b-instruct","deepseek/deepseek-r1","mistralai/mistral-large-latest"], default:"meta-llama/llama-3.3-70b-instruct", keyHint:"...", color:"#8b5cf6" },
  shuttleai:  { cat:"aggregator", name:"ShuttleAI",    icon:"ProvShuttleAI", url:"https://api.shuttleai.com/v1/chat/completions", models:["shuttle-3","gpt-4o","claude-sonnet-4"], default:"shuttle-3", keyHint:"shuttle-...", color:"#6366f1" },
  hyperbolic: { cat:"aggregator", name:"Hyperbolic",   icon:"ProvHyperbolic",url:"https://api.hyperbolic.xyz/v1/chat/completions", models:["meta-llama/Llama-3.3-70B-Instruct","deepseek-ai/DeepSeek-R1","Qwen/Qwen2.5-72B-Instruct"], default:"meta-llama/Llama-3.3-70B-Instruct", keyHint:"...", color:"#ec4899" },
  chutes:     { cat:"aggregator", name:"Chutes AI",    icon:"ProvChutes",    url:"https://api.chutes.ai/v1/chat/completions", models:["deepseek-ai/DeepSeek-R1","meta-llama/Llama-3.3-70B-Instruct"], default:"deepseek-ai/DeepSeek-R1", keyHint:"cpk-...", color:"#14b8a6" },
  lepton:     { cat:"aggregator", name:"Lepton AI",    icon:"ProvLepton",    url:"https://llama3-3-70b.lepton.run/api/v1/chat/completions", models:["llama3.3-70b"], default:"llama3.3-70b", keyHint:"...", color:"#f59e0b" },

  // ── Local / Self-Hosted (sorted by popularity) ──
  ollama:    { cat:"local", name:"Ollama",        icon:"ProvOllama",    url:"http://localhost:11434/v1/chat/completions", models:["llama3.3","deepseek-r1","qwen2.5","mistral","codellama","phi4","gemma2"], default:"llama3.3", keyHint:"(none needed)", color:"#ffffff" },
  lmstudio:  { cat:"local", name:"LM Studio",    icon:"ProvLMStudio",  url:"http://localhost:1234/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#22d3ee" },
  vllm:      { cat:"local", name:"vLLM",          icon:"ProvVLLM",     url:"http://localhost:8000/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#a78bfa" },
  jan:       { cat:"local", name:"Jan",            icon:"ProvJan",      url:"http://localhost:1337/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#fb923c" },
  gpt4all:   { cat:"local", name:"GPT4All",       icon:"ProvGPT4All",  url:"http://localhost:4891/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#60a5fa" },
  localai:   { cat:"local", name:"LocalAI",       icon:"ProvLocalAI",  url:"http://localhost:8080/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#34d399" },
  llamacpp:  { cat:"local", name:"llama.cpp",     icon:"ProvLlamaCpp", url:"http://localhost:8080/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#e2e8f0" },
  koboldcpp: { cat:"local", name:"Kobold.cpp",    icon:"ProvKoboldCpp",url:"http://localhost:5001/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#f472b6" },
  oobabooga: { cat:"local", name:"text-gen-webui",icon:"ProvOobabooga",url:"http://localhost:5000/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#facc15" },
  tabbyapi:  { cat:"local", name:"TabbyAPI",      icon:"ProvTabbyAPI", url:"http://localhost:5000/v1/chat/completions", models:[], default:"", keyHint:"(none needed)", color:"#c084fc" },
};

const PROVIDER_CATS = [
  { key:"direct", label:"Direct API", desc:"Connect directly to AI providers", icon:"IcGlobe" },
  { key:"aggregator", label:"Aggregator / Proxy", desc:"Multi-model access with one API key", icon:"AI" },
  { key:"local", label:"Local / Self-Hosted", desc:"Run models on your own hardware", icon:"IcChart" },
];
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

/* helper: check if an API key roughly matches the provider's expected format */
const keyFormatOk = (key, provKey) => {
  if (!key) return null; // empty = neutral
  const prov = PROVIDERS[provKey];
  if (!prov) return null;
  const hint = prov.keyHint || "";
  if (hint === "(none needed)") return "optional";
  // Build a prefix from the hint (everything before the dots)
  const prefix = hint.replace(/\.+$/, "").replace(/\.+/, "");
  if (!prefix) return null; // no useful hint
  return key.startsWith(prefix) ? "match" : "mismatch";
};

/* helper: find the last-used provider key from existing profiles */
const lastUsedProvider = (profiles) => {
  if (!profiles || profiles.length === 0) return null;
  const last = profiles[profiles.length - 1];
  return last.provider || null;
};

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
  const [addCategory, setAddCategory] = useState(null);
  const [verified, setVerified] = useState(false);
  const [showAdvancedUrl, setShowAdvancedUrl] = useState(false);
  const profiles = data.profiles || [];

  const openAdd = (provKey = "anthropic") => {
    const p = PROVIDERS[provKey];
    if (!p) return;
    dlog('debug', 'profile', `Opening add: ${provKey}`);
    setForm({ provider: provKey, name: p.name, apiKey: "", baseUrl: p.url, model: p.default });
    setEditId(null); setTestResult(null); setModels(p.models || []);
    setVerified(false); setShowAdvancedUrl(false);
    setAddCategory(p.cat);
    setShowAdd(true);
  };
  const openEdit = (prof) => {
    dlog('debug', 'profile', `Editing: ${prof.name}`);
    setForm({ provider:prof.provider||"custom", name:prof.name, apiKey:prof.apiKey, baseUrl:prof.baseUrl, model:prof.model });
    setEditId(prof.id); setTestResult(null); setModels(PROVIDERS[prof.provider]?.models || []);
    setVerified(true); setShowAdvancedUrl(false);
    setAddCategory(null);
    setShowAdd(true);
  };
  const duplicateProfile = (prof) => {
    dlog('info', 'profile', `Duplicating: ${prof.name}`);
    const prov = PROVIDERS[prof.provider];
    setForm({ provider: prof.provider || "custom", name: `Copy of ${prof.name}`, apiKey: prof.apiKey, baseUrl: prof.baseUrl, model: prof.model });
    setEditId(null); setTestResult(null); setModels(prov?.models || []);
    setVerified(true); setShowAdvancedUrl(false);
    setAddCategory(prov?.cat || null);
    setShowAdd(true);
  };
  const saveProfile = () => {
    const isLocalProv = PROVIDERS[form.provider]?.cat === "local";
    if (!form.name) { dlog('warn','profile','No name'); return; }
    if (!form.apiKey && !isLocalProv) { dlog('warn','profile','No key'); return; }
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
    const isLocalProv = PROVIDERS[form.provider]?.cat === "local";
    if ((!form.apiKey && !isLocalProv) || !form.baseUrl) { setTestResult({ok:false,msg:"Need API key and base URL"}); return; }
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
      setTestResult({ ok: true, msg: `Connected in ${ms}ms${fetchedModels.length > 0 ? ` · ${fetchedModels.length} models available` : ""}` });
      setVerified(true);
    } catch (e) {
      dlog('error','profile',`Test error`, e.message);
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  return (
    <div className="fade">
      <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:4}}>Settings</h1>
      <p style={{color:T.dim,fontSize:fs(13),marginBottom:20}}>Configure your Vorra experience · <span style={{color:T.soft}}>v{APP_VERSION}</span></p>

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
          <Btn small v="ai" onClick={() => { setAddCategory(null); setEditId(null); setTestResult(null); setModels([]); setForm({ provider:"", name:"", apiKey:"", baseUrl:"", model:"" }); setShowAdd(true); }}>+ Add Profile</Btn>
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
                  <button className="sf-icon-btn" title="Duplicate" onClick={e=>{e.stopPropagation();duplicateProfile(p)}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Copy s={14}/></button>
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
              <input type="range" min="75" max="300" step="5" value={data.fontScale||100} onChange={e=>{const v=Number(e.target.value);setFontScale(v);setData(d=>({...d,fontScale:v}))}} style={{flex:1,accentColor:T.accent}}/>
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
            <Badge color={data.ytApiKey?T.blue:T.dim} bg={data.ytApiKey?T.blueD:T.bg2}>{data.ytApiKey?"Active":"Not Set"}</Badge>
          </div>
          <p style={{fontSize:fs(11),color:T.dim,marginBottom:8}}>Enables live stats, stream detection, and viewer counts in Study Radio. Get a free key from the Google Cloud Console.</p>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input value={data.ytApiKey||""} onChange={e=>setData(d=>({...d,ytApiKey:e.target.value}))} placeholder="Enter YouTube Data API v3 key" type="password" autoComplete="off" style={{flex:1,fontSize:fs(11)}} />
            <Btn small v="ai" onClick={()=>{const k=getYtApiKey(data);if(!k){toast("Add an API key first","warn");return;}fetchYtStats(k);toast("Fetching stats...","info")}}>Refresh</Btn>
            {data.ytApiKey && <Btn small v="ghost" onClick={()=>{setData(d=>({...d,ytApiKey:""}));toast("API key removed","info")}}>Clear</Btn>}
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
            const fullBackup = { ...data, _meta: { version: APP_VERSION, exportDate: new Date().toISOString(), type: "vorra-backup" }, _favorites: JSON.parse(localStorage.getItem('vorra-favs') || '{"soma":[],"yt":[]}'), _customStreams: JSON.parse(localStorage.getItem('vorra-custom-streams') || '[]') };
            const blob = new Blob([JSON.stringify(fullBackup, null, 2)], {type:"application/json"});
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `vorra-backup-${todayStr()}.json`; a.click(); URL.revokeObjectURL(url);
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
                  if (imported._favorites) { localStorage.setItem('vorra-favs', JSON.stringify(imported._favorites)); delete imported._favorites; }
                  if (imported._customStreams) { localStorage.setItem('vorra-custom-streams', JSON.stringify(imported._customStreams)); delete imported._customStreams; }
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
            localStorage.removeItem('vorra-v1'); localStorage.removeItem('vorra-favs'); localStorage.removeItem('vorra-custom-streams');
            setData({...INIT});
            toast("All data erased", "warn");
            dlog('warn','settings',"Full data reset");
          }}>Reset All Data</Btn>
        </div>
      </div>
      {/* Profile Add/Edit Modal */}
      {showAdd && (
        <Modal title={editId ? "Edit Profile" : "Add AI Profile"} onClose={() => setShowAdd(false)} wide>
          {/* ── Step 1: Category Selection ── */}
          {!editId && addCategory === null && !form.provider && (() => {
            const lastProv = lastUsedProvider(profiles);
            const lastCat = lastProv && PROVIDERS[lastProv] ? PROVIDERS[lastProv].cat : null;
            return (
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <p style={{fontSize:fs(12),color:T.dim,marginBottom:4}}>Choose a provider type to get started</p>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                {PROVIDER_CATS.map(cat => {
                  const CatIcon = Ic[cat.icon];
                  const isLast = cat.key === lastCat;
                  return (
                    <button key={cat.key} className="sf-card" onClick={() => setAddCategory(cat.key)} style={{padding:"20px 16px",borderRadius:12,cursor:"pointer",border:`1.5px solid ${isLast ? T.accent : T.border}`,background:isLast ? T.accentD : T.input,color:T.text,textAlign:"center",transition:"all .2s",position:"relative"}}>
                      {isLast && <div style={{position:"absolute",top:6,right:8,fontSize:fs(8),color:T.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px"}}>Last used</div>}
                      <div style={{marginBottom:8}}>{CatIcon && <CatIcon s={22} c={T.accent}/>}</div>
                      <div style={{fontSize:fs(13),fontWeight:700,marginBottom:4}}>{cat.label}</div>
                      <div style={{fontSize:fs(10),color:T.dim}}>{cat.desc}</div>
                    </button>
                  );
                })}
              </div>
              <button className="sf-chip" onClick={() => { setForm({ provider:"custom", name:"Custom", apiKey:"", baseUrl:"", model:"" }); setAddCategory("custom"); }} style={{padding:"10px 16px",borderRadius:8,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1px solid ${T.border}`,background:T.input,color:T.soft,textAlign:"center"}}>
                + Custom Provider (manual configuration)
              </button>
            </div>
            );
          })()}

          {/* ── Step 2: Provider Grid ── */}
          {!editId && addCategory !== null && addCategory !== "custom" && !form.provider && (
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <button className="sf-chip" onClick={() => setAddCategory(null)} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1px solid ${T.border}`,background:T.input,color:T.dim}}>
                  Back
                </button>
                <span style={{fontSize:fs(13),fontWeight:700}}>{PROVIDER_CATS.find(c=>c.key===addCategory)?.label}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",gap:8}}>
                {(() => { const lp = lastUsedProvider(profiles); return Object.entries(PROVIDERS).filter(([,p]) => p.cat === addCategory).map(([key, p]) => {
                  const ProvIcon = p.icon ? Ic[p.icon] : null;
                  const isLast = key === lp;
                  return (
                    <button key={key} className="sf-card" onClick={() => openAdd(key)} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,cursor:"pointer",border:`1.5px solid ${isLast ? T.accent : T.border}`,background:isLast ? T.accentD : T.input,color:T.text,textAlign:"left",transition:"all .15s",position:"relative"}}>
                      {isLast && <div style={{position:"absolute",top:3,right:6,fontSize:fs(7),color:T.accent,fontWeight:700,textTransform:"uppercase"}}>Last</div>}
                      {ProvIcon ? <ProvIcon s={20} c={p.color}/> : <div style={{width:12,height:12,borderRadius:"50%",background:p.color,flexShrink:0,boxShadow:`0 0 6px ${p.color}66`}}/>}
                      <span style={{fontSize:fs(12),fontWeight:600}}>{p.name}</span>
                    </button>
                  );
                }); })()}
              </div>
            </div>
          )}

          {/* ── Step 3: Configure Form (Progressive Disclosure) ── */}
          {(form.provider || editId) && (() => {
            const prov = PROVIDERS[form.provider];
            const isLocal = prov?.cat === "local";
            const kfmt = keyFormatOk(form.apiKey, form.provider);
            return (
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {/* Back button (only when adding, not editing) */}
              {!editId && form.provider !== "custom" && (
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                  <button className="sf-chip" onClick={() => { setForm({ provider:"", name:"", apiKey:"", baseUrl:"", model:"" }); setModels([]); setTestResult(null); setVerified(false); }} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1px solid ${T.border}`,background:T.input,color:T.dim}}>
                    Back
                  </button>
                  {prov && (
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:prov.color}}/>
                      <span style={{fontSize:fs(13),fontWeight:700}}>{prov.name}</span>
                    </div>
                  )}
                </div>
              )}
              {!editId && form.provider === "custom" && (
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                  <button className="sf-chip" onClick={() => { setForm({ provider:"", name:"", apiKey:"", baseUrl:"", model:"" }); setAddCategory(null); setModels([]); setTestResult(null); setVerified(false); }} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1px solid ${T.border}`,background:T.input,color:T.dim}}>
                    Back
                  </button>
                  <span style={{fontSize:fs(13),fontWeight:700}}>Custom Provider</span>
                </div>
              )}

              {/* Profile Name */}
              <div><Label>Profile Name</Label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. My Claude API"/></div>

              {/* API Key with inline format validation */}
              <div>
                <Label>API Key {isLocal ? <span style={{color:T.dim,fontWeight:400}}>(optional)</span> : kfmt === "optional" ? <span style={{color:T.dim,fontWeight:400}}>(optional)</span> : null}</Label>
                <div style={{position:"relative"}}>
                  <input type="password" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})} placeholder={prov?.keyHint || (isAnthProvider(form)?"sk-ant-...":"sk-...")} style={{paddingRight:32}}/>
                  {/* Inline key format indicator */}
                  {form.apiKey && kfmt === "match" && (
                    <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",color:T.accent,fontSize:fs(14)}} title="Key format matches expected pattern">&#10003;</span>
                  )}
                  {form.apiKey && kfmt === "mismatch" && (
                    <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",width:10,height:10,borderRadius:"50%",background:T.orange,display:"inline-block"}} title="Key format may not match expected pattern"/>
                  )}
                </div>
                {prov?.keyHint && prov.keyHint !== "(none needed)" && <div style={{fontSize:fs(9),color:T.dim,marginTop:3}}>Expected format: {prov.keyHint}</div>}
              </div>

              {/* Base URL — collapsed under Advanced toggle */}
              <div>
                {!showAdvancedUrl && !editId ? (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:fs(11),color:T.dim}}>Base URL: <span className="mono" style={{fontSize:fs(10),color:T.soft}}>{form.baseUrl ? (form.baseUrl.length > 50 ? form.baseUrl.slice(0,50)+"..." : form.baseUrl) : "not set"}</span></span>
                    <button onClick={() => setShowAdvancedUrl(true)} style={{background:"none",border:"none",color:T.accent,fontSize:fs(10),cursor:"pointer",textDecoration:"underline",padding:0}}>Edit</button>
                  </div>
                ) : (
                  <div>
                    <Label>Base URL</Label>
                    <input value={form.baseUrl} onChange={e=>setForm({...form,baseUrl:e.target.value})} placeholder="https://api.openai.com/v1/chat/completions"/>
                  </div>
                )}
              </div>

              {/* Test result banner */}
              {testResult && (
                <div className="fade" style={{padding:"10px 14px",borderRadius:8,background:testResult.ok?T.accentD:T.redD,border:`1px solid ${testResult.ok?T.accent:T.red}44`,fontSize:fs(12),color:testResult.ok?T.accent:T.red}}>
                  {testResult.ok?"✓ ":"✗ "}{testResult.msg}
                </div>
              )}

              {/* Connect & Verify button (shown when not yet verified) */}
              {!verified && (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,marginTop:2}}>
                  <Btn v="ai" onClick={testConnection} disabled={testing || (!form.apiKey && !isLocal) || !form.baseUrl} style={{width:"100%",justifyContent:"center"}}>
                    {testing ? (<><span className="spinner" style={{display:"inline-block",width:14,height:14,border:`2px solid rgba(255,255,255,0.3)`,borderTopColor:"#fff",borderRadius:"50%",animation:"spin .6s linear infinite",marginRight:6}}/> Verifying...</>) : (<><span style={{fontSize:fs(16),marginRight:4}}>{"\u26A1"}</span> Connect & Verify</>)}
                  </Btn>
                  <button onClick={() => { setVerified(true); setTestResult({ ok: true, msg: "Verification skipped" }); }} style={{background:"none",border:"none",color:T.dim,fontSize:fs(10),cursor:"pointer",textDecoration:"underline",padding:0}}>Skip verification — I know my key works</button>
                </div>
              )}

              {/* Model dropdown — locked until verified */}
              <div className={verified ? "fade" : ""}>
                <Label>Model</Label>
                {!verified ? (
                  <div style={{padding:"10px 14px",borderRadius:8,background:T.input,border:`1px solid ${T.border}`,color:T.dim,fontSize:fs(11),opacity:0.6}}>
                    Verify connection to select model
                  </div>
                ) : models.length > 0 ? (
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <select value={form.model} onChange={e=>setForm({...form,model:e.target.value})}>
                      <option value="">Select a model...</option>
                      {models.map(m=><option key={m} value={m}>{m}</option>)}
                    </select>
                    <input value={form.model} onChange={e=>setForm({...form,model:e.target.value})} placeholder="Or type a custom model name..." style={{fontSize:fs(11)}}/>
                  </div>
                ) : (
                  <input value={form.model} onChange={e=>setForm({...form,model:e.target.value})} placeholder={isAnthProvider(form)?"claude-sonnet-4-20250514":"gpt-4o"}/>
                )}
              </div>

              {/* Action buttons */}
              <div style={{display:"flex",gap:8,marginTop:4}}>
                {verified && (
                  <Btn v="ghost" onClick={() => { setVerified(false); setTestResult(null); }} style={{fontSize:fs(11)}}>
                    Re-test
                  </Btn>
                )}
                {verified && (
                  <div className="fade">
                    <Btn onClick={saveProfile} disabled={!form.name || (!form.apiKey && !isLocal) || !form.baseUrl}>
                      {editId?"Save Changes":"Save Profile"}
                    </Btn>
                  </div>
                )}
              </div>
            </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
};

export { SettingsPage };
export default SettingsPage;
