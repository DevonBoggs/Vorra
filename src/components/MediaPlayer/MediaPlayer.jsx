// MediaPlayer — Unified sidebar media player for SomaFM + YouTube
// Extracted from App.jsx sidebar media player section

import { useTheme, fs } from '../../styles/tokens.js';
import { STATIONS, audioPauseToggle, audioStop, audioSetVolume, audioNext, audioPrev } from '../../systems/audio.js';
import { ytPauseToggle, ytPauseAll, ytClearAll, ytSetVolume, ytNext, ytPrev, toggleFav } from '../../systems/youtube.js';
import Ic from '../icons/index.jsx';
import { VolumeBar } from '../ui/VolumeBar.jsx';
import { Visualizer } from './Visualizer.jsx';

/**
 * MediaPlayer — Unified media player for the sidebar.
 * Displays visualizer, now playing info, transport controls, and volume sliders
 * for both SomaFM radio and YouTube streams simultaneously.
 *
 * @param {object} props
 * @param {object} props.audioIndicator - From useAudio(): { playing, volume, paused, levels }
 * @param {Array} props.ytStreams - From useYtStreams(): [{ vid, name, paused, volume, slot }]
 * @param {object} props.favs - From useFavs(): { soma: string[], yt: string[] }
 */
export function MediaPlayer({ audioIndicator, ytStreams, favs }) {
  const T = useTheme();

  const isSoma = !!audioIndicator.playing;
  const isYT = ytStreams.length > 0;

  // Don't render if nothing is playing
  if (!isSoma && !isYT) return null;

  const station = isSoma ? STATIONS.find(s => s.id === audioIndicator.playing) : null;
  const somaPaused = isSoma ? audioIndicator.paused : true;
  const ytAllPaused = isYT ? ytStreams.every(s => s.paused) : true;
  const allPaused = somaPaused && ytAllPaused;
  const levels = audioIndicator.levels || new Array(16).fill(0);
  const sourceCount = (isSoma ? 1 : 0) + (isYT ? 1 : 0);
  const accentColor = sourceCount > 1 ? T.purple : isSoma ? T.accent : T.blue;

  return (
    <div style={{
      borderTop: `2px solid ${accentColor}33`,
      background: `linear-gradient(180deg,${isSoma && isYT ? `${T.purple}22` : isSoma ? T.accentD : T.blueD}66,${T.bg})`,
    }}>
      {/* Visualizer */}
      <Visualizer
        isSoma={isSoma}
        isYT={isYT}
        somaPaused={somaPaused}
        ytAllPaused={ytAllPaused}
        levels={levels}
      />

      {/* Now playing */}
      <NowPlaying
        isSoma={isSoma}
        isYT={isYT}
        station={station}
        ytStreams={ytStreams}
        favs={favs}
        accentColor={accentColor}
      />

      {/* Transport controls */}
      <Transport
        isSoma={isSoma}
        isYT={isYT}
        allPaused={allPaused}
        accentColor={accentColor}
      />

      {/* Volume — SomaFM */}
      {isSoma && (
        <SomaVolume volume={audioIndicator.volume} />
      )}

      {/* YouTube per-stream volume */}
      {isYT && ytStreams.map(s => (
        <YtStreamVolume key={s.vid} stream={s} />
      ))}
    </div>
  );
}

// ── Now Playing Info ───────────────────────────────────────────────

function NowPlaying({ isSoma, isYT, station, ytStreams, favs, accentColor }) {
  const T = useTheme();

  return (
    <div style={{ textAlign: 'center', padding: '6px 10px 2px', overflow: 'hidden' }}>
      {isSoma && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Ic.Radio s={14} c={T.accent} />
          <div style={{
            fontSize: fs(13),
            fontWeight: 700,
            color: T.accent,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 120,
          }}>
            {station?.name}
          </div>
          <button
            onClick={() => toggleFav('soma', station?.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: fs(14),
              color: favs.soma?.includes(station?.id) ? T.yellow : T.dim,
            }}
          >
            {favs.soma?.includes(station?.id) ? '\u2605' : '\u2606'}
          </button>
        </div>
      )}
      {isYT && ytStreams.map((s, i) => (
        <div key={s.vid} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          opacity: s.paused ? 0.5 : 1,
          transition: 'opacity .2s',
        }}>
          <div style={{
            fontSize: fs(12),
            fontWeight: 600,
            color: s.paused ? T.dim : T.blue,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            {i === 0 && <Ic.YT s={14} c={s.paused ? T.dim : T.blue} />}
            {' '}{s.paused && <Ic.IcPause s={10} c={T.dim} />}{s.name}
          </div>
          <button
            onClick={() => toggleFav('yt', s.vid)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: fs(12),
              color: favs.yt?.includes(s.vid) ? T.yellow : T.dim,
            }}
          >
            {favs.yt?.includes(s.vid) ? '\u2605' : '\u2606'}
          </button>
        </div>
      ))}
      <div style={{ fontSize: fs(9), color: accentColor, marginTop: 2, fontWeight: 500 }}>
        {[isSoma && 'SomaFM', isYT && 'YouTube'].filter(Boolean).join(' + ')}
      </div>
    </div>
  );
}

// ── Transport Controls ─────────────────────────────────────────────

function Transport({ isSoma, isYT, allPaused, accentColor }) {
  const T = useTheme();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      padding: '4px 10px 6px',
    }}>
      {/* Previous */}
      <button
        onClick={isSoma ? audioPrev : ytPrev}
        style={{
          background: T.input,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: '7px 12px',
          cursor: 'pointer',
          color: T.soft,
          lineHeight: 1,
        }}
      >
        <Ic.IcSkipB s={16} c={T.soft} />
      </button>

      {/* Play / Pause */}
      <button
        onClick={() => {
          if (isSoma) audioPauseToggle();
          if (isYT) ytPauseAll();
        }}
        style={{
          background: allPaused ? `${accentColor}22` : T.input,
          border: `2px solid ${allPaused ? accentColor : T.border}`,
          borderRadius: 10,
          padding: '8px 22px',
          cursor: 'pointer',
          color: allPaused ? accentColor : T.soft,
          lineHeight: 1,
        }}
      >
        {allPaused
          ? <Ic.IcPlay s={20} c={accentColor} />
          : <Ic.IcPause s={20} c={T.soft} />}
      </button>

      {/* Stop */}
      <button
        onClick={() => {
          if (isSoma) audioStop();
          if (isYT) ytClearAll();
        }}
        style={{
          background: T.redD,
          border: `1px solid ${T.red}33`,
          borderRadius: 8,
          padding: '7px 12px',
          cursor: 'pointer',
          color: T.red,
          lineHeight: 1,
        }}
      >
        <Ic.IcStop s={16} c={T.red} />
      </button>

      {/* Next */}
      <button
        onClick={isSoma ? audioNext : ytNext}
        style={{
          background: T.input,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: '7px 12px',
          cursor: 'pointer',
          color: T.soft,
          lineHeight: 1,
        }}
      >
        <Ic.IcSkipF s={16} c={T.soft} />
      </button>
    </div>
  );
}

// ── SomaFM Volume Slider ──────────────────────────────────────────

function SomaVolume({ volume }) {
  const T = useTheme();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 10px 6px' }}>
      <Ic.Radio s={11} c={T.dim} />
      <span
        style={{ cursor: 'pointer' }}
        onClick={() => audioSetVolume(Math.max(0, volume - 0.05))}
      >
        <Ic.IcVolLow s={13} c={T.dim} />
      </span>
      <VolumeBar value={volume} onChange={audioSetVolume} />
      <span
        style={{ cursor: 'pointer' }}
        onClick={() => audioSetVolume(Math.min(1, volume + 0.05))}
      >
        <Ic.IcVolHi s={13} c={T.dim} />
      </span>
      <span style={{
        fontSize: fs(10),
        color: T.dim,
        minWidth: 26,
        textAlign: 'right',
        fontFamily: "'JetBrains Mono',monospace",
      }}>
        {Math.round(volume * 100)}
      </span>
    </div>
  );
}

// ── YouTube Per-Stream Volume Slider ──────────────────────────────

function YtStreamVolume({ stream }) {
  const T = useTheme();
  const s = stream;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px 5px' }}>
      <button
        onClick={() => ytPauseToggle(s.vid)}
        style={{
          background: s.paused ? `${T.blue}22` : T.input,
          border: `1px solid ${s.paused ? T.blue : T.border}`,
          borderRadius: 6,
          padding: '3px 6px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {s.paused
          ? <Ic.IcPlay s={12} c={T.blue} />
          : <Ic.IcPause s={12} c={T.dim} />}
      </button>
      <span style={{
        fontSize: fs(10),
        color: s.paused ? T.dim : T.blue,
        minWidth: 52,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontWeight: 500,
      }}>
        {s.name.length > 8 ? s.name.slice(0, 8) + '...' : s.name}
      </span>
      <span
        style={{ cursor: 'pointer' }}
        onClick={() => ytSetVolume(Math.max(0, s.volume - 5), s.vid)}
      >
        <Ic.IcVolLow s={11} c={T.dim} />
      </span>
      <VolumeBar value={s.volume / 100} onChange={v => ytSetVolume(v * 100, s.vid)} />
      <span
        style={{ cursor: 'pointer' }}
        onClick={() => ytSetVolume(Math.min(100, s.volume + 5), s.vid)}
      >
        <Ic.IcVolHi s={11} c={T.dim} />
      </span>
      <span style={{
        fontSize: fs(9),
        color: T.dim,
        minWidth: 20,
        textAlign: 'right',
        fontFamily: "'JetBrains Mono',monospace",
      }}>
        {s.volume}
      </span>
    </div>
  );
}

export default MediaPlayer;
