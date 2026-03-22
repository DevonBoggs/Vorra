// OnboardingWizard — 4-step first-run wizard
import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTheme, fs } from '../../styles/tokens.js';
import { uid } from '../../utils/helpers.js';
import { UNIVERSITY_PRESETS, EMPTY_UNIVERSITY_PROFILE } from '../../constants/universityProfiles.js';

const TOTAL_STEPS = 4;

const SCHOOL_CARDS = [
  { presetId: 'wgu', emoji: '\uD83C\uDF93', name: 'WGU', desc: 'Competency-based, self-paced' },
  { presetId: 'snhu', emoji: '\uD83C\uDFEB', name: 'SNHU', desc: 'Credit-hour, 8-week terms' },
  { presetId: 'asu-online', emoji: '\u2600\uFE0F', name: 'ASU Online', desc: 'Public university, flexible online' },
  { presetId: 'purdue-global', emoji: '\uD83D\uDD2C', name: 'Purdue Global', desc: 'Career-focused online degrees' },
  { presetId: 'self-study', emoji: '\uD83D\uDCDA', name: 'Independent', desc: 'Self-directed learning, no school' },
  { presetId: 'skip', emoji: '\u23ED\uFE0F', name: 'Skip', desc: 'Set up later in Settings' },
];

const AI_PROVIDERS = [
  {
    id: 'groq',
    name: 'Groq',
    badge: 'Free tier available',
    badgeColor: 'accent',
    desc: 'Fast responses, generous free tier. Great for getting started.',
    defaultModel: 'llama-3.3-70b-versatile',
    format: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: 'Free tier available',
    badgeColor: 'blue',
    desc: 'Google\'s AI with free usage tier.',
    defaultModel: 'gemini-2.0-flash',
    format: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badge: 'Most popular',
    badgeColor: 'purple',
    desc: 'Best quality, requires paid API key (~$5/month).',
    defaultModel: 'gpt-4o-mini',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
];

// ── Step Indicator ───────────────────────────────────────────────────
const StepDots = ({ step, T }) => (
  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 28 }}>
    {Array.from({ length: TOTAL_STEPS }, (_, i) => (
      <div
        key={i}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: i === step ? T.accent : i < step ? `${T.accent}80` : T.border,
          transition: 'background .2s',
        }}
      />
    ))}
  </div>
);

// ── Step 0: Welcome + School ─────────────────────────────────────────
const StepSchool = ({ data, setData, next, T }) => {
  const handlePick = (presetId) => {
    if (presetId === 'skip') {
      next();
      return;
    }
    const preset = UNIVERSITY_PRESETS.find(p => p.presetId === presetId);
    if (preset) {
      setData(d => ({ ...d, universityProfile: { ...preset } }));
    }
    next();
  };

  return (
    <div>
      <h2 style={{ fontSize: fs(24), fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>Welcome to Vorra</h2>
      <p style={{ color: T.soft, fontSize: fs(14), textAlign: 'center', marginBottom: 28 }}>
        Let's set up your study plan in under 2 minutes.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        {SCHOOL_CARDS.map(s => (
          <button
            key={s.presetId}
            onClick={() => handlePick(s.presetId)}
            style={{
              background: T.input,
              border: `1.5px solid ${data.universityProfile?.presetId === s.presetId ? T.accent : T.border}`,
              borderRadius: 14,
              padding: '18px 16px',
              cursor: 'pointer',
              textAlign: 'left',
              color: T.text,
              transition: 'border-color .15s, background .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.card; e.currentTarget.style.borderColor = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.background = T.input; e.currentTarget.style.borderColor = data.universityProfile?.presetId === s.presetId ? T.accent : T.border; }}
          >
            <div style={{ fontSize: fs(24), marginBottom: 8 }}>{s.emoji}</div>
            <div style={{ fontSize: fs(15), fontWeight: 700, marginBottom: 4 }}>{s.name}</div>
            <div style={{ fontSize: fs(12), color: T.soft, lineHeight: 1.4 }}>{s.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Step 1: AI Setup ─────────────────────────────────────────────────
const StepAI = ({ data, setData, next, T }) => {
  const [expanded, setExpanded] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  const alreadyConnected = data.profiles?.length > 0;

  const handleExpand = (providerId) => {
    const prov = AI_PROVIDERS.find(p => p.id === providerId);
    setExpanded(providerId);
    setApiKey('');
    setBaseUrl(prov?.baseUrl || '');
    setShowAdvanced(false);
    setError('');
  };

  const handleConnect = async (provider) => {
    if (!apiKey.trim()) {
      setError('Please enter an API key.');
      return;
    }
    setTesting(true);
    setError('');

    const profile = {
      id: uid(),
      name: provider.name,
      provider: provider.id,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || provider.baseUrl,
      model: provider.defaultModel,
      format: provider.format,
    };

    // Try a quick test call
    try {
      const testUrl = `${profile.baseUrl}/models`;
      const resp = await fetch(testUrl, {
        headers: { 'Authorization': `Bearer ${profile.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok && resp.status !== 404) {
        // 404 on /models is okay for some providers
        const body = await resp.text().catch(() => '');
        if (resp.status === 401 || resp.status === 403) {
          setError('Invalid API key. Please check and try again.');
          setTesting(false);
          return;
        }
      }
    } catch (e) {
      // Network errors — still save, user can fix later
    }

    setData(d => ({
      ...d,
      profiles: [...(d.profiles || []), profile],
      activeProfileId: d.activeProfileId || profile.id,
    }));
    setTesting(false);
    setExpanded(null);
    setApiKey('');
    next();
  };

  if (alreadyConnected) {
    const activeName = data.profiles.find(p => p.id === data.activeProfileId)?.name || data.profiles[0]?.name;
    return (
      <div>
        <h2 style={{ fontSize: fs(24), fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>Connect an AI provider</h2>
        <p style={{ color: T.soft, fontSize: fs(14), textAlign: 'center', marginBottom: 28 }}>
          Vorra uses AI to build study plans, enrich courses, and answer questions.
        </p>
        <div style={{
          background: T.accentD,
          border: `1.5px solid ${T.accent}`,
          borderRadius: 14,
          padding: '20px 24px',
          textAlign: 'center',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: fs(20), marginBottom: 8, color: T.accent }}>&#10003;</div>
          <div style={{ fontSize: fs(15), fontWeight: 700, marginBottom: 4 }}>Already connected</div>
          <div style={{ fontSize: fs(13), color: T.soft }}>{activeName}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <button onClick={next} style={{ ...btnStyle(T, 'accent'), padding: '10px 32px' }}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: fs(24), fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>Connect an AI provider</h2>
      <p style={{ color: T.soft, fontSize: fs(14), textAlign: 'center', marginBottom: 28 }}>
        Vorra uses AI to build study plans, enrich courses, and answer questions.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {AI_PROVIDERS.map(prov => (
          <div
            key={prov.id}
            style={{
              background: expanded === prov.id ? T.card : T.input,
              border: `1.5px solid ${expanded === prov.id ? T.accent : T.border}`,
              borderRadius: 14,
              padding: '16px 20px',
              cursor: expanded === prov.id ? 'default' : 'pointer',
              transition: 'border-color .15s, background .15s',
            }}
            onClick={() => expanded !== prov.id && handleExpand(prov.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: fs(15), fontWeight: 700 }}>{prov.name}</span>
                  <span style={{
                    fontSize: fs(10),
                    fontWeight: 600,
                    background: T[prov.badgeColor + 'D'] || T.accentD,
                    color: T[prov.badgeColor] || T.accent,
                    padding: '2px 8px',
                    borderRadius: 999,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {prov.badge}
                  </span>
                </div>
                <div style={{ fontSize: fs(12), color: T.soft, lineHeight: 1.4 }}>{prov.desc}</div>
              </div>
              {expanded !== prov.id && (
                <div style={{ color: T.dim, fontSize: fs(12) }}>&#9654;</div>
              )}
            </div>

            {expanded === prov.id && (
              <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>
                <label style={{ fontSize: fs(11), fontWeight: 600, color: T.soft, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block' }}>
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={`Paste your ${prov.name} API key`}
                  style={{
                    width: '100%',
                    background: T.bg2,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: '10px 12px',
                    color: T.text,
                    fontSize: fs(13),
                    outline: 'none',
                    boxSizing: 'border-box',
                    marginBottom: 8,
                  }}
                />

                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{ background: 'none', border: 'none', color: T.dim, fontSize: fs(11), cursor: 'pointer', padding: 0, marginBottom: showAdvanced ? 8 : 0 }}
                >
                  {showAdvanced ? '- Hide advanced' : '+ Advanced'}
                </button>

                {showAdvanced && (
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: fs(11), fontWeight: 600, color: T.soft, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block' }}>
                      Base URL
                    </label>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder={prov.baseUrl}
                      style={{
                        width: '100%',
                        background: T.bg2,
                        border: `1px solid ${T.border}`,
                        borderRadius: 8,
                        padding: '10px 12px',
                        color: T.text,
                        fontSize: fs(13),
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}

                {error && (
                  <div style={{ color: T.red, fontSize: fs(12), marginBottom: 8 }}>{error}</div>
                )}

                <button
                  onClick={() => handleConnect(prov)}
                  disabled={testing}
                  style={{
                    ...btnStyle(T, 'accent'),
                    width: '100%',
                    padding: '10px 0',
                    marginTop: 8,
                    opacity: testing ? 0.6 : 1,
                  }}
                >
                  {testing ? 'Testing...' : 'Test & Connect'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button onClick={next} style={{ background: 'none', border: 'none', color: T.dim, fontSize: fs(12), cursor: 'pointer', textDecoration: 'underline' }}>
          I'll set this up later
        </button>
      </div>
    </div>
  );
};

// ── Step 2: Courses ──────────────────────────────────────────────────
const StepCourses = ({ data, setData, setPage, onComplete, next, T }) => {
  const [mode, setMode] = useState(null); // null | 'csv' | 'manual'
  const [csvText, setCsvText] = useState('');
  const [csvError, setCsvError] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [manualCredits, setManualCredits] = useState(3);
  const [manualDifficulty, setManualDifficulty] = useState(3);
  const [addedCourses, setAddedCourses] = useState([]);

  const handleScreenshot = () => {
    onComplete();
    setPage('courses');
  };

  const handleCSVParse = () => {
    setCsvError('');
    if (!csvText.trim()) {
      setCsvError('Please paste CSV content.');
      return;
    }
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      setCsvError('Need at least a header row and one data row.');
      return;
    }
    // Skip header
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if (cols.length < 1 || !cols[0]) continue;
      parsed.push({
        id: uid(),
        name: cols[0],
        courseCode: cols[1] || '',
        credits: Number(cols[2]) || 3,
        difficulty: Number(cols[3]) || 3,
        status: 'not_started',
      });
    }
    if (parsed.length === 0) {
      setCsvError('No valid courses found. Expected: Name, Code, Credits, Difficulty');
      return;
    }
    setData(d => ({ ...d, courses: [...(d.courses || []), ...parsed] }));
    setAddedCourses(prev => [...prev, ...parsed]);
    setMode(null);
    setCsvText('');
  };

  const handleAddManual = () => {
    if (!manualName.trim()) return;
    const course = {
      id: uid(),
      name: manualName.trim(),
      courseCode: manualCode.trim(),
      credits: manualCredits,
      difficulty: manualDifficulty,
      status: 'not_started',
    };
    setData(d => ({ ...d, courses: [...(d.courses || []), course] }));
    setAddedCourses(prev => [...prev, course]);
    setManualName('');
    setManualCode('');
    setManualCredits(3);
    setManualDifficulty(3);
  };

  const totalCourses = (data.courses?.length || 0);
  const inputSt = {
    width: '100%',
    background: T.bg2,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    padding: '10px 12px',
    color: T.text,
    fontSize: fs(13),
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: 8,
  };

  return (
    <div>
      <h2 style={{ fontSize: fs(24), fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>Add your courses</h2>
      <p style={{ color: T.soft, fontSize: fs(14), textAlign: 'center', marginBottom: 8 }}>
        Import from your degree plan or add manually.
      </p>
      {totalCourses > 0 && (
        <div style={{ textAlign: 'center', marginBottom: 16, color: T.accent, fontSize: fs(13), fontWeight: 600 }}>
          {totalCourses} course{totalCourses !== 1 ? 's' : ''} added
        </div>
      )}

      {!mode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button onClick={handleScreenshot} style={optionCardStyle(T)}>
            <div style={{ fontSize: fs(20), marginBottom: 4 }}>&#128247;</div>
            <div style={{ fontSize: fs(14), fontWeight: 700, marginBottom: 2 }}>Screenshot / Image</div>
            <div style={{ fontSize: fs(12), color: T.soft }}>Upload a photo of your degree plan</div>
          </button>
          <button onClick={() => setMode('csv')} style={optionCardStyle(T)}>
            <div style={{ fontSize: fs(20), marginBottom: 4 }}>&#128196;</div>
            <div style={{ fontSize: fs(14), fontWeight: 700, marginBottom: 2 }}>Import CSV</div>
            <div style={{ fontSize: fs(12), color: T.soft }}>Paste or upload a CSV file</div>
          </button>
          <button onClick={() => setMode('manual')} style={optionCardStyle(T)}>
            <div style={{ fontSize: fs(20), marginBottom: 4 }}>&#9997;&#65039;</div>
            <div style={{ fontSize: fs(14), fontWeight: 700, marginBottom: 2 }}>Type manually</div>
            <div style={{ fontSize: fs(12), color: T.soft }}>Add courses one at a time</div>
          </button>
        </div>
      )}

      {mode === 'csv' && (
        <div>
          <label style={labelStyle(T)}>Paste CSV (Name, Code, Credits, Difficulty)</label>
          <textarea
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            rows={6}
            placeholder={'Course Name, Code, Credits, Difficulty\nIntro to CS, CS101, 3, 2\nData Structures, CS201, 4, 4'}
            style={{ ...inputSt, resize: 'vertical', fontFamily: '\'JetBrains Mono\', monospace', fontSize: fs(12) }}
          />
          {csvError && <div style={{ color: T.red, fontSize: fs(12), marginBottom: 8 }}>{csvError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCSVParse} style={{ ...btnStyle(T, 'accent'), flex: 1 }}>Parse & Add</button>
            <button onClick={() => { setMode(null); setCsvText(''); setCsvError(''); }} style={{ ...btnStyle(T, 'dim'), flex: 1 }}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'manual' && (
        <div>
          {addedCourses.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {addedCourses.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ color: T.accent, fontSize: fs(12) }}>&#10003;</span>
                  <span style={{ fontSize: fs(13), flex: 1 }}>{c.name}</span>
                  <span style={{ fontSize: fs(11), color: T.soft }}>{c.credits} cr</span>
                </div>
              ))}
            </div>
          )}
          <label style={labelStyle(T)}>Course Name</label>
          <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="e.g. Intro to Computer Science" style={inputSt} />
          <label style={labelStyle(T)}>Course Code</label>
          <input value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder="e.g. CS101" style={inputSt} />
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle(T)}>Credits</label>
              <input type="number" min={1} max={12} value={manualCredits} onChange={e => setManualCredits(Number(e.target.value) || 3)} style={inputSt} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle(T)}>Difficulty (1-5)</label>
              <input type="range" min={1} max={5} value={manualDifficulty} onChange={e => setManualDifficulty(Number(e.target.value))} style={{ width: '100%', accentColor: T.accent }} />
              <div style={{ textAlign: 'center', fontSize: fs(12), color: T.soft }}>{manualDifficulty}/5</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAddManual} disabled={!manualName.trim()} style={{ ...btnStyle(T, 'accent'), flex: 1, opacity: manualName.trim() ? 1 : 0.5 }}>
              Add Course
            </button>
            <button onClick={() => setMode(null)} style={{ ...btnStyle(T, 'dim'), flex: 1 }}>Done</button>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button onClick={next} style={{ background: 'none', border: 'none', color: T.dim, fontSize: fs(12), cursor: 'pointer', textDecoration: 'underline' }}>
          Skip for now
        </button>
      </div>
    </div>
  );
};

// ── Step 3: Ready ────────────────────────────────────────────────────
const StepReady = ({ data, setPage, onComplete, T }) => {
  const schoolName = data.universityProfile?.shortName || data.universityProfile?.name || 'Not set';
  const aiName = data.profiles?.length > 0
    ? (data.profiles.find(p => p.id === data.activeProfileId)?.name || data.profiles[0]?.name)
    : 'Not connected';
  const courseCount = data.courses?.length || 0;

  const summaryCards = [
    { label: 'School', value: schoolName, color: T.blue },
    { label: 'AI', value: aiName, color: T.purple },
    { label: 'Courses', value: courseCount > 0 ? `${courseCount} course${courseCount !== 1 ? 's' : ''}` : 'None yet', color: T.orange },
  ];

  return (
    <div>
      <h2 style={{ fontSize: fs(24), fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>You're all set!</h2>
      <div style={{ display: 'flex', gap: 12, marginTop: 24, marginBottom: 24 }}>
        {summaryCards.map(c => (
          <div key={c.label} style={{
            flex: 1,
            background: T.input,
            border: `1.5px solid ${T.border}`,
            borderRadius: 12,
            padding: '16px 14px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: fs(11), fontWeight: 600, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: fs(14), fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{
        background: T.orangeD,
        border: `1px solid ${T.orange}33`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 28,
      }}>
        <p style={{ fontSize: fs(12), color: T.soft, lineHeight: 1.6, margin: 0 }}>
          Vorra uses AI to generate study plans, course data, and practice questions. These are estimates — always verify with your school's official materials.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={() => { onComplete(); setPage('planner'); }}
          style={{ ...btnStyle(T, 'accent'), flex: 1, padding: '12px 0', fontWeight: 700, fontSize: fs(14) }}
        >
          Go to Study Planner &#8594;
        </button>
        <button
          onClick={() => { onComplete(); setPage('dashboard'); }}
          style={{ ...btnStyle(T, 'dim'), flex: 1, padding: '12px 0', fontWeight: 700, fontSize: fs(14) }}
        >
          Explore Dashboard
        </button>
      </div>
    </div>
  );
};

// ── Shared Styles ────────────────────────────────────────────────────
const btnStyle = (T, variant) => ({
  background: variant === 'accent' ? T.accent : variant === 'dim' ? T.input : T.card,
  color: variant === 'accent' ? '#000' : T.text,
  border: variant === 'accent' ? 'none' : `1.5px solid ${T.border}`,
  borderRadius: 10,
  padding: '8px 20px',
  fontSize: fs(13),
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'opacity .15s',
});

const optionCardStyle = (T) => ({
  background: T.input,
  border: `1.5px solid ${T.border}`,
  borderRadius: 14,
  padding: '18px 20px',
  cursor: 'pointer',
  textAlign: 'left',
  color: T.text,
  transition: 'border-color .15s',
  width: '100%',
});

const labelStyle = (T) => ({
  fontSize: fs(11),
  fontWeight: 600,
  color: T.soft,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 6,
  display: 'block',
});

// ── Main Wizard Component ────────────────────────────────────────────
const OnboardingWizard = ({ data, setData, profile, setPage, onComplete }) => {
  const T = useTheme();
  const [step, setStep] = useState(0);

  const next = useCallback(() => setStep(s => Math.min(s + 1, TOTAL_STEPS - 1)), []);
  const back = useCallback(() => setStep(s => Math.max(s - 1, 0)), []);

  const handleComplete = useCallback(() => {
    setData(d => ({ ...d, onboardingComplete: true }));
    if (onComplete) onComplete();
  }, [setData, onComplete]);

  return createPortal(
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,.85)',
      backdropFilter: 'blur(16px)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div className="slide-up" style={{
        background: T.card,
        border: `1.5px solid ${T.border}`,
        borderRadius: 20,
        padding: 32,
        width: '100%',
        maxWidth: 560,
        maxHeight: '88vh',
        overflowY: 'auto',
        boxShadow: `0 24px 60px rgba(0,0,0,.5), 0 0 0 1px ${T.border}`,
      }}>
        <StepDots step={step} T={T} />

        {step === 0 && <StepSchool data={data} setData={setData} next={next} T={T} />}
        {step === 1 && <StepAI data={data} setData={setData} next={next} T={T} />}
        {step === 2 && <StepCourses data={data} setData={setData} setPage={setPage} onComplete={handleComplete} next={next} T={T} />}
        {step === 3 && <StepReady data={data} setPage={setPage} onComplete={handleComplete} T={T} />}

        {/* Navigation footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          <div>
            {step > 0 && (
              <button onClick={back} style={{ background: 'none', border: 'none', color: T.soft, fontSize: fs(13), cursor: 'pointer' }}>
                &#8592; Back
              </button>
            )}
          </div>
          <div>
            {step < TOTAL_STEPS - 1 && (
              <button onClick={next} style={{ background: 'none', border: 'none', color: T.dim, fontSize: fs(12), cursor: 'pointer' }}>
                Skip
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export { OnboardingWizard };
export default OnboardingWizard;
