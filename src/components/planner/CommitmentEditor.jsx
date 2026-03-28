// CommitmentEditor — manage recurring time blocks (work, gym, family, etc.)
import { useState, useEffect } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import { Btn } from '../ui/Btn.jsx';
import { Label } from '../ui/Label.jsx';
import { uid } from '../../utils/helpers.js';
import { DAY_NAMES } from '../../utils/availabilityCalc.js';

const CATEGORIES = [
  { value: 'work', label: 'Work', icon: '\uD83D\uDCBC', color: '#4ea8de' },
  { value: 'family', label: 'Family', icon: '\uD83D\uDC68\u200D\uD83D\uDC67', color: '#e88bb3' },
  { value: 'health', label: 'Health/Gym', icon: '\uD83C\uDFCB', color: '#4ecdc4' },
  { value: 'commute', label: 'Commute', icon: '\uD83D\uDE97', color: '#f7b731' },
  { value: 'sleep', label: 'Sleep', icon: '\uD83C\uDF19', color: '#7c6fea' },
  { value: 'other', label: 'Other', icon: '\uD83D\uDCCC', color: '#a0a0a0' },
];

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun

const PRESETS = [
  { label: '9-5 Work (M-F)', commitment: { label: 'Work', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', category: 'work' } },
  { label: 'Gym (MWF morning)', commitment: { label: 'Gym', days: [1, 3, 5], start: '06:00', end: '07:00', category: 'health' } },
  { label: 'Kids Pickup (M-F)', commitment: { label: 'Kids pickup', days: [1, 2, 3, 4, 5], start: '15:00', end: '16:00', category: 'family' } },
  { label: 'Evening Commute (M-F)', commitment: { label: 'Commute', days: [1, 2, 3, 4, 5], start: '17:00', end: '18:00', category: 'commute' } },
];

export const CommitmentEditor = ({ commitments = [], onUpdate, prefill = null, autoEditId = null, onAutoEditDone = null }) => {
  const T = useTheme();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ label: '', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', category: 'work' });

  // Auto-open edit form for a specific commitment (from right-click "Edit commitment")
  useEffect(() => {
    if (autoEditId) {
      const c = commitments.find(cm => cm.id === autoEditId);
      if (c) {
        setForm({ label: c.label, days: [...c.days], start: c.start, end: c.end, category: c.category || 'other' });
        setEditId(c.id);
        setShowAdd(true);
      }
      if (onAutoEditDone) onAutoEditDone();
    }
  }, [autoEditId]);

  // Apply prefill from context menu
  useEffect(() => {
    if (prefill) {
      setForm(f => ({
        ...f,
        label: '',
        days: prefill.days || f.days,
        start: prefill.start || f.start,
        end: prefill.end || f.end,
        category: 'other',
      }));
      setEditId(null);
      setShowAdd(true);
    }
  }, [prefill]);

  const openAdd = () => {
    setForm({ label: '', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', category: 'work' });
    setEditId(null);
    setShowAdd(true);
  };

  const openEdit = (c) => {
    setForm({ label: c.label, days: [...c.days], start: c.start, end: c.end, category: c.category || 'other' });
    setEditId(c.id);
    setShowAdd(true);
  };

  // Live update: when editing an existing commitment, push changes immediately
  const updateForm = (updates) => {
    const next = { ...form, ...updates };
    setForm(next);
    // If editing an existing commitment, apply changes live
    if (editId && next.label.trim() && next.days.length > 0) {
      onUpdate(commitments.map(c => c.id === editId ? { ...c, ...next } : c));
    }
  };

  const save = () => {
    if (!form.label.trim() || form.days.length === 0) return;
    if (editId) {
      // Already applied live — just close the form
    } else {
      onUpdate([...commitments, { ...form, id: uid() }]);
    }
    setShowAdd(false);
    setEditId(null);
  };

  const remove = (id) => {
    onUpdate(commitments.filter(c => c.id !== id));
  };

  const addPreset = (preset) => {
    onUpdate([...commitments, { ...preset, id: uid() }]);
  };

  const toggleDay = (d) => {
    const newDays = form.days.includes(d) ? form.days.filter(x => x !== d) : [...form.days, d].sort((a, b) => a - b);
    updateForm({ days: newDays });
  };

  const getCategoryInfo = (cat) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[4];

  return (
    <div>
      {/* Existing commitments */}
      {commitments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {commitments.map(c => {
            const cat = getCategoryInfo(c.category);
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: T.input, borderRadius: 8, border: `1px solid ${cat.color}22`,
              }}>
                <span style={{ fontSize: fs(12) }}>{cat.icon}</span>
                <span style={{ fontSize: fs(11), fontWeight: 600, color: T.text, flex: 1 }}>{c.label}</span>
                <span style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace" }}>
                  {c.start}-{c.end}
                </span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {DAY_ORDER.map(d => (
                    <span key={d} style={{
                      fontSize: fs(8), fontWeight: 700, width: 16, height: 16, borderRadius: 3,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: c.days?.includes(d) ? cat.color + '33' : 'transparent',
                      color: c.days?.includes(d) ? cat.color : T.faint,
                    }}>{DAY_NAMES[d][0]}</span>
                  ))}
                </div>
                <button onClick={() => openEdit(c)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: 2, fontSize: fs(10) }}>{'\u270E'}</button>
                <button onClick={() => remove(c.id)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: 2, fontSize: fs(12) }}>{'\u00D7'}</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick presets */}
      {!showAdd && (() => {
        const available = PRESETS.filter(p => !commitments.some(c => c.label.toLowerCase() === p.commitment.label.toLowerCase()));
        return available.length > 0 ? (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: fs(10), color: T.dim, marginBottom: 6 }}>Quick add:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {available.map((p, i) => (
                <button key={i} onClick={() => addPreset(p.commitment)}
                  style={{
                    padding: '5px 12px', borderRadius: 7, border: `1px solid ${T.border}`,
                    background: T.input, color: T.soft, fontSize: fs(10), fontWeight: 500,
                    cursor: 'pointer', transition: 'all .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent + '66'; e.currentTarget.style.color = T.text; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.soft; }}
                >{p.label}</button>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* Add/Edit form */}
      {showAdd ? (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, marginBottom: 10 }}>
            {editId ? 'Edit Commitment' : 'Add Commitment'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 10 }}>
            <div>
              <Label>Name</Label>
              <input value={form.label} onChange={e => updateForm({ label: e.target.value })}
                placeholder="e.g. Day job, Gym, Kids pickup..."
                style={{ width: '100%', padding: '6px 10px', fontSize: fs(11) }} />
            </div>
            <div>
              <Label>Category</Label>
              <div style={{ display: 'flex', gap: 4 }}>
                {CATEGORIES.map(cat => (
                  <button key={cat.value} onClick={() => updateForm({ category: cat.value })}
                    title={cat.label}
                    style={{
                      width: 28, height: 28, borderRadius: 6, border: `1.5px solid ${form.category === cat.value ? cat.color : T.border}`,
                      background: form.category === cat.value ? cat.color + '22' : T.input,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: fs(12), transition: 'all .15s',
                    }}>{cat.icon}</button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-end' }}>
            <div>
              <Label>Start Time</Label>
              <input type="time" value={form.start} onChange={e => updateForm({ start: e.target.value })}
                aria-label="Start time" style={{ padding: '6px 8px', fontSize: fs(11) }} />
            </div>
            <div>
              <Label>End Time</Label>
              <input type="time" value={form.end} onChange={e => updateForm({ end: e.target.value })}
                aria-label="End time" style={{ padding: '6px 8px', fontSize: fs(11) }} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <Label>Days</Label>
            <div style={{ display: 'flex', gap: 4 }}>
              {DAY_ORDER.map(d => (
                <button key={d} onClick={() => toggleDay(d)}
                  style={{
                    padding: '5px 10px', borderRadius: 6, border: `1.5px solid ${form.days.includes(d) ? T.accent : T.border}`,
                    background: form.days.includes(d) ? T.accentD : T.input,
                    color: form.days.includes(d) ? T.accent : T.dim,
                    fontSize: fs(10), fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                  }}>{DAY_NAMES[d]}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => updateForm({ days: [1, 2, 3, 4, 5] })}
                style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: fs(9), textDecoration: 'underline' }}>Weekdays</button>
              <button onClick={() => updateForm({ days: [0, 6] })}
                style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: fs(9), textDecoration: 'underline' }}>Weekends</button>
              <button onClick={() => updateForm({ days: [0, 1, 2, 3, 4, 5, 6] })}
                style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: fs(9), textDecoration: 'underline' }}>Every day</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn small v="ghost" onClick={() => { setShowAdd(false); setEditId(null); }}>{editId ? 'Done' : 'Cancel'}</Btn>
            {!editId && <Btn small onClick={save} disabled={!form.label.trim() || form.days.length === 0}>
              Add
            </Btn>}
          </div>
        </div>
      ) : (
        <Btn small v="ghost" onClick={openAdd}>+ Add Commitment</Btn>
      )}
    </div>
  );
};

export default CommitmentEditor;
