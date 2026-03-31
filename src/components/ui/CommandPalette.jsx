// Command Palette — Mod+K searchable command launcher
// Fuzzy-matches pages, shortcuts, actions, courses, and recent items

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../icons/index.jsx';
import { SHORTCUTS, formatShortcut } from '../../systems/shortcuts.js';

// ── Fuzzy Match ─────────────────────────────────────────────────────

function fuzzyMatch(query, text) {
  if (!query) return { match: true, score: 0, ranges: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact substring match — highest priority
  const idx = t.indexOf(q);
  if (idx !== -1) {
    return { match: true, score: 100 + q.length, ranges: [[idx, idx + q.length]] };
  }

  // Word-start matching
  let qi = 0;
  let score = 0;
  const ranges = [];
  let rangeStart = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (rangeStart === -1) rangeStart = ti;
      // Bonus for matching at word start
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' || t[ti - 1] === '_') {
        score += 10;
      }
      score += 1;
      qi++;
    } else {
      if (rangeStart !== -1) {
        ranges.push([rangeStart, ti]);
        rangeStart = -1;
      }
    }
  }
  if (rangeStart !== -1) ranges.push([rangeStart, ranges.length > 0 ? ranges[ranges.length - 1][1] + qi : rangeStart + qi]);

  if (qi === q.length) {
    return { match: true, score, ranges };
  }
  return { match: false, score: 0, ranges: [] };
}

// ── Highlight matched text ──────────────────────────────────────────

function HighlightText({ text, ranges, color }) {
  if (!ranges || ranges.length === 0) return <span>{text}</span>;

  const parts = [];
  let lastEnd = 0;
  for (const [start, end] of ranges) {
    if (start > lastEnd) {
      parts.push(<span key={`t${lastEnd}`}>{text.slice(lastEnd, start)}</span>);
    }
    parts.push(
      <span key={`h${start}`} style={{ color, fontWeight: 700 }}>
        {text.slice(start, end)}
      </span>
    );
    lastEnd = end;
  }
  if (lastEnd < text.length) {
    parts.push(<span key={`t${lastEnd}`}>{text.slice(lastEnd)}</span>);
  }
  return <>{parts}</>;
}

// ── Navigation Items ────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Degree Dashboard', icon: 'Grad',   color: '#06d6a0', shortcutId: 'go-dashboard' },
  { id: 'courses',   label: 'My Courses',        icon: 'Edit',   color: '#a78bfa', shortcutId: 'go-courses' },
  { id: 'planner',   label: 'Study Planner',     icon: 'Cal',    color: '#8b5cf6', shortcutId: 'go-planner' },
  { id: 'daily',     label: 'Daily Planner',     icon: 'List',   color: '#60a5fa', shortcutId: 'go-daily' },
  { id: 'calendar',  label: 'Calendar',          icon: 'Cal',    color: '#f472b6', shortcutId: 'go-calendar' },
  { id: 'chat',      label: 'Study Chat',        icon: 'Chat',   color: '#34d399', shortcutId: 'go-chat' },
  { id: 'quiz',      label: 'Practice Exam',     icon: 'Quiz',   color: '#fb923c', shortcutId: 'go-quiz' },
  { id: 'report',    label: 'Weekly Report',     icon: 'Report', color: '#38bdf8', shortcutId: 'go-report' },
  { id: 'ambient',   label: 'Study Radio',       icon: 'Music',  color: '#c084fc', shortcutId: 'go-ambient' },
  { id: 'settings',  label: 'Settings',          icon: 'Gear',   color: '#999',    shortcutId: 'go-settings' },
];

// ── Action Items ────────────────────────────────────────────────────

const ACTION_ITEMS = [
  { id: 'new-task',         label: 'New Task',          icon: 'IcPlus',   shortcutId: 'new-task' },
  { id: 'quick-add',        label: 'Quick Add Course',  icon: 'Plus',     shortcutId: 'quick-add' },
  { id: 'search',           label: 'Search',            icon: 'IcSearch', shortcutId: 'search' },
  { id: 'toggle-timer',     label: 'Start/Stop Timer',  icon: 'Clock',    shortcutId: 'toggle-timer' },
  { id: 'pause-timer',      label: 'Pause Timer',       icon: 'IcPause',  shortcutId: 'pause-timer' },
  { id: 'toggle-sidebar',   label: 'Toggle Sidebar',    icon: 'ChevL',    shortcutId: 'toggle-sidebar' },
  { id: 'media-play-pause', label: 'Play/Pause Media',  icon: 'IcPlay',   shortcutId: 'media-play-pause' },
  { id: 'media-next',       label: 'Next Track',        icon: 'IcSkipF',  shortcutId: 'media-next' },
  { id: 'media-prev',       label: 'Previous Track',    icon: 'IcSkipB',  shortcutId: 'media-prev' },
  { id: 'media-stop',       label: 'Stop Media',        icon: 'IcStop',   shortcutId: 'media-stop' },
  { id: 'zoom-in',          label: 'Zoom In',           icon: 'IcPlus',   shortcutId: 'zoom-in' },
  { id: 'zoom-out',         label: 'Zoom Out',          icon: 'IcX',      shortcutId: 'zoom-out' },
  { id: 'zoom-reset',       label: 'Reset Zoom',        icon: 'IcTarget', shortcutId: 'zoom-reset' },
];

// ── Shortcut Badge ──────────────────────────────────────────────────

function ShortcutBadge({ shortcutKey, T }) {
  if (!shortcutKey) return null;
  const formatted = formatShortcut(shortcutKey);
  const parts = formatted.split('+');
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
      {parts.map((part, i) => (
        <kbd key={i} style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 22,
          height: 22,
          padding: '0 5px',
          borderRadius: 5,
          background: T.bg2,
          border: `1px solid ${T.border}`,
          color: T.dim,
          fontSize: fs(10),
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 500,
          lineHeight: 1,
        }}>
          {part}
        </kbd>
      ))}
    </div>
  );
}

// ── Command Palette Component ───────────────────────────────────────

const CommandPalette = ({ open, onClose, onAction, courses = [], recentPages = [], data = {} }) => {
  const T = useTheme();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const bdRef = useRef(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Focus input after portal renders
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Build items list
  const items = useMemo(() => {
    const result = [];

    // Recent pages section
    if (recentPages.length > 0 && !query) {
      const recentNavItems = recentPages
        .map(pageKey => NAV_ITEMS.find(n => n.id === pageKey))
        .filter(Boolean)
        .slice(0, 4);
      for (const nav of recentNavItems) {
        result.push({
          section: 'Recent',
          type: 'navigate',
          target: nav.id,
          label: nav.label,
          icon: nav.icon,
          color: nav.color,
          shortcutKey: SHORTCUTS[nav.shortcutId]?.key,
          score: 200,
        });
      }
    }

    // Navigation section
    for (const nav of NAV_ITEMS) {
      const fm = fuzzyMatch(query, nav.label);
      if (fm.match) {
        result.push({
          section: 'Navigation',
          type: 'navigate',
          target: nav.id,
          label: nav.label,
          icon: nav.icon,
          color: nav.color,
          shortcutKey: SHORTCUTS[nav.shortcutId]?.key,
          score: fm.score,
          ranges: fm.ranges,
        });
      }
    }

    // Actions section
    for (const action of ACTION_ITEMS) {
      const fm = fuzzyMatch(query, action.label);
      if (fm.match) {
        result.push({
          section: 'Actions',
          type: 'action',
          target: action.id,
          label: action.label,
          icon: action.icon,
          shortcutKey: SHORTCUTS[action.shortcutId]?.key,
          score: fm.score,
          ranges: fm.ranges,
        });
      }
    }

    // Courses section
    if (courses.length > 0) {
      for (const course of courses) {
        const name = course.name || course.title || '';
        if (!name) continue;
        const fm = fuzzyMatch(query, name);
        if (fm.match) {
          result.push({
            section: 'Courses',
            type: 'navigate',
            target: 'planner',
            label: name,
            icon: 'Book',
            color: course.color || T.accent,
            shortcutKey: null,
            score: fm.score,
            ranges: fm.ranges,
            meta: course.code || null,
          });
        }
      }
    }

    // Tasks section (only when searching)
    if (query && data.tasks) {
      let taskCount = 0;
      for (const [date, dateTasks] of Object.entries(data.tasks)) {
        if (taskCount >= 5) break;
        for (const task of (Array.isArray(dateTasks) ? dateTasks : [])) {
          if (taskCount >= 5) break;
          const fm = fuzzyMatch(query, task.title || '');
          if (fm.match) {
            result.push({
              section: 'Tasks',
              type: 'navigate',
              target: 'daily',
              label: task.title,
              icon: 'List',
              color: '#60a5fa',
              shortcutKey: null,
              score: fm.score,
              ranges: fm.ranges,
              meta: date,
              date,
            });
            taskCount++;
          }
        }
      }
    }

    // Course codes section (only when searching)
    if (query && courses.length > 0) {
      for (const course of courses) {
        const code = course.courseCode || '';
        if (!code) continue;
        const fm = fuzzyMatch(query, code);
        if (fm.match) {
          // Avoid duplicating courses already matched by name
          const alreadyMatched = result.some(r => r.section === 'Courses' && r.label === (course.name || course.title || ''));
          if (!alreadyMatched) {
            result.push({
              section: 'Courses',
              type: 'navigate',
              target: 'planner',
              label: course.name || course.title || code,
              icon: 'Book',
              color: course.color || T.accent,
              shortcutKey: null,
              score: fm.score,
              ranges: [],
              meta: code,
            });
          }
        }
      }
    }

    // Topics section (only when searching)
    if (query && courses.length > 0) {
      let topicCount = 0;
      for (const course of courses) {
        if (topicCount >= 5) break;
        for (const tb of (Array.isArray(course.topicBreakdown) ? course.topicBreakdown : [])) {
          if (topicCount >= 5) break;
          const topic = tb.topic || '';
          if (!topic) continue;
          const fm = fuzzyMatch(query, topic);
          if (fm.match) {
            result.push({
              section: 'Topics',
              type: 'navigate',
              target: 'planner',
              label: topic,
              icon: 'Edit',
              color: '#a78bfa',
              shortcutKey: null,
              score: fm.score,
              ranges: fm.ranges,
              meta: course.name || '',
            });
            topicCount++;
          }
        }
      }
    }

    // Terms section (only when searching)
    if (query && courses.length > 0) {
      let termCount = 0;
      for (const course of courses) {
        if (termCount >= 5) break;
        for (const kt of (Array.isArray(course.keyTermsAndConcepts) ? course.keyTermsAndConcepts : [])) {
          if (termCount >= 5) break;
          const term = kt.term || '';
          if (!term) continue;
          const fm = fuzzyMatch(query, term);
          if (fm.match) {
            result.push({
              section: 'Terms',
              type: 'navigate',
              target: 'planner',
              label: term,
              icon: 'Book',
              color: '#34d399',
              shortcutKey: null,
              score: fm.score,
              ranges: fm.ranges,
              meta: course.name || '',
            });
            termCount++;
          }
        }
      }
    }

    // Sort by score (descending), then alphabetically
    if (query) {
      result.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    }

    return result;
  }, [query, courses, recentPages, T.accent, data]);

  // Group items by section for rendering
  const groupedItems = useMemo(() => {
    const sections = [];
    const sectionMap = {};

    // Determine section order
    const sectionOrder = query
      ? ['Navigation', 'Actions', 'Courses', 'Tasks', 'Topics', 'Terms']
      : ['Recent', 'Navigation', 'Actions', 'Courses'];

    for (const item of items) {
      if (!sectionMap[item.section]) {
        sectionMap[item.section] = [];
      }
      sectionMap[item.section].push(item);
    }

    for (const name of sectionOrder) {
      if (sectionMap[name] && sectionMap[name].length > 0) {
        sections.push({ name, items: sectionMap[name] });
      }
    }
    return sections;
  }, [items, query]);

  // Flat list of items for keyboard navigation
  const flatItems = useMemo(() => {
    const flat = [];
    for (const section of groupedItems) {
      for (const item of section.items) {
        flat.push(item);
      }
    }
    return flat;
  }, [groupedItems]);

  // Clamp active index when items change
  useEffect(() => {
    if (activeIdx >= flatItems.length) {
      setActiveIdx(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, activeIdx]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % Math.max(1, flatItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (i - 1 + flatItems.length) % Math.max(1, flatItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIdx];
      if (item) {
        const action = { type: item.type, target: item.target };
        if (item.date) action.date = item.date;
        onAction(action);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [flatItems, activeIdx, onAction, onClose]);

  // Handle backdrop click
  const handleBdClick = useCallback((e) => {
    if (e.target === bdRef.current) onClose();
  }, [onClose]);

  // Handle item click
  const handleItemClick = useCallback((item) => {
    const action = { type: item.type, target: item.target };
    if (item.date) action.date = item.date;
    onAction(action);
    onClose();
  }, [onAction, onClose]);

  if (!open) return null;

  // Assign flat indices to items
  let flatIdx = 0;

  return createPortal(
    <div
      ref={bdRef}
      onMouseDown={handleBdClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 9990,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        className="slide-up"
        style={{
          width: '100%',
          maxWidth: 580,
          background: T.panel,
          border: `1.5px solid ${T.border}`,
          borderRadius: 16,
          boxShadow: `0 24px 80px rgba(0,0,0,.5), 0 0 0 1px ${T.border}, 0 0 60px ${T.accent}08`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '60vh',
        }}
      >
        {/* Search Input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 18px',
          borderBottom: `1px solid ${T.border}`,
        }}>
          <Ic.IcSearch s={18} c={T.dim} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: T.text,
              fontSize: fs(15),
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 400,
              caretColor: T.accent,
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 22,
            padding: '0 6px',
            borderRadius: 5,
            background: T.bg2,
            border: `1px solid ${T.border}`,
            color: T.dim,
            fontSize: fs(10),
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 500,
          }}>
            esc
          </kbd>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 6px',
          }}
        >
          {flatItems.length === 0 && query && (
            <div style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: T.dim,
              fontSize: fs(13),
            }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {groupedItems.map(section => (
            <div key={section.name}>
              {/* Section Header */}
              <div style={{
                padding: '8px 12px 4px',
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: "'DM Sans', sans-serif",
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                color: T.dim,
              }}>
                {section.name}
              </div>

              {/* Section Items */}
              {section.items.map(item => {
                const idx = flatIdx++;
                const isActive = idx === activeIdx;
                const IconComp = Ic[item.icon] || Ic.IcTarget;
                const iconColor = item.color || T.soft;

                return (
                  <div
                    key={`${item.section}-${item.target}-${item.label}`}
                    data-idx={idx}
                    onClick={() => handleItemClick(item)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      background: isActive ? `${T.accent}12` : 'transparent',
                      transition: 'background .1s ease',
                    }}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: isActive ? `${iconColor}18` : `${T.faint}33`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'background .1s ease',
                    }}>
                      <IconComp s={15} c={isActive ? iconColor : T.soft} />
                    </div>

                    {/* Label + Meta */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: fs(13),
                        fontWeight: isActive ? 600 : 450,
                        color: isActive ? T.text : T.soft,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        transition: 'color .1s ease',
                      }}>
                        <HighlightText text={item.label} ranges={item.ranges} color={T.accent} />
                      </div>
                      {item.meta && (
                        <div style={{
                          fontSize: fs(11),
                          color: T.dim,
                          marginTop: 1,
                        }}>
                          {item.meta}
                        </div>
                      )}
                    </div>

                    {/* Category Label */}
                    <span style={{
                      fontSize: fs(10),
                      color: T.dim,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>
                      {item.section}
                    </span>

                    {/* Shortcut Badge */}
                    <ShortcutBadge shortcutKey={item.shortcutKey} T={T} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer — keyboard hints */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 18px',
          borderTop: `1px solid ${T.border}`,
          background: T.bg2,
        }}>
          {[
            { keys: ['\u2191', '\u2193'], label: 'navigate' },
            { keys: ['\u21A9'], label: 'select' },
            { keys: ['esc'], label: 'close' },
          ].map(hint => (
            <div key={hint.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {hint.keys.map(k => (
                <kbd key={k} style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 20,
                  height: 20,
                  padding: '0 4px',
                  borderRadius: 4,
                  background: T.panel,
                  border: `1px solid ${T.border}`,
                  color: T.dim,
                  fontSize: fs(10),
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 500,
                }}>
                  {k}
                </kbd>
              ))}
              <span style={{
                fontSize: fs(11),
                color: T.dim,
                fontWeight: 400,
              }}>
                {hint.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};

export { CommandPalette };
export default CommandPalette;
