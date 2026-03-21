// WidgetGrid — Configurable dashboard widget container with edit mode
import { useState } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { WIDGET_REGISTRY, DEFAULT_WIDGETS } from './index.js';
import { useBreakpoint } from '../../systems/breakpoint.js';

const WidgetGrid = ({ widgets, data, setData, setPage, setDate, Btn }) => {
  const T = useTheme();
  const bp = useBreakpoint();
  const [editMode, setEditMode] = useState(false);

  // Resolve active widget list (fall back to defaults)
  const activeIds = Array.isArray(widgets) && widgets.length > 0 ? widgets : DEFAULT_WIDGETS;

  // Available widgets not currently active
  const inactiveIds = Object.keys(WIDGET_REGISTRY).filter(id => !activeIds.includes(id));

  // Save widget configuration to data
  const saveWidgets = (newList) => {
    setData(prev => ({ ...prev, dashboardWidgets: newList }));
  };

  const removeWidget = (id) => {
    const next = activeIds.filter(w => w !== id);
    saveWidgets(next);
  };

  const addWidget = (id) => {
    const next = [...activeIds, id];
    saveWidgets(next);
  };

  const moveUp = (idx) => {
    if (idx === 0) return;
    const next = [...activeIds];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    saveWidgets(next);
  };

  const moveDown = (idx) => {
    if (idx >= activeIds.length - 1) return;
    const next = [...activeIds];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    saveWidgets(next);
  };

  const cols = bp.sm ? 1 : 2;

  return (
    <div>
      {/* Edit mode toggle */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', marginBottom: 12
      }}>
        <button
          onClick={() => setEditMode(!editMode)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
            fontSize: fs(11), fontWeight: 600,
            background: editMode ? T.accentD : T.input,
            color: editMode ? T.accent : T.soft,
            border: `1px solid ${editMode ? T.accent + '44' : T.border}`,
            transition: 'all .2s'
          }}
        >
          <Ic.IcGrid s={13} c={editMode ? T.accent : T.soft} />
          {editMode ? 'Done' : 'Customize'}
        </button>
      </div>

      {/* Widget grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 14,
        marginBottom: editMode ? 20 : 0
      }}>
        {activeIds.map((id, idx) => {
          const reg = WIDGET_REGISTRY[id];
          if (!reg) return null;
          const IconComp = Ic[reg.icon];
          const WidgetComp = reg.component;

          return (
            <div
              key={id}
              className="sf-card"
              style={{
                background: T.card,
                border: `1px solid ${editMode ? T.accent + '44' : T.border}`,
                borderRadius: 14,
                padding: 0,
                transition: 'all .2s, box-shadow .2s',
                position: 'relative'
              }}
              onMouseEnter={e => {
                if (!editMode) {
                  e.currentTarget.style.boxShadow = `0 4px 16px ${T.accent}11`;
                  e.currentTarget.style.borderColor = T.borderL;
                }
              }}
              onMouseLeave={e => {
                if (!editMode) {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.borderColor = T.border;
                }
              }}
            >
              {/* Header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 16px 0 16px'
              }}>
                {IconComp && <IconComp s={15} c={T.accent} />}
                <span style={{
                  flex: 1, fontSize: fs(13), fontWeight: 700, color: T.text,
                  fontFamily: "'Outfit',sans-serif"
                }}>
                  {reg.name}
                </span>

                {/* Edit mode controls */}
                {editMode && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      title="Move up"
                      style={{
                        background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer',
                        padding: 3, opacity: idx === 0 ? 0.3 : 1, display: 'flex'
                      }}
                    >
                      <Ic.ChevL s={13} />
                    </button>
                    <button
                      onClick={() => moveDown(idx)}
                      disabled={idx >= activeIds.length - 1}
                      title="Move down"
                      style={{
                        background: 'transparent', border: 'none',
                        cursor: idx >= activeIds.length - 1 ? 'default' : 'pointer',
                        padding: 3, opacity: idx >= activeIds.length - 1 ? 0.3 : 1, display: 'flex'
                      }}
                    >
                      <Ic.ChevR s={13} />
                    </button>
                    <button
                      onClick={() => removeWidget(id)}
                      title="Remove widget"
                      style={{
                        background: T.redD, border: 'none', borderRadius: 5,
                        cursor: 'pointer', padding: 3, marginLeft: 4, display: 'flex'
                      }}
                    >
                      <Ic.IcX s={12} c={T.red} />
                    </button>
                  </div>
                )}

                {/* Widget action button (View All for tasks) */}
                {!editMode && id === 'tasks' && (
                  <button
                    onClick={() => setPage('daily')}
                    style={{
                      background: T.accentD, border: `1px solid ${T.accent}44`, borderRadius: 6,
                      padding: '4px 10px', cursor: 'pointer', fontSize: fs(10),
                      color: T.accent, fontWeight: 600
                    }}
                  >
                    View All
                  </button>
                )}
                {!editMode && id === 'courses' && (
                  <button
                    onClick={() => setPage('courses')}
                    style={{
                      background: T.accentD, border: `1px solid ${T.accent}44`, borderRadius: 6,
                      padding: '4px 10px', cursor: 'pointer', fontSize: fs(10),
                      color: T.accent, fontWeight: 600
                    }}
                  >
                    Courses
                  </button>
                )}
                {!editMode && id === 'upcoming' && (
                  <button
                    onClick={() => setPage('daily')}
                    style={{
                      background: T.accentD, border: `1px solid ${T.accent}44`, borderRadius: 6,
                      padding: '4px 10px', cursor: 'pointer', fontSize: fs(10),
                      color: T.accent, fontWeight: 600
                    }}
                  >
                    Schedule
                  </button>
                )}
              </div>

              {/* Widget content */}
              <div style={{ padding: 16 }}>
                <WidgetComp
                  data={data}
                  setData={setData}
                  setPage={setPage}
                  setDate={setDate}
                  Btn={Btn}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Available widgets panel (edit mode only) */}
      {editMode && inactiveIds.length > 0 && (
        <div style={{
          background: T.card, border: `1px dashed ${T.border}`,
          borderRadius: 14, padding: 16
        }}>
          <div style={{
            fontSize: fs(12), fontWeight: 700, color: T.soft, marginBottom: 10,
            fontFamily: "'Outfit',sans-serif"
          }}>
            Available Widgets
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {inactiveIds.map(id => {
              const reg = WIDGET_REGISTRY[id];
              if (!reg) return null;
              const IconComp = Ic[reg.icon];
              return (
                <button
                  key={id}
                  onClick={() => addWidget(id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
                    background: T.input, border: `1px solid ${T.border}`,
                    fontSize: fs(11), color: T.text, fontWeight: 600,
                    transition: 'all .15s'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = T.accent;
                    e.currentTarget.style.background = T.accentD;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = T.border;
                    e.currentTarget.style.background = T.input;
                  }}
                >
                  {IconComp && <IconComp s={13} c={T.accent} />}
                  {reg.name}
                  <Ic.IcPlus s={12} c={T.accent} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Message when no widgets are active */}
      {editMode && activeIds.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '30px 20px', color: T.dim,
          fontSize: fs(12), background: T.card, border: `1px dashed ${T.border}`,
          borderRadius: 14, marginBottom: 14
        }}>
          No widgets active. Add some from the list below!
        </div>
      )}
    </div>
  );
};

export { WidgetGrid };
export default WidgetGrid;
