// Media Slice — SomaFM audio and YouTube multi-stream playback state
//
// NOTE: The actual audio playback engines live in systems/audio.js and
// systems/youtube.js (module-level singletons with their own pub/sub).
// This slice tracks UI-facing media state for components that need to
// read or control playback through the store rather than importing
// those systems directly.

export const createMediaSlice = (set, get) => ({
  // ── SomaFM State ──────────────────────────────────────────────────
  somaPlaying: null,   // station id or null
  somaPaused: false,
  somaVolume: 60,      // 0-100
  somaStation: null,   // full station object or null

  // ── YouTube State ─────────────────────────────────────────────────
  ytStreams: [],        // [{ vid, name, desc, cat, paused, volume, slot }]
  ytVolumes: {},        // { vid: volume } — per-stream volume overrides

  // ── SomaFM Actions ────────────────────────────────────────────────
  setSomaPlaying: (stationId) => set({ somaPlaying: stationId }),

  setSomaStation: (station) => set({
    somaStation: station,
    somaPlaying: station ? station.id : null,
  }),

  toggleSomaPause: () => set((state) => ({
    somaPaused: !state.somaPaused,
  })),

  setSomaPaused: (paused) => set({ somaPaused: paused }),

  setSomaVolume: (volume) => set({
    somaVolume: Math.max(0, Math.min(100, Math.round(volume))),
  }),

  stopSoma: () => set({
    somaPlaying: null,
    somaPaused: false,
    somaStation: null,
  }),

  // ── YouTube Actions ───────────────────────────────────────────────
  setYtStreams: (streams) => set({ ytStreams: streams }),

  addYtStream: (stream) => set((state) => {
    // Already playing? Skip.
    if (state.ytStreams.some((s) => s.vid === stream.vid)) return state;
    // Max 4 streams
    if (state.ytStreams.length >= 4) return state;
    const slot = state.ytStreams.length;
    return {
      ytStreams: [...state.ytStreams, { ...stream, paused: false, volume: 80, slot }],
    };
  }),

  removeYtStream: (vid) => set((state) => {
    const filtered = state.ytStreams.filter((s) => s.vid !== vid);
    // Re-assign slots
    const reindexed = filtered.map((s, i) => ({ ...s, slot: i }));
    const { [vid]: _removed, ...restVolumes } = state.ytVolumes;
    return { ytStreams: reindexed, ytVolumes: restVolumes };
  }),

  clearYtStreams: () => set({ ytStreams: [], ytVolumes: {} }),

  toggleYtPause: (vid) => set((state) => ({
    ytStreams: state.ytStreams.map((s) =>
      s.vid === vid ? { ...s, paused: !s.paused } : s
    ),
  })),

  toggleYtPauseAll: () => set((state) => {
    const anyPlaying = state.ytStreams.some((s) => !s.paused);
    return {
      ytStreams: state.ytStreams.map((s) => ({ ...s, paused: anyPlaying })),
    };
  }),

  setYtVolume: (vid, volume) => set((state) => ({
    ytStreams: state.ytStreams.map((s) =>
      s.vid === vid ? { ...s, volume: Math.round(volume) } : s
    ),
    ytVolumes: { ...state.ytVolumes, [vid]: Math.round(volume) },
  })),

  setYtVolumeAll: (volume) => set((state) => {
    const vol = Math.round(volume);
    const volumes = {};
    state.ytStreams.forEach((s) => { volumes[s.vid] = vol; });
    return {
      ytStreams: state.ytStreams.map((s) => ({ ...s, volume: vol })),
      ytVolumes: volumes,
    };
  }),
});
