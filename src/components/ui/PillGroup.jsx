// PillGroup — radio-style pill selector with connected look
import { useTheme, fs } from '../../styles/tokens.js';

export const PillGroup = ({ options, value, onChange, disabled, small }) => {
  const T = useTheme();
  return (
    <div style={{ display: 'inline-flex', borderRadius: 10, border: `1px solid ${T.border}`, overflow: 'hidden', opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      {options.map((opt, i) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.title || ''}
            style={{
              padding: small ? '5px 12px' : '8px 16px',
              background: isActive ? T.accentD : T.input,
              border: 'none',
              borderRight: i < options.length - 1 ? `1px solid ${T.border}` : 'none',
              color: isActive ? T.accent : T.soft,
              fontSize: fs(small ? 10 : 11),
              fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              transition: 'all .15s ease',
              display: 'flex', alignItems: 'center', gap: 5,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = T.cardH || T.card; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = T.input; }}
          >
            {opt.icon && <span style={{ fontSize: fs(small ? 11 : 12) }}>{opt.icon}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default PillGroup;
