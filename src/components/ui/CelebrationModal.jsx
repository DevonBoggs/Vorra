import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTheme, fs } from '../../styles/tokens.js';

const MESSAGES = [
  'One step closer to your degree!',
  'Your dedication is paying off!',
  'Keep this momentum going!',
  'Hard work pays off — well done!',
];

const CONFETTI_COUNT = 18;

const confettiKeyframes = `
@keyframes celebConfettiFall {
  0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translateY(calc(100vh + 40px)) rotate(720deg); opacity: 0; }
}
@keyframes celebCardPop {
  0% { transform: scale(0.85) translateY(24px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}
`;

const CelebrationModal = ({ show, onClose, courseName, credits, studyHours }) => {
  const T = useTheme();

  const confettiParticles = useMemo(() => {
    const colors = [T.accent, T.blue, T.purple, T.orange];
    return Array.from({ length: CONFETTI_COUNT }, (_, i) => {
      const left = Math.random() * 100;
      const delay = Math.random() * 3;
      const duration = 2.5 + Math.random() * 2;
      const size = 5 + Math.random() * 4;
      const color = colors[i % colors.length];
      const isCircle = i % 3 === 0;
      return { left, delay, duration, size, color, isCircle };
    });
  }, [T.accent, T.blue, T.purple, T.orange]);

  const message = useMemo(() => {
    return MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
  }, []);

  if (!show) return null;

  const completionDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        padding: 24,
      }}
    >
      <style>{confettiKeyframes}</style>

      {/* Confetti particles */}
      {confettiParticles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: -12,
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            borderRadius: p.isCircle ? '50%' : 2,
            background: p.color,
            opacity: 0,
            pointerEvents: 'none',
            animation: `celebConfettiFall ${p.duration}s ease-in ${p.delay}s infinite`,
          }}
        />
      ))}

      {/* Card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 20,
          padding: '40px 36px 32px',
          background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`,
          border: `1.5px solid ${T.accent}33`,
          boxShadow: `0 24px 60px rgba(0,0,0,.5), 0 0 80px ${T.accent}15`,
          textAlign: 'center',
          position: 'relative',
          zIndex: 1,
          animation: 'celebCardPop 0.3s cubic-bezier(.4,0,.2,1) both',
        }}
      >
        {/* Emoji */}
        <div style={{ fontSize: 56, marginBottom: 16, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.3))' }}>
          {'\uD83C\uDF93'}
        </div>

        {/* Heading */}
        <div style={{
          fontSize: fs(22),
          fontWeight: 800,
          color: T.text,
          marginBottom: 8,
          letterSpacing: '-0.02em',
        }}>
          Course Completed!
        </div>

        {/* Course name */}
        <div style={{
          fontSize: fs(15),
          fontWeight: 600,
          color: T.accent,
          marginBottom: 24,
          lineHeight: 1.4,
        }}>
          {courseName || 'Untitled Course'}
        </div>

        {/* Stats row */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          marginBottom: 24,
        }}>
          {[
            { label: 'Credits', value: credits ?? '—' },
            { label: 'Hours Studied', value: studyHours ?? '—' },
            { label: 'Completed', value: completionDate },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                flex: 1,
                padding: '12px 8px',
                borderRadius: 12,
                background: `${T.card}88`,
                border: `1px solid ${T.border}`,
              }}
            >
              <div style={{
                fontSize: fs(16),
                fontWeight: 700,
                color: T.text,
                lineHeight: 1.2,
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: fs(10),
                color: T.dim,
                marginTop: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 600,
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Encouraging message */}
        <div style={{
          fontSize: fs(13),
          color: T.soft,
          marginBottom: 28,
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}>
          {message}
        </div>

        {/* Continue button */}
        <button
          onClick={onClose}
          style={{
            background: `linear-gradient(135deg, ${T.accent}, ${T.accent}dd)`,
            color: '#060e09',
            border: 'none',
            borderRadius: 10,
            padding: '10px 32px',
            fontSize: fs(13),
            fontWeight: 600,
            fontFamily: "'Outfit', sans-serif",
            cursor: 'pointer',
            boxShadow: `0 2px 12px ${T.accent}44`,
            letterSpacing: '0.2px',
            transition: 'all .2s',
          }}
        >
          Continue
        </button>
      </div>
    </div>,
    document.body
  );
};

export { CelebrationModal };
export default CelebrationModal;
