// Visualizer — 24-bar audio visualizer for the sidebar media player
// Renders real SomaFM frequency data and/or simulated YouTube bands

import { useTheme } from '../../styles/tokens.js';

const BARS = 24;

/**
 * Compute bar data for the visualizer.
 *
 * @param {object} params
 * @param {boolean} params.isSoma - Whether SomaFM is playing
 * @param {boolean} params.isYT - Whether YouTube streams are active
 * @param {boolean} params.somaPaused - Whether SomaFM is paused
 * @param {boolean} params.ytAllPaused - Whether all YT streams are paused
 * @param {number[]} params.levels - SomaFM frequency levels (16 bands, 0-100)
 * @returns {{ bars: Array<{h: number, hue: number, sat: number, lit: number, val: number}>, allPaused: boolean }}
 */
function computeBarData({ isSoma, isYT, somaPaused, ytAllPaused, levels }) {
  const allPaused = somaPaused && ytAllPaused;
  const now = Date.now();
  const bars = [];

  // Simulate YouTube frequency bands
  const ytBands = [];
  if (isYT && !ytAllPaused) {
    const t = now / 1000;
    for (let b = 0; b < 8; b++) {
      const freq = 0.8 + b * 0.6;
      const amp = b < 2 ? 35 : b < 5 ? 28 : 18;
      const phase = b * 1.7;
      const val = amp
        + Math.sin(t * freq + phase) * amp * 0.6
        + Math.sin(t * (freq * 2.3) + phase * 0.5) * amp * 0.3
        + Math.cos(t * 0.4 + b) * amp * 0.2
        + (Math.random() * 6 - 3);
      ytBands.push(Math.max(4, Math.min(85, val)));
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

      // YouTube simulated data — take max of SomaFM and YT
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
 */
export function Visualizer({ isSoma, isYT, somaPaused, ytAllPaused, levels }) {
  const T = useTheme();
  const { bars, allPaused } = computeBarData({ isSoma, isYT, somaPaused, ytAllPaused, levels });

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
      {/* Main bars */}
      {bars.map((b, i) => (
        <div key={i} style={{
          flex: 1,
          maxWidth: 6,
          borderRadius: 2,
          height: b.h,
          background: allPaused ? T.dim : `hsl(${b.hue},${b.sat}%,${b.lit}%)`,
          boxShadow: !allPaused && b.val > 40
            ? `0 0 6px hsla(${b.hue},80%,55%,.5)`
            : 'none',
          transition: 'height 50ms ease-out',
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
        opacity: 0.08,
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
