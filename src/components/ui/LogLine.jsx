import { useTheme, fs } from '../../styles/tokens.js';

export const LogLine = ({ l }) => {
  const T = useTheme();
  const colors = {
    user: T.dim,
    error: T.red,
    tool_call: T.purple,
    tool_result: T.accent,
    text: T.soft,
  };
  const color = colors[l.type] || T.soft;
  return (
    <div style={{
      fontSize: fs(10), color, padding: '3px 8px', borderRadius: 6,
      background: l.type === 'error' ? T.redD : 'transparent',
      borderLeft: `2px solid ${color}33`,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4
    }}>
      {l.content}
    </div>
  );
};

export default LogLine;
