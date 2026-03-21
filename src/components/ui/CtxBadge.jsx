import { fs } from '../../styles/tokens.js';

export const CtxBadge = ({ label, count, color }) => {
  if (!count) return null;
  return (
    <span style={{
      fontSize: fs(9), color, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', gap: 3
    }}>
      {label}: {count}
    </span>
  );
};

export default CtxBadge;
