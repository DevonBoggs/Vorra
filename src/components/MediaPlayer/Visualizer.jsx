// Visualizer — 24-bar audio visualizer for the sidebar media player
// Renders real SomaFM frequency data and genre-aware simulated YouTube bands

import { useState, useEffect, useRef } from 'react';
import { useTheme } from '../../styles/tokens.js';

const BARS = 24;

/* ── Genre Profiles ─────────────────────────────────────────────
   Each genre gets a distinct "energy fingerprint" that shapes
   the simulated frequency data — making the visualizer feel
   responsive to the type of music being played.

   bass/mid/treble: relative amplitude weights (0-1)
   tempo: how fast the primary oscillation cycles (Hz-ish)
   drift: how much organic variation over time
   jitter: randomness per frame (higher = more percussive)
   pulse: rhythmic pulse strength (0=none, 1=strong beat)
   ────────────────────────────────────────────────────────────── */
const GENRE_PROFILES = {
  lofi:      { bass: 0.7, mid: 0.9, treble: 0.3, tempo: 0.6,  drift: 0.4, jitter: 3, pulse: 0.5 },
  jazz:      { bass: 0.6, mid: 1.0, treble: 0.5, tempo: 0.8,  drift: 0.6, jitter: 5, pulse: 0.3 },
  classical: { bass: 0.5, mid: 0.8, treble: 0.7, tempo: 0.4,  drift: 0.8, jitter: 2, pulse: 0.1 },
  ambient:   { bass: 0.8, mid: 0.5, treble: 0.2, tempo: 0.2,  drift: 0.9, jitter: 1, pulse: 0.0 },
  synth:     { bass: 0.9, mid: 0.7, treble: 0.8, tempo: 1.2,  drift: 0.3, jitter: 6, pulse: 0.8 },
  focus:     { bass: 0.4, mid: 0.6, treble: 0.3, tempo: 0.3,  drift: 0.7, jitter: 2, pulse: 0.1 },
  chill:     { bass: 0.6, mid: 0.8, treble: 0.4, tempo: 0.5,  drift: 0.5, jitter: 3, pulse: 0.4 },
  asmr:      { bass: 0.2, mid: 0.4, treble: 0.8, tempo: 0.15, drift: 0.9, jitter: 4, pulse: 0.0 },
  sleep:     { bass: 0.6, mid: 0.3, treble: 0.1, tempo: 0.1,  drift: 0.95,jitter: 1, pulse: 0.0 },
  world:     { bass: 0.7, mid: 0.9, treble: 0.6, tempo: 0.9,  drift: 0.5, jitter: 5, pulse: 0.6 },
  default:   { bass: 0.6, mid: 0.7, treble: 0.5, tempo: 0.7,  drift: 0.5, jitter: 4, pulse: 0.4 },
};

function getGenreProfile(cat) {
  if (!cat) return GENRE_PROFILES.default;
  // Extract parent from subcategory (e.g., "lofi-beats" → "lofi", "ambient-rain" → "ambient")
  const parent = cat.split('-')[0];
  return GENRE_PROFILES[parent] || GENRE_PROFILES.default;
}

/* ── Smoothed random walk — creates organic "energy" variation ── */
function smoothNoise(seed, t, speed) {
  // Simple smooth noise using layered sine waves with irrational frequencies
  const a = Math.sin(t * speed * 0.7 + seed * 3.17) * 0.4;
  const b = Math.sin(t * speed * 1.13 + seed * 7.31) * 0.3;
  const c = Math.sin(t * speed * 0.31 + seed * 11.03) * 0.2;
  const d = Math.sin(t * speed * 2.71 + seed * 2.09) * 0.1;
  return a + b + c + d;
}

/**
 * Compute bar data for the visualizer.
 */
function computeBarData({ isSoma, isYT, somaPaused, ytAllPaused, levels, ytGenre, ytVolume }) {
  const allPaused = somaPaused && ytAllPaused;
  const t = Date.now() / 1000;
  const bars = [];
  const gp = getGenreProfile(ytGenre);
  const vol = (ytVolume ?? 100) / 100; // 0-1

  // Generate genre-aware YouTube frequency bands (16 bands to match SomaFM resolution)
  const ytBands = [];
  if (isYT && !ytAllPaused) {
    for (let b = 0; b < 16; b++) {
      const bandPos = b / 15; // 0=bass, 1=treble

      // Frequency weight based on genre (bass-heavy vs treble-heavy)
      const freqWeight = (1 - bandPos) * gp.bass + (bandPos < 0.5 ? gp.mid : 0) + bandPos * gp.treble;

      // Base amplitude from genre profile
      const baseAmp = 20 + freqWeight * 30;

      // Tempo-driven primary oscillation (the "beat")
      const beatFreq = gp.tempo * (0.8 + bandPos * 0.4);
      const beat = Math.sin(t * beatFreq * Math.PI * 2 + b * 0.9) * gp.pulse * 15;

      // Organic drift — slow, smooth variation (the "mood")
      const drift = smoothNoise(b, t, gp.drift * 0.5) * 20 * gp.drift;

      // Secondary harmonic — adds texture
      const harmonic = Math.sin(t * (beatFreq * 1.5) + b * 2.3) * 8 * freqWeight;

      // Tertiary movement — very slow breathing
      const breath = Math.sin(t * 0.15 + b * 0.4) * 6;

      // Per-frame jitter (randomness)
      const noise = (Math.random() - 0.5) * gp.jitter * 2;

      // Combine all layers, scaled by volume
      const raw = (baseAmp + beat + drift + harmonic + breath + noise) * vol;
      ytBands.push(Math.max(2, Math.min(90, raw)));
    }
  }

  for (let i = 0; i < BARS; i++) {
    const center = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
    let val = 0;

    if (!allPaused) {
      // SomaFM real audio data — interpolate 16 bands into BARS positions
      if (isSoma && !somaPaused) {
        const fi = (i / BARS) * (levels.length - 1);
        const lo = Math.floor(fi);
        const hi = Math.min(lo + 1, levels.length - 1);
        val = levels[lo] + (levels[hi] - levels[lo]) * (fi - lo);
      }

      // YouTube genre-simulated data — take max of SomaFM and YT
      if (isYT && !ytAllPaused && ytBands.length > 0) {
        const bi = (i / BARS) * (ytBands.length - 1);
        const blo = Math.floor(bi);
        const bhi = Math.min(blo + 1, ytBands.length - 1);
        val = Math.max(val, ytBands[blo] + (ytBands[bhi] - ytBands[blo]) * (bi - blo));
      }
    }

    val = Math.max(0, Math.min(100, val));
    const h = allPaused ? 1 : Math.max(1, Math.round(val * 0.52));
    const hue = allPaused
      ? 0
      : isSoma && isYT
        ? (280 - center * 60)
        : isSoma
          ? (140 - center * 90)
          : (0 + center * 30);

    bars.push({
      h,
      hue,
      sat: allPaused ? 0 : isYT && !isSoma ? 70 + val * 0.3 : 55 + val * 0.45,
      lit: allPaused ? 25 : isYT && !isSoma ? 35 + val * 0.3 : 30 + val * 0.25,
      val,
    });
  }

  return { bars, allPaused };
}

/**
 * Visualizer — 24-bar audio frequency display.
 *
 * @param {object} props
 * @param {boolean} props.isSoma - SomaFM is playing
 * @param {boolean} props.isYT - YouTube streams are active
 * @param {boolean} props.somaPaused - SomaFM is paused
 * @param {boolean} props.ytAllPaused - All YouTube streams are paused
 * @param {number[]} props.levels - SomaFM frequency levels (16 bands, 0-100)
 * @param {string} [props.ytGenre] - YouTube stream category (e.g., "lofi-beats", "ambient-rain")
 * @param {number} [props.ytVolume] - YouTube average volume (0-100)
 */
export function Visualizer({ isSoma, isYT, somaPaused, ytAllPaused, levels, ytGenre, ytVolume }) {
  const T = useTheme();

  // Force re-renders when YouTube is playing (simulated data uses Date.now())
  const [, setTick] = useState(0);
  useEffect(() => {
    if (isYT && !ytAllPaused) {
      const id = setInterval(() => setTick(t => t + 1), 60);
      return () => clearInterval(id);
    }
  }, [isYT, ytAllPaused]);

  const { bars, allPaused } = computeBarData({ isSoma, isYT, somaPaused, ytAllPaused, levels, ytGenre, ytVolume });

  // Breathing animation for paused state
  const breathPhase = allPaused ? (Math.sin(Date.now() / 1500) * 0.3 + 0.7) : 1;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 1.5,
      height: 56,
      padding: '12px 8px 0',
      position: 'relative',
    }}>
      {/* Glow diffusion layer — ambient light behind bars */}
      {!allPaused && (
        <div style={{
          position: 'absolute', bottom: 0, left: '10%', right: '10%', height: 40,
          background: `radial-gradient(ellipse at center bottom, hsla(${bars[12]?.hue || 200},70%,50%,.15) 0%, transparent 70%)`,
          pointerEvents: 'none', filter: 'blur(12px)',
        }} />
      )}
      {/* Main bars */}
      {bars.map((b, i) => (
        <div key={i} style={{
          flex: 1,
          maxWidth: 6,
          borderRadius: 2,
          height: allPaused ? Math.max(4, b.h * breathPhase * 0.4) : b.h,
          background: allPaused ? `hsl(${bars[12]?.hue || 200},20%,30%)` : `hsl(${b.hue},${b.sat}%,${b.lit}%)`,
          boxShadow: !allPaused && b.val > 40
            ? `0 0 8px hsla(${b.hue},80%,55%,.5)`
            : 'none',
          transition: allPaused ? 'height 1.5s ease-in-out' : 'height 50ms ease-out',
          opacity: allPaused ? 0.5 + breathPhase * 0.3 : 1,
        }} />
      ))}
      {/* Reflection */}
      <div style={{
        position: 'absolute',
        bottom: -2,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        gap: 1.5,
        transform: 'scaleY(-0.2)',
        transformOrigin: 'top',
        opacity: allPaused ? 0.04 : 0.08,
        pointerEvents: 'none',
        filter: 'blur(1px)',
      }}>
        {bars.map((b, i) => (
          <div key={i} style={{
            flex: 1,
            maxWidth: 6,
            borderRadius: 2,
            height: b.h,
            background: `hsl(${b.hue},${b.sat}%,${b.lit}%)`,
          }} />
        ))}
      </div>
    </div>
  );
}

export default Visualizer;
