import { useState, useMemo, useRef, useEffect } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { STATIONS, STATION_CATS, useStationHealth, audioPlay, audioStop, audioToggle, audioPauseToggle, audioSetVolume, useAudio } from "../../systems/audio.js";
import { ytAddStream, ytRemoveStream, ytClearAll, ytPauseToggle, ytPauseAll, ytSetVolume, useYtStreams, useYtHealth, useYtCheckProgress, useYtStats, useFavs, toggleFav, useCustomStreams, addCustomStream, removeCustomStream, fmtNum, getYtApiKey, DEFAULT_YT_API_KEY } from "../../systems/youtube.js";
import { YT_STREAMS, YT_CATS, YT_PARENT_CATS } from "../../streams.js";
import { VolumeBar } from "../../components/ui/VolumeBar.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Btn } from "../../components/ui/Btn.jsx";

const AmbientPage = () => {
  const T = useTheme();
  const bp = useBreakpoint();
  const audio = useAudio();
  const health = useStationHealth();
  const ytHealth = useYtHealth();
  const ytStreams = useYtStreams();
  const ytStats = useYtStats();
  const favs = useFavs();
  const checkProgress = useYtCheckProgress();
  const customStreams = useCustomStreams();
  const [customUrl, setCustomUrl] = useState("");
  const [mainTab, setMainTab] = useState("youtube");
  const [filterCat, setFilterCat] = useState("all");
  const [ytFilterCat, setYtFilterCat] = useState("all");
  const [showDead, setShowDead] = useState(false);
  const [ytSort, setYtSort] = useState("popular");
  const [showFavs, setShowFavs] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [ytSearch, setYtSearch] = useState("");
  const [ytShowCount, setYtShowCount] = useState(60);
  const fmtMs=(ms)=>`${Math.floor(ms/60000)}:${String(Math.floor((ms%60000)/1000)).padStart(2,"0")}`;
  // Reset pagination when filter/search changes
  useEffect(() => { setYtShowCount(60); }, [ytFilterCat, ytSearch, showFavs]);

  // Discover state
  const [discQ, setDiscQ] = useState("");
  const [discResults, setDiscResults] = useState([]);
  const [discLoading, setDiscLoading] = useState(false);
  const [discSearched, setDiscSearched] = useState(false);
  const [discLastQ, setDiscLastQ] = useState("");
  const [discNextPage, setDiscNextPage] = useState("");
  const [discType, setDiscType] = useState("video");
  const [discSort, setDiscSort] = useState("relevance"); // relevance | views | date | duration

  // Chat panel state (live chat only, comments removed)
  const [chatPanel, setChatPanel] = useState(true);
  const [chatAvail, setChatAvail] = useState(true);

  // ── Quick Focus + Ambient Mixer + Sleep Timer state ──
  const [sleepTimer, setSleepTimer] = useState(0); // minutes remaining, 0 = off
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const sleepRef = useRef(null);
  const [showMixer, setShowMixer] = useState(false);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [savePresetName, setSavePresetName] = useState('');
  const [savePresetEmoji, setSavePresetEmoji] = useState('🎵');

  // Custom presets — stored in localStorage, loaded into state
  const customPresetsKey = 'vorra-audio-presets';
  const [customPresets, setCustomPresets] = useState(() => { try { return JSON.parse(localStorage.getItem(customPresetsKey) || '[]'); } catch (_) { return []; } });
  const saveCustomPresets = (presets) => { setCustomPresets(presets); try { localStorage.setItem(customPresetsKey, JSON.stringify(presets)); } catch (_) {} };

  // Icon lookup for presets
  const PRESET_ICON_LIST = [
    { id: 'rain', label: 'Rain' }, { id: 'cafe', label: 'Cafe' }, { id: 'fire', label: 'Fire' },
    { id: 'ocean', label: 'Ocean' }, { id: 'forest', label: 'Forest' }, { id: 'moon', label: 'Moon' },
    { id: 'piano', label: 'Piano' }, { id: 'headphones', label: 'Music' }, { id: 'brain', label: 'Focus' },
    { id: 'vinyl', label: 'Vinyl' }, { id: 'guitar', label: 'Guitar' }, { id: 'thunder', label: 'Storm' },
    { id: 'star', label: 'Star' }, { id: 'wave', label: 'Wave' }, { id: 'sunset', label: 'Sunset' },
    { id: 'space', label: 'Space' }, { id: 'gamepad', label: 'Gaming' }, { id: 'zen', label: 'Zen' },
    { id: 'bird', label: 'Birds' }, { id: 'sleep', label: 'Sleep' }, { id: 'noise', label: 'Noise' },
    { id: 'crystal', label: 'Crystal' }, { id: 'violin', label: 'Violin' }, { id: 'mix', label: 'Mix' },
  ];
  const renderPresetIcon = (iconId, size = 24, color) => {
    const IconComp = Ic.PRESET_ICONS?.[iconId];
    return IconComp ? <IconComp s={size} c={color || T.accent} /> : <span style={{ fontSize: size }}>{iconId || '🎵'}</span>;
  };

  // Presets — each uses real YouTube streams (multi-stacked up to 4)
  const FOCUS_PRESETS = [
    { id: 'lofi-rain', name: 'Lo-fi + Rain', icon: 'rain', streams: [
      { vid: 'jfKfPfyJRdk', name: 'Lofi Girl', cat: 'lofi-beats', type: 'live' },
      { vid: 'mPZkdNFkNps', name: 'Rain on Window', cat: 'ambient-rain', type: 'video' },
    ], volumes: { 0: 30, 1: 7 } },
    { id: 'cafe-study', name: 'Cafe Study', icon: 'cafe', streams: [
      YT_STREAMS.find(s => s.cat === 'jazz-cafe'),
      YT_STREAMS.find(s => s.cat === 'ambient-cafe'),
    ].filter(Boolean) },
    { id: 'brown-noise', name: 'Brown Noise', icon: 'noise', streams: [
      YT_STREAMS.find(s => s.cat === 'noise-brown'),
    ].filter(Boolean) },
    { id: 'cozy-night', name: 'Cozy Rainy Night', icon: 'moon', streams: [
      { vid: 'zW5wpJY1rgQ', name: 'Cozy Rainy Night Jazz', cat: 'jazz-night', type: 'video' },
      { vid: 'mPZkdNFkNps', name: 'Rain on Window', cat: 'ambient-rain', type: 'video' },
    ], volumes: { 0: 30, 1: 7 } },
    { id: 'nature', name: 'Nature Focus', icon: 'forest', streams: [
      { vid: '43olDlb-qFA', name: 'Nature Sounds', cat: 'ambient-nature', type: 'video' },
      { vid: 'bN6PNAN3ZCc', name: 'Forest Birds', cat: 'ambient-nature', type: 'video' },
      { vid: 'jKtofppPJFk', name: 'Forest River Stream', cat: 'ambient-river', type: 'live' },
    ], volumes: { 0: 20, 1: 7, 2: 7 } },
  ];

  const AMBIENT_SOUNDS = [
    { id: 'rain', name: 'Rain', emoji: '🌧️' },
    { id: 'storm', name: 'Storm', emoji: '⛈️' },
    { id: 'cafe', name: 'Cafe', emoji: '☕' },
    { id: 'fire', name: 'Fire', emoji: '🔥' },
    { id: 'ocean', name: 'Ocean', emoji: '🌊' },
    { id: 'forest', name: 'Forest', emoji: '🌲' },
    { id: 'keys', name: 'Piano', emoji: '🎹' },
    { id: 'typing', name: 'Typing', emoji: '⌨️' },
    { id: 'night', name: 'Night', emoji: '🌙' },
    { id: 'brown', name: 'Brown Noise', emoji: '🟤' },
  ];

  // Last-used audio state (persist to localStorage)
  const lastPresetKey = 'vorra-last-audio-preset';
  const saveLastPreset = (presetId) => { try { localStorage.setItem(lastPresetKey, presetId); } catch (_) {} };
  const getLastPreset = () => { try { return localStorage.getItem(lastPresetKey); } catch (_) { return null; } };

  // Sleep timer tick
  useEffect(() => {
    if (sleepRef.current) clearInterval(sleepRef.current);
    if (!sleepTimerActive || sleepTimer <= 0) return;
    sleepRef.current = setInterval(() => {
      setSleepTimer(prev => {
        if (prev <= 1) {
          // Time's up — fade out all audio
          audioStop();
          ytClearAll();
          setAmbientLayers({});
          setSleepTimerActive(false);
          toast('Sleep timer: audio stopped', 'info');
          return 0;
        }
        return prev - 1;
      });
    }, 60000); // tick every minute
    return () => clearInterval(sleepRef.current);
  }, [sleepTimerActive, sleepTimer]);

  // Apply a quick focus preset
  const applyPreset = (preset) => {
    // Stop current audio
    audioStop();
    ytClearAll();
    // Start streams after brief delay (ytClearAll has a 300ms fade animation)
    setTimeout(() => {
      const streams = preset.streams || [];
      streams.forEach((s, i) => {
        setTimeout(() => {
          ytAddStream(s);
          // Apply custom volumes if specified
          if (preset.volumes && preset.volumes[i] !== undefined) {
            setTimeout(() => ytSetVolume(preset.volumes[i], s.vid), 500);
          }
        }, i * 300); // stagger stream additions
      });
      // Fallback to SomaFM if specified
      if (preset.soma) audioPlay(preset.soma.id);
    }, 400);
    saveLastPreset(preset.id);
    toast(`${preset.emoji} ${preset.name}`, 'success');
  };

  // Resume last preset
  const resumeLast = () => {
    const lastId = getLastPreset();
    const preset = FOCUS_PRESETS.find(p => p.id === lastId);
    if (preset) applyPreset(preset);
    else if (audio.playing) audioPauseToggle();
    else toast('No previous session to resume', 'info');
  };

  // Toggle ambient layer
  const toggleLayer = (id) => {
    setAmbientLayers(prev => {
      const next = { ...prev };
      if (next[id] !== undefined) delete next[id];
      else next[id] = 0.5; // default 50% volume
      return next;
    });
  };
  const setLayerVolume = (id, vol) => {
    setAmbientLayers(prev => ({ ...prev, [id]: vol }));
  };

  // Time of day for gradient
  const hour = new Date().getHours();
  const todGradient = hour >= 6 && hour < 12 ? `linear-gradient(180deg, #0f1a2a 0%, ${T.bg} 30%)`
    : hour >= 12 && hour < 17 ? `linear-gradient(180deg, #0d1520 0%, ${T.bg} 30%)`
    : hour >= 17 && hour < 21 ? `linear-gradient(180deg, #1a0d2e 0%, ${T.bg} 30%)`
    : `linear-gradient(180deg, #0a0a1a 0%, ${T.bg} 30%)`;

  // Update chat availability when active stream changes
  useEffect(() => {
    const activeVid = ytStreams[0]?.vid;
    if (!activeVid) return;
    const isLive = ytStats[activeVid]?.live || ytStreams[0]?.type === "live";
    setChatAvail(isLive);
  }, [ytStreams[0]?.vid]);

  const discoverSearch = async (query, pageToken) => {
    if (!query.trim()) return;
    setDiscLoading(true);
    if (!pageToken) { setDiscResults([]); setDiscSearched(true); setDiscLastQ(query); }
    try {
      let apiKey;
      try { apiKey = getYtApiKey(JSON.parse(localStorage.getItem('vorra-v1') || '{}')); } catch(_) { apiKey = ""; }
      if (!apiKey) { setDiscLoading(false); return; }
      const params = new URLSearchParams({
        part: 'snippet', q: query + ' music', type: 'video',
        videoCategoryId: '10', maxResults: '24', key: apiKey,
        videoEmbeddable: 'true', order: 'relevance',
        ...(discType === 'live' ? { eventType: 'live' } : { videoDuration: 'long' }),
        ...(pageToken ? { pageToken } : {}),
      });
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) { toast("YouTube API error. Check your key in Settings.", "warn"); setDiscLoading(false); return; }
      const data = await r.json();
      const ids = (data.items||[]).map(it => it.id?.videoId).filter(Boolean);
      if (ids.length === 0) { setDiscLoading(false); return; }

      // Fetch video details for duration, view count
      const detailParams = new URLSearchParams({
        part: 'snippet,contentDetails,statistics,status', id: ids.join(','), key: apiKey,
      });
      const dr = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`, { signal: AbortSignal.timeout(10000) });
      const dd = await dr.json();

      const results = (dd.items||[]).filter(it => it.status?.embeddable !== false).map(it => {
        const dur = it.contentDetails?.duration || '';
        const match = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        let durStr = '';
        if (match) {
          const h = parseInt(match[1]||0), m = parseInt(match[2]||0);
          durStr = h > 0 ? `${h}h${m>0?m+'m':''}` : `${m}m`;
        }
        const views = parseInt(it.statistics?.viewCount || 0);
        const viewStr = views > 1000000 ? (views/1000000).toFixed(1)+'M' : views > 1000 ? Math.round(views/1000)+'K' : views > 0 ? String(views) : '';
        const pub = it.snippet?.publishedAt ? new Date(it.snippet.publishedAt).getFullYear() : '';
        const durationSec = match ? (parseInt(match[1] || 0) * 3600 + parseInt(match[2] || 0) * 60 + parseInt(match[3] || 0)) : 0;
        return {
          vid: it.id, title: it.snippet?.title || 'Untitled',
          channel: it.snippet?.channelTitle || '',
          thumb: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || '',
          duration: durStr, views: viewStr ? viewStr + ' views' : '',
          published: pub ? String(pub) : '',
          isLive: it.snippet?.liveBroadcastContent === 'live',
          // Raw values for sorting
          viewCount: views,
          publishedAt: it.snippet?.publishedAt || '',
          durationSec,
        };
      });

      setDiscResults(prev => {
        if (!pageToken) return results;
        // Deduplicate by vid when loading more
        const existing = new Set(prev.map(r => r.vid));
        const newOnly = results.filter(r => !existing.has(r.vid));
        return [...prev, ...newOnly];
      });
      setDiscNextPage(data.nextPageToken || '');
    } catch(e) {
      toast("Search failed: " + e.message, "warn");
      dlog('error','discover','Search error: ' + e.message);
    }
    setDiscLoading(false);
  };
  const nowPlaying = audio.playing ? STATIONS.find(s => s.id === audio.playing) : null;
  const filtered = filterCat === "all" ? STATIONS : STATIONS.filter(s => s.cat === filterCat);
  const downCount = STATIONS.filter(s => health[s.id] && !health[s.id].ok).length;
  const hasActiveYT = ytStreams.length > 0;
  const [playerVisible, setPlayerVisible] = useState(false);
  useEffect(() => {
    if (hasActiveYT) setPlayerVisible(true);
    else { const t = setTimeout(() => setPlayerVisible(false), 350); return () => clearTimeout(t); }
  }, [hasActiveYT]);

  const toggleYtStream = (s) => {
    const isPlaying = ytStreams.some(st => st.vid === s.vid);
    if (isPlaying) {
      ytRemoveStream(s.vid);
    } else {
      ytAddStream({vid:s.vid, name:s.name, desc:s.desc, cat:s.cat});
      // Smooth scroll to player after a short delay for animation
      setTimeout(() => {
        mainPlayerRef.current?.scrollIntoView({behavior:"smooth",block:"nearest"});
      }, 150);
    }
  };

  // [FILTER] Merge built-in + custom streams into unified list
  const customAsStreams = customStreams.map((c, i) => ({
    id: `custom-${i}`, cat: "custom", name: c.name, desc: "User-added",
    vid: c.vid, pop: 3, type: "unknown", isCustom: true
  }));
  const ALL_YT = [...YT_STREAMS, ...customAsStreams];

  // [FILTER] Dynamic "Live Now" count — use API data when available, fall back to stream type metadata
  const liveNowCount = ALL_YT.filter(s => ytStats[s.vid]?.live || ytStats[s.vid]?.viewers > 0 || (s.type === "live" && Object.keys(ytStats).length === 0)).length;

  // [FILTER] Build filtered stream list based on category or special filters
  let ytBase = ytFilterCat === "all" ? ALL_YT :
    ytFilterCat === "live" ? ALL_YT.filter(s => ytStats[s.vid]?.live || ytStats[s.vid]?.viewers > 0 || (s.type === "live" && Object.keys(ytStats).length === 0)) :
    ytFilterCat === "custom" ? customAsStreams :
    YT_PARENT_CATS.some(p => p.key === ytFilterCat) ?
      ALL_YT.filter(s => s.cat.startsWith(ytFilterCat)) :
      ALL_YT.filter(s => s.cat === ytFilterCat);
  if (showFavs) ytBase = ytBase.filter(s => favs.yt.includes(s.vid));
  if (ytSearch.trim()) {
    const q = ytSearch.trim().toLowerCase();
    ytBase = ytBase.filter(s => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || (ytStats[s.vid]?.title||'').toLowerCase().includes(q));
  }
  // Dedup by video ID — prevent duplicate streams from showing
  const seenVids = new Set();
  const ytLiveUnsorted = ytBase.filter(s => {
    if (seenVids.has(s.vid)) return false;
    seenVids.add(s.vid);
    return !ytHealth[s.vid] || ytHealth[s.vid].ok;
  });
  const ytLive = [...ytLiveUnsorted].sort((a,b) => {
    if (ytSort === "viewers") return (ytStats[b.vid]?.viewers||0) - (ytStats[a.vid]?.viewers||0) || (b.pop||3)-(a.pop||3);
    if (ytSort === "views") return (ytStats[b.vid]?.views||0) - (ytStats[a.vid]?.views||0) || (b.pop||3)-(a.pop||3);
    if (ytSort === "popular") {
      // Use API concurrent viewers first, then views, then fallback pop rating
      const aScore = (ytStats[a.vid]?.viewers||0)*1000 + (ytStats[a.vid]?.views||0) + (a.pop||3)*1e6;
      const bScore = (ytStats[b.vid]?.viewers||0)*1000 + (ytStats[b.vid]?.views||0) + (b.pop||3)*1e6;
      return bScore - aScore || a.name.localeCompare(b.name);
    }
    if (ytSort === "name") return a.name.localeCompare(b.name);
    if (ytSort === "category") return (a.cat||"").localeCompare(b.cat||"") || a.name.localeCompare(b.name);
    if (ytSort === "duration") {
      const aLive = (ytStats[a.vid]?.live || a.type === "live") ? 1 : 0;
      const bLive = (ytStats[b.vid]?.live || b.type === "live") ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      const aDur = ytStats[a.vid]?.durationSec || 0;
      const bDur = ytStats[b.vid]?.durationSec || 0;
      return bDur - aDur || a.name.localeCompare(b.name);
    }
    return 0;
  });
  const ytDead = ytBase.filter(s => ytHealth[s.vid] && !ytHealth[s.vid].ok);
  const ytDeadCount = YT_STREAMS.filter(s => ytHealth[s.vid] && !ytHealth[s.vid].ok).length;

  // Track main player visibility for sticky mini player
  const mainPlayerRef = useRef(null);
  const [mainPlayerVisible, setMainPlayerVisible] = useState(true);
  useEffect(() => {
    if (!mainPlayerRef.current) return;
    const obs = new IntersectionObserver(([entry]) => setMainPlayerVisible(entry.isIntersecting), { threshold: 0.15 });
    obs.observe(mainPlayerRef.current);
    return () => obs.disconnect();
  }, [ytStreams.length]);

  return (
    <div className="fade" style={{ background: todGradient, minHeight: '100%', margin: '-16px -20px', padding: '16px 20px' }}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <Ic.IcMusic s={22} c={T.accent}/>
          <h1 style={{fontSize:fs(22),fontWeight:800,background:`linear-gradient(135deg,${T.accent},${T.blue},${T.purple})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Study Radio</h1>
        </div>
        {/* Sleep timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sleepTimerActive && <Badge color={T.purple} bg={T.purpleD}>{sleepTimer}m left</Badge>}
          <select value={sleepTimerActive ? sleepTimer : 0} onChange={e => {
            const mins = Number(e.target.value);
            if (mins > 0) { setSleepTimer(mins); setSleepTimerActive(true); toast(`Sleep timer: ${mins} minutes`, 'info'); }
            else { setSleepTimerActive(false); setSleepTimer(0); }
          }} style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text, fontSize: fs(10) }}>
            <option value={0}>Sleep timer: Off</option>
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hours</option>
            <option value={120}>2 hours</option>
            <option value={180}>3 hours</option>
          </select>
        </div>
      </div>

      {/* ═══ QUICK FOCUS ═══ */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '14px 18px', marginBottom: 12 }}>
        <div style={{ fontSize: fs(13), fontWeight: 700, color: T.text, marginBottom: 10 }}>Quick Focus</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          {[...FOCUS_PRESETS, ...customPresets].map(p => (
            <div key={p.id} style={{ position: 'relative' }}
              onContextMenu={p.custom ? (e) => {
                e.preventDefault();
                if (confirm(`Delete preset "${p.name}"?`)) {
                  saveCustomPresets(customPresets.filter(cp => cp.id !== p.id));
                  toast('Preset deleted', 'info');
                }
              } : undefined}>
              <button onClick={() => applyPreset(p)}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.boxShadow = `0 4px 12px ${T.accent}22`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = 'none'; }}
                style={{ width: '100%', padding: '16px 10px 12px', borderRadius: 10, border: `1.5px solid ${T.border}`, background: T.input, cursor: 'pointer', textAlign: 'center', transition: 'all .15s' }}>
                <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center' }}>{renderPresetIcon(p.icon || p.emoji, 28)}</div>
                <div style={{ fontSize: fs(11), fontWeight: 600, color: T.text, lineHeight: 1.2 }}>{p.name}</div>
                {p.streams && <div style={{ fontSize: fs(8), color: T.dim, marginTop: 3 }}>{p.streams.length} stream{p.streams.length !== 1 ? 's' : ''}</div>}
              </button>
              {p.custom && (
                <button onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete preset "${p.name}"?`)) {
                    saveCustomPresets(customPresets.filter(cp => cp.id !== p.id));
                    toast('Preset deleted', 'info');
                  }
                }}
                  style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', border: `1px solid ${T.red}44`, background: T.card, color: T.red, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, opacity: 0 }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '0'}
                  title="Delete preset (right-click also works)">×</button>
              )}
            </div>
          ))}
          {/* + Save Current card */}
          <button onClick={() => {
            if (ytStreams.length === 0 && !audio.playing) { toast('Play some streams first, then save as a preset', 'info'); return; }
            setShowSavePreset(true); setSavePresetName(''); setSavePresetEmoji('🎵');
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.color = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.dim; }}
            style={{ width: '100%', padding: '14px 10px', borderRadius: 10, border: `2px dashed ${T.border}`, background: 'transparent', cursor: 'pointer', textAlign: 'center', transition: 'all .15s', color: T.dim }}>
            <div style={{ fontSize: 22, marginBottom: 6, lineHeight: 1 }}>+</div>
            <div style={{ fontSize: fs(10), fontWeight: 600, lineHeight: 1.2 }}>Save Current</div>
          </button>
        </div>
        {/* Inline save preset form */}
        {showSavePreset && (
          <div style={{ marginTop: 10, padding: '14px 16px', background: T.panel, border: `1.5px solid ${T.accent}44`, borderRadius: 12 }}>
            <div style={{ fontSize: fs(11), fontWeight: 600, color: T.text, marginBottom: 8 }}>Choose an icon:</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
              {PRESET_ICON_LIST.map(ic => (
                <button key={ic.id} onClick={() => setSavePresetEmoji(ic.id)} title={ic.label} style={{
                  width: 36, height: 36, borderRadius: 8, border: `1.5px solid ${savePresetEmoji === ic.id ? T.accent : 'transparent'}`,
                  background: savePresetEmoji === ic.id ? T.accentD : T.input, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .1s',
                }}>{renderPresetIcon(ic.id, 20, savePresetEmoji === ic.id ? T.accent : T.soft)}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: T.accentD, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {renderPresetIcon(savePresetEmoji, 24, T.accent)}
              </div>
              <input value={savePresetName} onChange={e => setSavePresetName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && savePresetName.trim()) { document.getElementById('vorra-save-preset-btn')?.click(); } }}
                placeholder="Preset name..." autoFocus
                style={{ flex: 1, padding: '8px 12px', fontSize: fs(12), borderRadius: 8, border: `1px solid ${T.border}`, background: T.input, color: T.text }} />
              <Btn small onClick={() => {
                if (!savePresetName.trim()) { toast('Enter a name', 'info'); return; }
                const newPreset = {
                  id: `custom_${Date.now()}`, name: savePresetName.trim(), icon: savePresetEmoji, custom: true,
                  streams: ytStreams.map(s => ({ vid: s.vid, name: s.name, cat: s.cat || '', type: s.type || 'video' })),
                  volumes: Object.fromEntries(ytStreams.map((s, i) => [i, s.volume ?? 100])),
                  soma: audio.playing ? audio.stationId : null,
                };
                saveCustomPresets([...customPresets, newPreset]);
                setShowSavePreset(false);
                toast(`Preset "${savePresetName.trim()}" saved!`, 'success');
              }} id="vorra-save-preset-btn">Save</Btn>
              <Btn small v="ghost" onClick={() => setShowSavePreset(false)}>Cancel</Btn>
            </div>
          </div>
        )}
      </div>

      {/* Ambient mixer removed — presets use multi-stream stacking instead */}

      {/* Health check progress */}
      {checkProgress.active && (
        <div style={{marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
            <Ic.Spin s={12}/><span style={{fontSize:fs(10),color:T.soft}}>{checkProgress.phase} ({checkProgress.done}/{checkProgress.total})</span>
          </div>
          <div style={{height:3,background:T.input,borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",background:`linear-gradient(90deg,${T.accent},${T.blue})`,borderRadius:2,width:`${checkProgress.total?Math.round(checkProgress.done/checkProgress.total*100):0}%`,transition:"width .3s ease"}}/>
          </div>
        </div>
      )}

      {/* ═══ SOURCE TABS ═══ */}
      <div style={{ display: 'flex', background: T.panel, borderRadius: 12, padding: 3, marginBottom: 12, border: `1px solid ${T.border}` }}>
        {[
          { key: 'youtube', label: 'YouTube', count: ALL_YT.length, icon: Ic.YT, color: '#ff4444' },
          { key: 'discover', label: 'Discover', icon: Ic.IcSearch, color: T.purple },
          { key: 'somafm', label: 'SomaFM', count: STATIONS.length, icon: Ic.Radio, color: T.accent },
        ].map(tab => {
          const active = mainTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setMainTab(tab.key)} style={{
              flex: 1, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: active ? `${tab.color}18` : 'transparent',
              color: active ? tab.color : T.soft,
              fontSize: fs(13), fontWeight: active ? 700 : 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all .15s',
              boxShadow: active ? `inset 0 0 0 1.5px ${tab.color}44` : 'none',
            }}>
              <tab.icon s={16} c={active ? tab.color : T.dim} />
              {tab.label}
              {tab.count && <span style={{ fontSize: fs(10), opacity: 0.7 }}>({tab.count})</span>}
            </button>
          );
        })}
      </div>
      {/*  YouTube Tab  */}
      {/* YouTube Tab — stays mounted to preserve audio */}
      <div style={{display:mainTab==="youtube"?"block":"none"}}>
        {/* Active stream players (up to 4) */}
        {playerVisible && (
          <div ref={mainPlayerRef} className={hasActiveYT?"expand-down":""} style={{marginBottom:16,opacity:hasActiveYT?1:0,transition:"opacity .3s ease"}}>
            <div className="fade" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:fs(13),fontWeight:700,color:T.accent}}>▶ {ytStreams.length} stream{ytStreams.length>1?"s":""} playing {ytStreams.length<4&&<span style={{fontSize:fs(10),color:T.dim,fontWeight:400}}>· click more to stack (max 4)</span>}</span>
              <Btn small v="danger" onClick={ytClearAll}>✕ Close All</Btn>
            </div>
            <div style={{display:"grid",gridTemplateColumns:ytStreams.length===1?(chatPanel&&chatAvail?"1fr 320px":"1fr"):ytStreams.length===2?"1fr 1fr":"repeat(2,1fr)",gap:8,transition:"all .3s ease",position:"relative"}}>
              {ytStreams.map((s,i) => {
                const st = ytStats[s.vid];
                const detType = st?.detectedType || s.type || 'unknown';
                return (
                <div key={s.vid} className={s.closing?"fade-out":"slide-up"} style={{background:"#000",borderRadius:10,overflow:"hidden",border:`1px solid ${T.accent}44`,position:"relative",animationDelay:s.closing?'0ms':`${i*100}ms`}}>
                  <iframe data-yt-slot={i} src={`http://127.0.0.1:19532/yt-proxy?v=${s.vid}`}
                    style={{width:"100%",height:ytStreams.length<=2?380:220,border:"none",display:"block",transition:"height .3s ease"}}
                    allow="autoplay;encrypted-media;picture-in-picture;fullscreen" allowFullScreen/>
                  <div style={{padding:"6px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",background:T.card,gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flex:1,overflow:"hidden",minWidth:0}}>
                      <span style={{fontSize:fs(8),fontWeight:700,padding:"1px 5px",borderRadius:3,background:detType==='live'?'#e00':'#555',color:'#fff',flexShrink:0}}>{detType==='live'?'LIVE':'VIDEO'}</span>
                      <span style={{fontSize:fs(11),fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                    </div>
                    {/* Per-stream volume slider */}
                    <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0,minWidth:100}}>
                      <span style={{fontSize:fs(9),color:T.dim}}>🔊</span>
                      <input type="range" min={0} max={100} value={s.volume ?? 100}
                        onChange={e => ytSetVolume(Number(e.target.value), s.vid)}
                        style={{width:70,accentColor:T.accent,height:4,cursor:"pointer"}}/>
                      <span style={{fontSize:fs(9),color:T.dim,minWidth:24,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{s.volume ?? 100}</span>
                    </div>
                    {st && <div style={{display:"flex",gap:6,fontSize:fs(9),color:T.dim,flexShrink:0}}>
                      {st.viewers>0&&<span>👁 {fmtNum(st.viewers)}</span>}
                      {st.views>0&&<span>▶ {fmtNum(st.views)}</span>}
                    </div>}
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <button onClick={()=>ytPauseToggle(s.vid)} style={{background:"none",border:"none",color:s.paused?T.accent:T.soft,cursor:"pointer",padding:"4px"}}>{s.paused?<Ic.IcPlay s={18} c={T.accent}/>:<Ic.IcPause s={18} c={T.soft}/>}</button>
                      <button onClick={()=>ytRemoveStream(s.vid)} style={{background:"none",border:"none",color:T.red,cursor:"pointer",padding:"4px"}}><Ic.IcX s={18} c={T.red}/></button>
                    </div>
                  </div>
                </div>
                );
              })}
              {/* Live Chat Panel — inline for single live stream */}
              {ytStreams.length === 1 && chatPanel && chatAvail && (
                <div style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,overflow:"hidden",display:"flex",flexDirection:"column",height:440}}>
                  <div style={{display:"flex",alignItems:"center",padding:"6px 8px",borderBottom:`1px solid ${T.border}`,flexShrink:0,gap:4,background:T.bg2}}>
                    <span style={{padding:"3px 10px",fontSize:fs(10),fontWeight:700,color:T.accent}}>Live Chat</span>
                    <div style={{flex:1}}/>
                    <button onClick={()=>setChatPanel(false)} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:T.dim}} title="Collapse"><Ic.IcX s={12}/></button>
                  </div>
                  <iframe src={`http://127.0.0.1:19532/yt-chat?v=${ytStreams[0].vid}`} style={{flex:1,border:"none",background:T.bg2}}/>
                </div>
              )}
              {/* Collapsed panel toggle */}
              {ytStreams.length >= 1 && !chatPanel && chatAvail && (
                <div style={{position:"absolute",top:8,right:8,zIndex:5}}>
                  <button onClick={()=>setChatPanel(true)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:fs(10),fontWeight:600,color:T.accent,boxShadow:"0 2px 8px rgba(0,0,0,.3)"}}>
                    <Ic.Chat s={12} c={T.accent}/> Chat
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sticky hover bar — anchored to top when scrolled past player */}
        {hasActiveYT && !mainPlayerVisible && (
          <div className="fade" style={{position:"sticky",top:-28,zIndex:15,background:`${T.panel}f5`,backdropFilter:"blur(14px)",borderBottom:`2px solid ${T.accent}44`,padding:"10px 32px",margin:"-28px -32px 12px -32px",display:"flex",gap:12,alignItems:"center",boxShadow:"0 4px 24px rgba(0,0,0,.4)"}}>
            {/* Stream thumbnails */}
            <div style={{display:"flex",gap:4,flexShrink:0}}>
              {ytStreams.slice(0,4).map(s => (
                <img key={s.vid} src={`https://img.youtube.com/vi/${s.vid}/default.jpg`} style={{width:56,height:42,borderRadius:6,objectFit:"cover",border:`1.5px solid ${T.accent}44`}} alt={s.name}/>
              ))}
            </div>
            <div style={{flex:1,overflow:"hidden"}}>
              <div style={{fontSize:fs(14),fontWeight:700,color:T.accent,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                <Ic.IcPlay s={12} c={T.accent}/> {ytStreams.map(s=>s.name).join(" + ")}
              </div>
              <div style={{fontSize:fs(10),color:T.dim,marginTop:2}}>{ytStreams.length} stream{ytStreams.length>1?"s":""} active</div>
            </div>
            <button onClick={()=>mainPlayerRef.current?.scrollIntoView({behavior:"smooth"})} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:fs(13),color:T.soft,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
              <Ic.ChevL s={12}/> Back
            </button>
            <button onClick={ytClearAll} style={{background:T.redD,border:`1px solid ${T.red}33`,borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:fs(13),color:T.red,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
              <Ic.IcX s={12} c={T.red}/> Close All
            </button>
          </div>
        )}

        {/* ═══ FILTER BAR ═══ */}
        <div style={{marginBottom:12}}>
          {/* Row 1: Categories */}
          <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
            {[
              { key: 'all', label: `All (${ALL_YT.length})`, color: T.accent },
              { key: 'live', label: `Live${liveNowCount > 0 ? ` (${liveNowCount})` : ''}`, color: '#e00', icon: Ic.IcLive },
              { key: 'custom', label: `My${customStreams.length > 0 ? ` (${customStreams.length})` : ''}`, color: T.blue, icon: Ic.IcUser },
            ].map(f => {
              const active = ytFilterCat === f.key;
              return (
                <button key={f.key} onClick={() => setYtFilterCat(f.key)} style={{
                  padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: fs(11), fontWeight: 600,
                  border: `1.5px solid ${active ? f.color : T.border}`,
                  background: active ? `${f.color}18` : T.card,
                  color: active ? f.color : T.soft,
                  display: 'flex', alignItems: 'center', gap: 5, transition: 'all .12s',
                }}>{f.icon && <f.icon s={12} c={active ? f.color : T.dim} />}{f.label}</button>
              );
            })}
            <div style={{ width: 1, height: 20, background: T.border, margin: '0 2px' }} />
            {YT_PARENT_CATS.map(p => {
              const count = YT_STREAMS.filter(s => s.cat.startsWith(p.key)).length;
              const active = ytFilterCat === p.key || ytFilterCat.startsWith(p.key + "-");
              const YtIcons = { lofi: Ic.YtLofi, jazz: Ic.YtJazz, classical: Ic.YtClassical, ambient: Ic.YtAmbient, synth: Ic.YtSynth, focus: Ic.YtFocus, chill: Ic.YtChill, asmr: Ic.IcMusic, sleep: Ic.CatAmbient, world: Ic.CatWorld };
              const CatIcon = YtIcons[p.key];
              return (
                <button key={p.key} onClick={() => setYtFilterCat(p.key)} style={{
                  padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: fs(11), fontWeight: active ? 700 : 500,
                  border: `1.5px solid ${active ? T.accent : 'transparent'}`,
                  background: active ? T.accentD : 'transparent',
                  color: active ? T.accent : T.soft,
                  display: 'flex', alignItems: 'center', gap: 4, transition: 'all .12s',
                }}>{CatIcon && <CatIcon s={13} />}{p.label} <span style={{ fontSize: fs(9), opacity: 0.6 }}>({count})</span></button>
              );
            })}
          </div>
          {/* Row 2: Sort + Search + Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', background: T.panel, borderRadius: 8, padding: 2, border: `1px solid ${T.border}` }}>
              {[
                { k: "popular", icon: Ic.IcCrown, label: "Popular" },
                { k: "viewers", icon: Ic.IcEye, label: "Viewers" },
                { k: "views", icon: Ic.IcChart, label: "Views" },
                { k: "name", icon: Ic.IcAZ, label: "A-Z" },
                { k: "category", icon: Ic.IcGrid, label: "Cat" },
                { k: "duration", icon: Ic.Clock, label: "Length" },
              ].map(o => (
                <button key={o.k} onClick={() => setYtSort(o.k)} title={o.label} style={{
                  padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: ytSort === o.k ? T.accentD : 'transparent',
                  color: ytSort === o.k ? T.accent : T.dim,
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: fs(10), fontWeight: ytSort === o.k ? 700 : 500, transition: 'all .12s',
                }}><o.icon s={12} c={ytSort === o.k ? T.accent : T.dim} />{o.label}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowFavs(!showFavs)} style={{
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: fs(11), fontWeight: 600,
              border: `1.5px solid ${showFavs ? '#f59e0b' : T.border}`,
              background: showFavs ? '#f59e0b18' : T.card, color: showFavs ? '#f59e0b' : T.dim,
              transition: 'all .12s',
            }}>{showFavs ? "★ Favorites" : "☆ Favorites"}</button>
            <button onClick={() => setShowCustomInput(p => !p)} style={{
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: fs(11), fontWeight: 600,
              border: `1.5px solid ${showCustomInput ? T.blue : T.border}`,
              background: showCustomInput ? `${T.blue}18` : T.card, color: showCustomInput ? T.blue : T.dim,
              display: 'flex', alignItems: 'center', gap: 4, transition: 'all .12s',
            }}><Ic.IcPlus s={11} c={showCustomInput ? T.blue : T.dim} /> Add URL</button>
            <div style={{ position: 'relative' }}>
              <input value={ytSearch} onChange={e => setYtSearch(e.target.value)} placeholder="Search streams..."
                style={{ width: 180, padding: '7px 12px 7px 32px', fontSize: fs(11), borderRadius: 8, border: `1px solid ${T.border}`, background: T.input, color: T.text }} />
              <Ic.IcSearch s={12} c={T.dim} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              {ytSearch && <button onClick={() => setYtSearch("")} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: T.dim, cursor: 'pointer' }}><Ic.X s={10} /></button>}
            </div>
          </div>
          {/* Subcategories — show when a parent is selected */}
          {ytFilterCat !== "all" && (() => {
            const parentKey = YT_PARENT_CATS.find(p => ytFilterCat === p.key || ytFilterCat.startsWith(p.key))?.key;
            if (!parentKey) return null;
            const subs = YT_CATS.filter(c => c.parent === parentKey);
            return subs.length > 1 ? (
              <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                <button onClick={()=>setYtFilterCat(parentKey)} style={{padding:"3px 8px",borderRadius:5,cursor:"pointer",fontSize:fs(10),fontWeight:500,border:`1px solid ${ytFilterCat===parentKey?T.accent:T.border}`,background:ytFilterCat===parentKey?T.accentD:"transparent",color:ytFilterCat===parentKey?T.accent:T.dim}}>All {YT_PARENT_CATS.find(p=>p.key===parentKey)?.label}</button>
                {subs.map(sub => {
                  const count = YT_STREAMS.filter(s => s.cat === sub.key).length;
                  return <button key={sub.key} onClick={()=>setYtFilterCat(sub.key)} style={{padding:"3px 8px",borderRadius:5,cursor:"pointer",fontSize:fs(10),fontWeight:500,border:`1px solid ${ytFilterCat===sub.key?T.accent:T.border}`,background:ytFilterCat===sub.key?T.accentD:"transparent",color:ytFilterCat===sub.key?T.accent:T.dim}}>{sub.label} ({count})</button>;
                })}
              </div>
            ) : null;
          })()}
        </div>

        {/* Inline custom URL input */}
        {showCustomInput && (
          <div className="fade" style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
            <input value={customUrl} onChange={e=>setCustomUrl(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")document.getElementById("add-custom-btn")?.click()}} placeholder="Paste YouTube URL (watch, youtu.be, embed)" style={{flex:1,fontSize:fs(11),padding:"7px 12px"}}/>
            <Btn small v="ai" id="add-custom-btn" onClick={()=>{
              if (!customUrl.trim()) return;
              const m = customUrl.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
              if (m) { const vid = m[1]; addCustomStream(vid, `Custom ${vid.slice(0,6)}`); ytAddStream({vid, name:`Custom ${vid.slice(0,6)}`, desc:"User-added", cat:"custom"}); toast(`Added: ${vid}`, "info"); setCustomUrl(""); }
              else toast("Could not parse YouTube URL", "warn");
            }}><Ic.IcPlus s={12} c="#fff"/> Add</Btn>
          </div>
        )}

        {/* Stream grid — paginated for performance */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:8}}>
          {ytLive.slice(0, ytShowCount).map(s => {
            const isActive = ytStreams.some(st => st.vid === s.vid);
            const st = ytStats[s.vid];
            const isFav = favs.yt.includes(s.vid);
            return (
              <div key={s.id} className="sf-yt-card" style={{
                background:isActive?T.accentD:T.card,
                border:`1.5px solid ${isActive?T.accent:T.border}`,
                borderRadius:10, overflow:"hidden", position:"relative",
              }}>
                <button onClick={()=>toggleYtStream(s)} style={{width:"100%",textAlign:"left",padding:0,border:"none",cursor:"pointer",background:"transparent"}}>
                  <div style={{position:"relative",width:"100%",aspectRatio:"16/9",background:T.bg2,overflow:"hidden"}}>
                    <img src={`https://img.youtube.com/vi/${s.vid}/mqdefault.jpg`} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} loading="lazy"/>
                    {isActive && <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:T.accent,fontSize:fs(12),fontWeight:700}}>● PLAYING</span></div>}
                    {/* [UI] Type badge — LIVE if viewers exist, STREAM if type=live, else VIDEO */}
                    {(() => {
                      const detType = ytStats[s.vid]?.detectedType || s.type;
                      const isLiveNow = ytStats[s.vid]?.live || st?.live || (st?.viewers > 0);
                      if (isLiveNow) return <div style={{position:"absolute",top:4,left:4,background:"#e00",borderRadius:4,padding:"2px 7px",fontSize:fs(9),color:"#fff",fontWeight:700,display:"flex",alignItems:"center",gap:3}}><Ic.IcLive s={10}/> LIVE</div>;
                      if (detType === "live") return <div style={{position:"absolute",top:4,left:4,background:"#e0002a",borderRadius:4,padding:"2px 7px",fontSize:fs(8),color:"#fff",fontWeight:700,letterSpacing:.5}}>STREAM</div>;
                      if (detType === "video") return <div style={{position:"absolute",top:4,left:4,background:"rgba(0,0,0,0.75)",borderRadius:4,padding:"2px 7px",fontSize:fs(8),color:"#ccc",fontWeight:600}}>VIDEO</div>;
                      return null;
                    })()}
                    {st?.viewers > 0 && <div style={{position:"absolute",bottom:4,left:4,background:"rgba(0,0,0,0.8)",borderRadius:4,padding:"1px 6px",fontSize:fs(9),color:"#fff"}}>👁 {fmtNum(st.viewers)}</div>}
                    {st?.views > 0 && <div style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,0.8)",borderRadius:4,padding:"1px 6px",fontSize:fs(9),color:"#fff"}}>▶ {fmtNum(st.views)}</div>}
                    {!st && s.pop && <div style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,0.75)",borderRadius:4,padding:"1px 6px",fontSize:fs(9),color:"#fff"}}>{"★".repeat(s.pop)}</div>}
                  </div>
                  <div style={{padding:"6px 8px"}}>
                    <div style={{fontSize:fs(11),fontWeight:600,color:isActive?T.accent:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                    <div style={{fontSize:fs(9),color:T.dim,marginTop:1,display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st?.channelTitle || s.desc}</span>
                      {st?.durationSec > 0 && <span style={{flexShrink:0,color:T.soft}}>{Math.floor(st.durationSec/3600)}h{Math.floor((st.durationSec%3600)/60)}m</span>}
                    </div>
                  </div>
                </button>
                <button onClick={(e)=>{e.stopPropagation();toggleFav('yt',s.vid)}} style={{position:"absolute",top:4,right:s.isCustom?28:4,background:"rgba(0,0,0,0.6)",border:"none",borderRadius:4,padding:"2px 5px",cursor:"pointer",fontSize:fs(12),color:isFav?T.yellow:"#fff8",zIndex:2}}>{isFav?"★":"☆"}</button>
                {s.isCustom && <button onClick={(e)=>{e.stopPropagation();removeCustomStream(s.vid);toast(`Removed: ${s.name}`,"info")}} style={{position:"absolute",top:4,right:4,background:"rgba(200,0,0,0.7)",border:"none",borderRadius:4,padding:"2px 5px",cursor:"pointer",zIndex:2}} title="Remove"><Ic.IcX s={10} c="#fff"/></button>}
              </div>
            );
          })}
        </div>
        {ytLive.length > ytShowCount && (
          <div style={{textAlign:"center",marginTop:12}}>
            <button onClick={()=>setYtShowCount(c=>c+60)} style={{padding:"8px 24px",borderRadius:8,border:`1px solid ${T.border}`,background:T.card,cursor:"pointer",fontSize:fs(12),fontWeight:600,color:T.accent}}>
              Show More ({ytLive.length - ytShowCount} remaining)
            </button>
          </div>
        )}
        {ytLive.length > 0 && ytLive.length <= ytShowCount && ytShowCount > 60 && (
          <div style={{textAlign:"center",marginTop:8,fontSize:fs(10),color:T.dim}}>Showing all {ytLive.length} streams</div>
        )}

        {/* My Streams management */}
        {customStreams.length > 0 && (
          <div style={{marginTop:12,padding:"10px 14px",background:T.card,border:`1px solid ${T.border}`,borderRadius:10}}>
            <div style={{fontSize:fs(10),fontWeight:600,color:T.soft,marginBottom:6,display:"flex",alignItems:"center",gap:4}}><Ic.IcUser s={12} c={T.soft}/> My Streams ({customStreams.length})</div>
            {customStreams.map(c => (
              <div key={c.vid} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:`1px solid ${T.border}22`}}>
                <img src={`https://img.youtube.com/vi/${c.vid}/default.jpg`} style={{width:40,height:30,borderRadius:4,objectFit:"cover"}} alt=""/>
                <div style={{flex:1,overflow:"hidden"}}>
                  <div style={{fontSize:fs(11),fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ytStats[c.vid]?.title || c.name}</div>
                  <div style={{fontSize:fs(9),color:T.dim}}>{c.vid}{ytStats[c.vid]?.detectedType ? ` ${ytStats[c.vid].detectedType}` : ""}</div>
                </div>
                <button onClick={()=>{toggleYtStream({vid:c.vid,name:c.name,desc:"Custom",cat:"custom"})}} style={{background:T.accentD,border:`1px solid ${T.accent}44`,borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:fs(9),color:T.accent,fontWeight:600}}>
                  {ytStreams.some(s=>s.vid===c.vid)?"Stop":"Play"}
                </button>
                <button onClick={()=>{removeCustomStream(c.vid);toast(`Removed: ${c.name}`,"info")}} style={{background:T.redD,border:`1px solid ${T.red}33`,borderRadius:4,padding:"2px 6px",cursor:"pointer"}} title="Remove">
                  <Ic.IcTrash s={11} c={T.red}/>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Unavailable — collapsible */}
        {ytDead.length > 0 && (
          <div style={{marginTop:16}}>
            <button onClick={()=>setShowDead(!showDead)} style={{fontSize:fs(11),color:T.dim,fontWeight:600,display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",padding:"4px 0",marginBottom:showDead?6:0}}>
              <span style={{transition:"transform .2s",transform:showDead?"rotate(90deg)":"rotate(0)",display:"inline-block"}}>▶</span>
              <span style={{color:T.red}}>⊘</span> Unavailable ({ytDead.length})
            </button>
            {showDead && (
              <div className="fade" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:6}}>
                {ytDead.map(s => (
                  <div key={s.id} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden",opacity:0.3,filter:"grayscale(1)"}} title={ytHealth[s.vid]?.reason}>
                    <img src={`https://img.youtube.com/vi/${s.vid}/mqdefault.jpg`} style={{width:"100%",aspectRatio:"16/9",objectFit:"cover"}} loading="lazy"/>
                    <div style={{padding:"4px 8px",fontSize:fs(9),color:T.dim}}>{s.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/*  SomaFM Tab — stays mounted to preserve audio  */}
      <div style={{display:mainTab==="somafm"?"block":"none"}}>
        {/* Now Playing */}
        {nowPlaying && (
          <div className="fade" style={{background:T.accentD,border:`1.5px solid ${T.accent}44`,borderRadius:12,padding:16,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span>{(() => {
                const catIcons = {lofi:Ic.CatLofi,ambient:Ic.CatAmbient,jazz:Ic.CatJazz,world:Ic.CatWorld,classical:Ic.CatClassical,energy:Ic.CatEnergy,holiday:Ic.CatHoliday};
                const CI = catIcons[nowPlaying.cat] || Ic.IcMusic;
                return <CI s={32}/>;
              })()}</span>
              <div>
                <div style={{fontSize:fs(15),fontWeight:700,color:T.accent}}>Now Playing: {nowPlaying.name}</div>
                <div style={{fontSize:fs(12),color:T.soft}}>{nowPlaying.desc}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6,minWidth:220}}>
                <span style={{cursor:"pointer",flexShrink:0}} onClick={()=>audioSetVolume(Math.max(0,audio.volume-0.05))}><Ic.IcVolLow s={14} c={T.accent}/></span>
                <div style={{flex:1,minWidth:120}}><VolumeBar value={audio.volume} onChange={audioSetVolume}/></div>
                <span style={{cursor:"pointer",flexShrink:0}} onClick={()=>audioSetVolume(Math.min(1,audio.volume+0.05))}><Ic.IcVolHi s={14} c={T.accent}/></span>
                <span style={{fontSize:fs(11),color:T.dim,minWidth:30,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{Math.round(audio.volume*100)}%</span>
              </div>
              <Btn small v="danger" onClick={audioStop}><Ic.IcStop s={12} c={T.red}/> Stop</Btn>
            </div>
          </div>
        )}

        {/* Category filter + favorites */}
        <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          <button className="sf-chip" onClick={()=>setFilterCat("all")} style={{padding:"5px 12px",borderRadius:7,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${filterCat==="all"?T.accent:T.border}`,background:filterCat==="all"?T.accentD:T.input,color:filterCat==="all"?T.accent:T.soft}}>All ({STATIONS.length})</button>
          {STATION_CATS.map(cat => {
            const count = STATIONS.filter(s => s.cat === cat.key).length;
            return <button key={cat.key} className="sf-chip" onClick={()=>setFilterCat(cat.key)} style={{padding:"5px 12px",borderRadius:7,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${filterCat===cat.key?T.accent:T.border}`,background:filterCat===cat.key?T.accentD:T.input,color:filterCat===cat.key?T.accent:T.soft,display:"flex",alignItems:"center",gap:5}}>{(() => { const CI = Ic[cat.iconKey]; return CI ? <CI s={14}/> : null; })()} {cat.label} ({count})</button>;
          })}
          <div style={{flex:1}}/>
          <button onClick={()=>setFilterCat(filterCat==="favs"?"all":"favs")} style={{padding:"5px 10px",borderRadius:7,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${filterCat==="favs"?T.yellow:T.border}`,background:filterCat==="favs"?`${T.yellow}22`:T.input,color:filterCat==="favs"?T.yellow:T.dim}}>{filterCat==="favs"?"★ Favorites":"☆ Favs"}</button>
        </div>

        {/* Station grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
          {(filterCat==="favs" ? STATIONS.filter(s=>favs.soma.includes(s.id)) : filtered).map(s => {
            const isPlaying = audio.playing === s.id;
            const h = health[s.id];
            const isDown = h && !h.ok;
            const isFav = favs.soma.includes(s.id);
            return (
              <div key={s.id} className={`sf-station ${isPlaying?"sf-station-playing":""}`} style={{
                background:isDown?T.input:isPlaying?T.accentD:T.card,
                border:`1.5px solid ${isDown?T.border:isPlaying?T.accent:T.border}`,
                borderRadius:12, padding:"14px 16px",
                textAlign:"left", display:"flex", alignItems:"center", gap:12,
                opacity:isDown?0.4:1, filter:isDown?"grayscale(1)":"none", position:"relative",
              }}>
                <button onClick={()=>{ if(isDown){toast(`${s.name} is currently offline`,"warn");return;} audioToggle(s.id); if(!isPlaying) toast(`Now playing: ${s.name}`,"info"); }}
                  title={isDown ? `Offline` : s.desc}
                  style={{display:"flex",alignItems:"center",gap:12,background:"none",border:"none",cursor:isDown?"not-allowed":"pointer",flex:1,textAlign:"left",padding:0}}>
                  <span style={{flexShrink:0}}>{(() => {
                    const catIcons = {lofi:Ic.CatLofi,ambient:Ic.CatAmbient,jazz:Ic.CatJazz,world:Ic.CatWorld,classical:Ic.CatClassical,energy:Ic.CatEnergy,holiday:Ic.CatHoliday};
                    const CI = catIcons[s.cat] || Ic.IcMusic;
                    return <CI s={28}/>;
                  })()}</span>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:fs(13),fontWeight:600,color:isDown?T.dim:isPlaying?T.accent:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                    <div style={{fontSize:fs(11),color:isDown?T.red:isPlaying?T.accent:T.dim}}>{isDown?"⊘ Offline":isPlaying?"● Playing":s.desc}</div>
                  </div>
                </button>
                <button onClick={()=>toggleFav('soma',s.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:fs(16),color:isFav?T.yellow:T.dim,flexShrink:0}}>{isFav?"★":"☆"}</button>
              </div>
            );
          })}
        </div>
        {downCount > 0 && <div style={{marginTop:10,fontSize:fs(10),color:T.dim,textAlign:"center"}}>
          {downCount} station{downCount>1?"s":""} currently offline — checked every 5 minutes
        </div>}

        <div style={{marginTop:20,fontSize:fs(11),color:T.dim,textAlign:"center"}}>
          Streams provided by <span style={{color:T.soft}}>SomaFM.com</span> — Listener-supported, commercial-free internet radio
        </div>
      </div>

      {/* Discover Tab */}
      {mainTab === "discover" && (
        <div className="fade">
          <div style={{marginBottom:16}}>
            <h2 style={{fontSize:fs(18),fontWeight:700,color:T.purple,marginBottom:4,display:"flex",alignItems:"center",gap:8}}><Ic.IcGlobe s={20} c={T.purple}/> Discover New Music</h2>
            <p style={{fontSize:fs(11),color:T.dim,margin:0}}>Search YouTube for new streams, mixes, and ambient videos to add to your library.</p>
          </div>

          {/* Quick discover presets */}
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
            {[
              {q:"lofi hip hop radio live",l:"Lofi Radio"},
              {q:"jazz cafe ambience study",l:"Jazz Cafe"},
              {q:"ambient rain sounds sleep",l:"Rain Sounds"},
              {q:"classical piano relaxing",l:"Classical Piano"},
              {q:"synthwave retrowave radio",l:"Synthwave"},
              {q:"nature sounds forest birds",l:"Nature"},
              {q:"fireplace crackling sounds",l:"Fireplace"},
              {q:"ocean waves relaxing sleep",l:"Ocean Waves"},
              {q:"studio ghibli lofi",l:"Ghibli Lofi"},
              {q:"cyberpunk ambient music",l:"Cyberpunk"},
              {q:"dark ambient deep focus",l:"Dark Ambient"},
              {q:"celtic relaxing music",l:"Celtic"},
              {q:"brown noise sleep focus",l:"Brown Noise"},
              {q:"delta waves deep sleep",l:"Delta Waves"},
              {q:"anime game ost relaxing",l:"Game OST"},
              {q:"bossa nova relaxing coffee",l:"Bossa Nova"},
            ].map(p => (
              <button key={p.q} onClick={()=>{setDiscQ(p.q);discoverSearch(p.q)}} className="sf-btn" style={{padding:"5px 11px",borderRadius:7,border:`1px solid ${discQ===p.q?T.purple:T.border}`,background:discQ===p.q?T.purpleD:T.input,color:discQ===p.q?T.purple:T.soft,fontSize:fs(11),fontWeight:500,cursor:"pointer"}}>{p.l}</button>
            ))}
          </div>

          {/* Custom search */}
          <div style={{display:"flex",gap:6,marginBottom:16}}>
            <input value={discQ} onChange={e=>setDiscQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")discoverSearch(discQ)}} placeholder="Search YouTube for streams, mixes, ambient..." style={{flex:1,fontSize:fs(12),padding:"9px 14px"}}/>
            <Btn v="ai" onClick={()=>discoverSearch(discQ)} disabled={discLoading||!discQ.trim()}>
              <Ic.IcSearch s={14} c="#fff"/> Search
            </Btn>
            <div style={{display:"flex",gap:3,alignItems:"center"}}>
              {[{k:"video",l:"Videos"},{k:"live",l:"Live"}].map(f=>(
                <button key={f.k} onClick={()=>setDiscType(f.k)} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${discType===f.k?T.purple:T.border}`,background:discType===f.k?T.purpleD:"transparent",color:discType===f.k?T.purple:T.dim,fontSize:fs(10),fontWeight:600,cursor:"pointer"}}>{f.l}</button>
              ))}
            </div>
          </div>

          {/* Loading */}
          {discLoading && (
            <div style={{textAlign:"center",padding:32,color:T.purple}}>
              <Ic.Spin s={24}/><div style={{marginTop:8,fontSize:fs(12)}}>Searching YouTube...</div>
            </div>
          )}

          {/* No results */}
          {!discLoading && discResults.length === 0 && discSearched && (
            <div style={{textAlign:"center",padding:32,color:T.dim}}>
              <div style={{fontSize:fs(14),marginBottom:4}}>No results found</div>
              <div style={{fontSize:fs(11)}}>Try different keywords or check your API key in Settings</div>
            </div>
          )}

          {/* Results grid */}
          {discResults.length > 0 && (
            <div>
              {/* Sort/filter bar for results */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: fs(11), color: T.dim }}>{discResults.length} results for "{discLastQ}"</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: fs(10), color: T.dim }}>Sort:</span>
                <div style={{ display: 'flex', background: T.panel, borderRadius: 7, padding: 2, border: `1px solid ${T.border}` }}>
                  {[
                    { k: 'relevance', label: 'Relevant' },
                    { k: 'views', label: 'Most Viewed' },
                    { k: 'date', label: 'Newest' },
                    { k: 'duration', label: 'Longest' },
                  ].map(s => (
                    <button key={s.k} onClick={() => setDiscSort(s.k)} style={{
                      padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                      background: discSort === s.k ? T.purpleD : 'transparent',
                      color: discSort === s.k ? T.purple : T.dim,
                      fontSize: fs(10), fontWeight: discSort === s.k ? 700 : 500, transition: 'all .12s',
                    }}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
                {[...discResults].sort((a, b) => {
                  if (discSort === 'views') return (parseInt(b.viewCount || '0') || 0) - (parseInt(a.viewCount || '0') || 0);
                  if (discSort === 'date') return (b.publishedAt || '').localeCompare(a.publishedAt || '');
                  if (discSort === 'duration') return (b.durationSec || 0) - (a.durationSec || 0);
                  return 0; // relevance = original order from YouTube API
                }).map(r => {
                  const alreadyInLib = YT_STREAMS.some(s=>s.vid===r.vid) || customStreams.some(s=>s.vid===r.vid);
                  const isPlaying = ytStreams.some(s=>s.vid===r.vid);
                  return (
                    <div key={r.vid} className="sf-yt-card" style={{background:alreadyInLib?`${T.accent}08`:T.card,border:`1.5px solid ${isPlaying?T.accent:alreadyInLib?`${T.accent}44`:T.border}`,borderRadius:10,overflow:"hidden",display:"flex",gap:0}}>
                      <div style={{position:"relative",width:160,minHeight:90,flexShrink:0,background:T.bg2}}>
                        <img src={r.thumb} style={{width:"100%",height:"100%",objectFit:"cover"}} loading="lazy" alt=""/>
                        {r.isLive && <span style={{position:"absolute",top:4,left:4,background:"#e00",color:"#fff",fontSize:fs(8),fontWeight:800,padding:"1px 5px",borderRadius:3}}>LIVE</span>}
                        {r.duration && <span style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,.75)",color:"#fff",fontSize:fs(9),fontWeight:600,padding:"1px 5px",borderRadius:3}}>{r.duration}</span>}
                      </div>
                      <div style={{flex:1,padding:"8px 10px",display:"flex",flexDirection:"column",justifyContent:"space-between",minWidth:0}}>
                        <div>
                          <div style={{fontSize:fs(11),fontWeight:600,color:T.text,lineHeight:1.3,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{r.title}</div>
                          <div style={{fontSize:fs(9),color:T.dim,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.channel}</div>
                          <div style={{fontSize:fs(9),color:T.dim,display:"flex",gap:6,marginTop:2}}>
                            {r.views && <span>{r.views}</span>}
                            {r.published && <span>{r.published}</span>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:4,marginTop:6}}>
                          {alreadyInLib ? (
                            <span style={{fontSize:fs(10),color:T.accent,fontWeight:600,display:"flex",alignItems:"center",gap:3}}><Ic.IcCheck s={11} c={T.accent}/> In Library</span>
                          ) : (
                            <button onClick={()=>{addCustomStream(r.vid,r.title.slice(0,30));toast(`Added: ${r.title.slice(0,40)}`,"success")}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${T.purple}44`,background:T.purpleD,cursor:"pointer",fontSize:fs(10),fontWeight:600,color:T.purple,display:"flex",alignItems:"center",gap:3}}>
                              <Ic.IcPlus s={10} c={T.purple}/> Add to Library
                            </button>
                          )}
                          <button onClick={()=>{ytAddStream({vid:r.vid,name:r.title.slice(0,30),desc:r.channel,cat:"custom"});if(!alreadyInLib)addCustomStream(r.vid,r.title.slice(0,30))}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${T.accent}44`,background:isPlaying?T.accentD:T.input,cursor:"pointer",fontSize:fs(10),fontWeight:600,color:isPlaying?T.accent:T.soft}}>
                            {isPlaying?"Playing":"Play Now"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {discNextPage && (
                <div style={{textAlign:"center",marginTop:12}}>
                  <Btn small v="ghost" onClick={()=>discoverSearch(discLastQ,discNextPage)} disabled={discLoading}>Load More Results</Btn>
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export { AmbientPage };
export default AmbientPage;
