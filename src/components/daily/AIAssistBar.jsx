// AIAssistBar — single-line command bar for AI schedule adjustments
// Replaces the old multi-button AI Planner card with a freeform input + contextual chips

import { useState, useRef, useEffect } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../icons/index.jsx';

/**
 * Generate contextual suggestion chips based on day state.
 */
function getSuggestions(dayProgress, carryCount, conflictCount, isToday, hasPlan, allDone, taskCount) {
  const chips = [];

  if (taskCount === 0) {
    chips.push({ label: 'Plan my study day', prompt: 'Plan my study day based on my course plan. Fill all available time windows with study tasks, breaks, and meals. Use the next topics I haven\'t covered yet.' });
    if (hasPlan) chips.push({ label: 'Fill from course plan', prompt: 'Create study tasks for today from my existing course plan. Use the next uncovered topics I should study based on what I\'ve already completed.' });
    return chips;
  }

  // Partial day — has some tasks but available time remains
  if (taskCount > 0 && !allDone && isToday) {
    chips.push({ label: 'Fill remaining time', prompt: 'I have free time remaining today. Add study tasks for the uncovered topics I haven\'t studied yet, fitting them into my available time windows around my existing tasks.' });
  }

  if (allDone) {
    chips.push({ label: 'Pull tomorrow\'s tasks', prompt: 'Move tomorrow\'s first study task to today so I can get ahead.' });
    chips.push({ label: 'What\'s next in my plan?', prompt: 'What should I study next based on my course progress?' });
    return chips;
  }

  if (isToday) {
    chips.push({ label: 'Reschedule my afternoon', prompt: 'Move all my remaining tasks to later this afternoon or tomorrow. I need the next 2 hours free.' });
    if (carryCount > 0) chips.push({ label: `Catch up on ${carryCount} missed`, prompt: `I have ${carryCount} incomplete tasks from previous days. Fit them into today's remaining time.` });
    if (conflictCount > 0) chips.push({ label: 'Fix time conflicts', prompt: 'Some of my tasks overlap. Rearrange them so nothing conflicts.' });
    chips.push({ label: 'I need a lighter day', prompt: 'Move half of today\'s tasks to tomorrow. Keep only the most important ones.' });
  }

  return chips.slice(0, 4); // Max 4 chips
}

export const AIAssistBar = ({ profile, isLoading, onSubmit, onStop, dayProgress, carryCount, conflictCount, isToday, hasPlan, taskCount }) => {
  const T = useTheme();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const allDone = dayProgress?.allDone || false;

  const suggestions = getSuggestions(dayProgress, carryCount, conflictCount, isToday, hasPlan, allDone, taskCount);

  // Focus on Ctrl+K or /
  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest('input,textarea,select')) return;
      if (e.key === '/' || (e.ctrlKey && e.key === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;
    onSubmit(input.trim());
    setInput('');
    setFocused(false);
  };

  const handleChip = (prompt) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  if (!profile) {
    return (
      <div style={{ padding: '8px 14px', borderRadius: 10, background: T.card, border: `1px solid ${T.border}`, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
        <Ic.AI s={14} />
        <span style={{ fontSize: fs(11), color: T.dim }}>Connect an AI profile in Settings to get AI help</span>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      {/* Main input bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 10,
        background: focused ? T.card : T.input,
        border: `1.5px solid ${focused ? T.accent + '55' : T.border}`,
        transition: 'all .15s',
      }}>
        <Ic.AI s={14} c={isLoading ? T.purple : T.dim} />

        {isLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ic.Spin s={14} />
            <span style={{ fontSize: fs(12), color: T.purple, fontWeight: 500 }}>Working...</span>
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 200)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') { setFocused(false); inputRef.current?.blur(); } }}
            placeholder="Ask AI to adjust your day...  (/ or Ctrl+K)"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: fs(12), color: T.text, padding: '4px 0' }}
          />
        )}

        {isLoading ? (
          <button onClick={onStop} style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${T.red}44`, background: T.redD, color: T.red, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(10), padding: 0 }}>
            <Ic.IcStop s={12} />
          </button>
        ) : input.trim() ? (
          <button onClick={handleSubmit} style={{ width: 28, height: 28, borderRadius: 7, border: 'none', background: T.accent, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            <Ic.Send s={12} />
          </button>
        ) : null}
      </div>

      {/* Suggestion chips — show when focused or when day is empty */}
      {(focused || taskCount === 0) && suggestions.length > 0 && !isLoading && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }} className="plan-reveal">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => handleChip(s.prompt)}
              style={{ padding: '4px 12px', borderRadius: 14, border: `1px solid ${T.border}`, background: T.input, color: T.soft, fontSize: fs(10), cursor: 'pointer', transition: 'all .12s', whiteSpace: 'nowrap' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent + '66'; e.currentTarget.style.color = T.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.soft; }}>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AIAssistBar;
