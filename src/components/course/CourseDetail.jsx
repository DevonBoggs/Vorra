import { Fragment, useState } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import { safeArr } from '../../utils/toolExecution.js';
import { SECTIONS, getSectionHasData, getSectionCounts } from '../../utils/courseHelpers.js';

const SubSection = ({ T, children, style }) => (
  <div style={{
    background: T.input, borderRadius: 10, padding: '10px 12px',
    marginBottom: 8, ...style
  }}>
    {children}
  </div>
);

const Chip = ({ T, text, color }) => (
  <span style={{
    fontSize: fs(10), color: color || T.text, fontWeight: 600,
    background: (color || T.accent) + '18', borderRadius: 6,
    padding: '2px 8px', display: 'inline-block', marginRight: 4, marginBottom: 4
  }}>
    {text}
  </span>
);

const WeightBadge = ({ T, weight }) => {
  const colors = { high: T.red, medium: T.yellow, low: T.accent };
  const c = colors[weight] || T.soft;
  return (
    <span style={{
      fontSize: fs(9), fontWeight: 700, color: c,
      background: c + '18', borderRadius: 5, padding: '1px 6px',
      marginLeft: 6, textTransform: 'uppercase'
    }}>
      {weight}
    </span>
  );
};

const BulletList = ({ T, items }) => (
  <ul style={{ margin: 0, paddingLeft: 18 }}>
    {items.map((item, i) => (
      <li key={i} style={{ fontSize: fs(11), color: T.text, lineHeight: 1.5, marginBottom: 2 }}>
        {item}
      </li>
    ))}
  </ul>
);

export const CourseDetail = ({ c, onGenerate }) => {
  const T = useTheme();

  if (!c) return null;

  const hasOA = c.assessmentType && (c.assessmentType.includes('OA') || c.assessmentType === 'Exam');
  const hasPA = c.assessmentType && (c.assessmentType.includes('PA') || c.assessmentType === 'Project');
  const oa = c.oaDetails || {};
  const pa = c.paDetails || {};
  const oaHasData = hasOA && Object.values(oa).some(v => v);
  const paHasData = hasPA && Object.values(pa).some(v => v);

  const competencies = safeArr(c.competencies);
  const topics = safeArr(c.topicBreakdown);
  const keyTerms = safeArr(c.keyTermsAndConcepts);
  const officialRes = safeArr(c.officialResources);
  const externalRes = safeArr(c.recommendedExternal);
  const examTips = safeArr(c.examTips);
  const commonMistakes = safeArr(c.commonMistakes);
  const focusAreas = safeArr(c.knownFocusAreas);
  const mnemonics = safeArr(c.mnemonics);
  const milestones = safeArr(c.weeklyMilestones);
  const instructorTips = safeArr(c.instructorTips);
  const communityInsights = safeArr(c.communityInsights);
  const studyOrder = safeArr(c.studyOrder);
  const timeAlloc = safeArr(c.timeAllocation);
  const quickWins = safeArr(c.quickWins);
  const hardest = safeArr(c.hardestConcepts);
  const prereqs = safeArr(c.prerequisites);
  const related = safeArr(c.relatedCourses);

  // Use shared helper for section data checks
  const sectionHasData = getSectionHasData(c);
  const sectionCounts = getSectionCounts(c);

  const populatedSections = SECTIONS.filter(s => sectionHasData[s.id]);
  const [activeSection, setActiveSection] = useState(() => populatedSections[0]?.id || SECTIONS[0].id);

  // Guard: fall back to first populated section, or first section if none populated
  const resolvedSection = SECTIONS.find(s => s.id === activeSection)
    ? activeSection
    : populatedSections[0]?.id || SECTIONS[0].id;

  const lbl = { fontSize: fs(10), color: T.dim, fontWeight: 600 };
  const val = { fontSize: fs(11), color: T.text, marginBottom: 4 };

  // Section content renderer
  const renderSection = (id) => {
    switch (id) {
      case 'assessment':
        return <>
          {oaHasData && (
            <SubSection T={T}>
              <div style={{ fontSize: fs(10), fontWeight: 700, color: T.accent, marginBottom: 6 }}>Objective Assessment (OA)</div>
              {oa.format && <><div style={lbl}>Format</div><div style={val}>{oa.format}</div></>}
              {oa.questionCount > 0 && <><div style={lbl}>Questions</div><div style={val}>{oa.questionCount}</div></>}
              {oa.passingScore && <><div style={lbl}>Passing Score</div><div style={val}>{oa.passingScore}</div></>}
              {oa.timeLimit && <><div style={lbl}>Time Limit</div><div style={val}>{oa.timeLimit}</div></>}
              {oa.proctoringTool && <><div style={lbl}>Proctoring</div><div style={val}>{oa.proctoringTool}</div></>}
              {oa.retakePolicy && <><div style={lbl}>Retake Policy</div><div style={val}>{oa.retakePolicy}</div></>}
            </SubSection>
          )}
          {paHasData && (
            <SubSection T={T}>
              <div style={{ fontSize: fs(10), fontWeight: 700, color: T.purple, marginBottom: 6 }}>Performance Assessment (PA)</div>
              {pa.taskDescription && <><div style={lbl}>Task</div><div style={val}>{pa.taskDescription}</div></>}
              {pa.rubricSummary && <><div style={lbl}>Rubric</div><div style={val}>{pa.rubricSummary}</div></>}
              {pa.submissionFormat && <><div style={lbl}>Format</div><div style={val}>{pa.submissionFormat}</div></>}
              {pa.evaluatorNotes && <><div style={lbl}>Notes</div><div style={val}>{pa.evaluatorNotes}</div></>}
            </SubSection>
          )}
        </>;
      case 'strategy':
        return <>
          {c.studyStrategy && <SubSection T={T}><div style={{ fontSize: fs(11), color: T.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.studyStrategy}</div></SubSection>}
          {studyOrder.length > 0 && <SubSection T={T}><div style={{ ...lbl, marginBottom: 4 }}>Recommended Study Order</div><ol style={{ margin: 0, paddingLeft: 18 }}>{studyOrder.map((s, i) => <li key={i} style={{ fontSize: fs(11), color: T.text, lineHeight: 1.5, marginBottom: 2 }}>{s}</li>)}</ol></SubSection>}
          {timeAlloc.length > 0 && <SubSection T={T}><div style={{ ...lbl, marginBottom: 6 }}>Time Allocation</div>{timeAlloc.map((t, i) => <div key={i} style={{ marginBottom: 4 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}><span style={{ fontSize: fs(10), color: T.text }}>{t.topic}</span><span style={{ fontSize: fs(10), color: T.accent, fontWeight: 600 }}>{t.percentage}%</span></div><div style={{ height: 4, borderRadius: 2, background: T.border, overflow: 'hidden' }}><div style={{ width: `${Math.min(t.percentage, 100)}%`, height: '100%', background: `linear-gradient(90deg, ${T.accent}, ${T.blue})`, borderRadius: 2 }} /></div></div>)}</SubSection>}
          {quickWins.length > 0 && <SubSection T={T}><div style={{ ...lbl, marginBottom: 4 }}>Quick Wins</div><div>{quickWins.map((q, i) => <Chip key={i} T={T} text={q} color={T.accent} />)}</div></SubSection>}
          {hardest.length > 0 && <SubSection T={T}><div style={{ ...lbl, marginBottom: 4 }}>Hardest Concepts</div><div>{hardest.map((h, i) => <Chip key={i} T={T} text={h} color={T.red} />)}</div></SubSection>}
          {c.practiceTestNotes && <SubSection T={T}><div style={{ ...lbl, marginBottom: 4 }}>Practice Test Notes</div><div style={{ fontSize: fs(11), color: T.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.practiceTestNotes}</div></SubSection>}
        </>;
      case 'competencies':
        return <SubSection T={T}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Code', 'Title', 'Weight'].map(h => <th key={h} style={{ fontSize: fs(9), color: T.dim, fontWeight: 600, textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
            <tbody>{competencies.map((comp, i) => <tr key={i}><td style={{ fontSize: fs(10), color: T.accent, padding: '4px 8px', fontWeight: 600 }}>{comp.code || '-'}</td><td style={{ fontSize: fs(10), color: T.text, padding: '4px 8px' }}>{comp.title || comp.description || '-'}</td><td style={{ fontSize: fs(10), color: T.soft, padding: '4px 8px' }}>{comp.weight || '-'}</td></tr>)}</tbody>
          </table>
        </SubSection>;
      case 'topics':
        return <>{topics.map((t, i) => <SubSection key={i} T={T}><div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}><span style={{ fontSize: fs(11), fontWeight: 700, color: T.text }}>{t.topic}</span>{t.weight && <WeightBadge T={T} weight={t.weight} />}</div>{t.description && <div style={{ fontSize: fs(10), color: T.soft, lineHeight: 1.4, marginBottom: 4 }}>{t.description}</div>}{safeArr(t.subtopics).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>{t.subtopics.map((st, j) => <Chip key={j} T={T} text={st} color={T.blue} />)}</div>}</SubSection>)}</>;
      case 'terms':
        return <SubSection T={T}><div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>{keyTerms.map((kt, i) => <Fragment key={i}><div style={{ fontSize: fs(10), color: T.accent, fontWeight: 600 }}>{kt.term}</div><div style={{ fontSize: fs(10), color: T.text }}>{kt.definition}</div></Fragment>)}</div></SubSection>;
      case 'resources':
        return <>
          {officialRes.length > 0 && <><div style={{ fontSize: fs(10), fontWeight: 700, color: T.soft, marginBottom: 6 }}>Official</div>{officialRes.map((r, i) => <SubSection key={'o' + i} T={T}><div style={{ fontSize: fs(11), fontWeight: 600, color: T.text }}>{r.title}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>{r.type && <span style={{ fontSize: fs(9), color: T.blue }}>{r.type}</span>}{r.provider && <span style={{ fontSize: fs(9), color: T.dim }}>{r.provider}</span>}</div>{r.notes && <div style={{ fontSize: fs(10), color: T.soft, marginTop: 3 }}>{r.notes}</div>}</SubSection>)}</>}
          {externalRes.length > 0 && <><div style={{ fontSize: fs(10), fontWeight: 700, color: T.soft, marginBottom: 6, marginTop: officialRes.length > 0 ? 8 : 0 }}>Recommended</div>{externalRes.map((r, i) => <SubSection key={'e' + i} T={T}><div style={{ fontSize: fs(11), fontWeight: 600, color: T.text }}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: T.blue, textDecoration: 'none' }}>{r.title}</a> : r.title}</div>{r.type && <span style={{ fontSize: fs(9), color: T.purple }}>{r.type}</span>}{r.notes && <div style={{ fontSize: fs(10), color: T.soft, marginTop: 3 }}>{r.notes}</div>}</SubSection>)}</>}
        </>;
      case 'examTips':
        return <SubSection T={T}><BulletList T={T} items={examTips} /></SubSection>;
      case 'mistakes':
        return <SubSection T={T}><BulletList T={T} items={commonMistakes} /></SubSection>;
      case 'focus':
        return <SubSection T={T}><div>{focusAreas.map((f, i) => <Chip key={i} T={T} text={f} color={T.orange} />)}</div></SubSection>;
      case 'mnemonics':
        return <>{mnemonics.map((m, i) => <SubSection key={i} T={T}><div style={{ fontSize: fs(10), color: T.purple, fontWeight: 600 }}>{m.concept}</div><div style={{ fontSize: fs(11), color: T.text, marginTop: 2 }}>{m.mnemonic}</div></SubSection>)}</>;
      case 'milestones':
        return <>{milestones.map((m, i) => <SubSection key={i} T={T}><div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span style={{ fontSize: fs(10), fontWeight: 700, color: T.accent }}>Week {m.week}</span><span style={{ fontSize: fs(11), color: T.text }}>{m.goals}</span></div></SubSection>)}</>;
      case 'instructorTips':
        return <SubSection T={T}><BulletList T={T} items={instructorTips} /></SubSection>;
      case 'community':
        return <SubSection T={T}><BulletList T={T} items={communityInsights} /></SubSection>;
      case 'meta':
        return <SubSection T={T}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
            {c.passRate && <><div style={lbl}>Pass Rate</div><div style={val}>{c.passRate}</div></>}
            {c.averageStudyHours > 0 && <><div style={lbl}>Avg Study Hours</div><div style={val}>{c.averageStudyHours}</div></>}
            {c.reportedDifficulty > 0 && <><div style={lbl}>Reported Difficulty</div><div style={val}>{c.reportedDifficulty}/5</div></>}
            {c.certAligned && <><div style={lbl}>Cert Aligned</div><div style={val}>{c.certAligned}</div></>}
            {prereqs.length > 0 && <><div style={lbl}>Prerequisites</div><div style={val}>{prereqs.join(', ')}</div></>}
            {related.length > 0 && <><div style={lbl}>Related Courses</div><div style={val}>{related.join(', ')}</div></>}
            {c.lastUpdated && <><div style={lbl}>Last Updated</div><div style={val}>{c.lastUpdated}</div></>}
            {c.versionInfo && <><div style={lbl}>Version</div><div style={val}>{c.versionInfo}</div></>}
          </div>
        </SubSection>;
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Section summary */}
      <div style={{ fontSize: fs(9), color: T.dim, marginBottom: 6 }}>
        {populatedSections.length}/{SECTIONS.length} sections populated
      </div>

      {/* Section pill buttons — all 14 shown, empty ones dashed/dim */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingBottom: 14 }}>
        {SECTIONS.map(s => {
          const hasData = sectionHasData[s.id];
          const isActive = resolvedSection === s.id;
          const count = sectionCounts[s.id];
          return (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              style={{
                padding: '6px 14px', borderRadius: 999,
                border: hasData
                  ? `1px solid ${isActive ? T.accent + '44' : T.border}`
                  : `1px dashed ${T.border}`,
                background: isActive && hasData ? T.accentD : 'transparent',
                color: isActive && hasData ? T.accent : hasData ? T.soft : T.faint,
                fontSize: fs(11), fontWeight: isActive && hasData ? 600 : 500,
                cursor: hasData ? 'pointer' : 'pointer',
                transition: 'all .15s ease',
                display: 'flex', alignItems: 'center', gap: 5,
                lineHeight: 1, whiteSpace: 'nowrap',
                opacity: hasData ? 1 : 0.55,
              }}
              onMouseEnter={e => {
                if (hasData && !isActive) {
                  e.currentTarget.style.background = (T.borderL || T.border) + '44';
                  e.currentTarget.style.color = T.text;
                  e.currentTarget.style.borderColor = T.borderL || T.border;
                } else if (!hasData) {
                  e.currentTarget.style.opacity = '0.8';
                  e.currentTarget.style.borderColor = T.purple + '66';
                }
              }}
              onMouseLeave={e => {
                if (hasData && !isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = T.soft;
                  e.currentTarget.style.borderColor = T.border;
                } else if (!hasData) {
                  e.currentTarget.style.opacity = '0.55';
                  e.currentTarget.style.borderColor = T.border;
                }
              }}
            >
              <span style={{ fontSize: fs(12) }}>{s.icon}</span>
              {s.label}
              {hasData && count > 1 && (
                <span style={{
                  fontSize: fs(9), fontWeight: 600,
                  color: isActive ? T.accent : T.dim,
                  background: isActive ? T.accent + '18' : T.border + '88',
                  borderRadius: 999, padding: '1px 6px', marginLeft: 1,
                  lineHeight: '1.3', minWidth: 16, textAlign: 'center',
                }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: T.border, marginBottom: 14, opacity: 0.6 }} />

      {/* Active section content */}
      <div className="fade" key={resolvedSection}>
        {sectionHasData[resolvedSection]
          ? <>
              {renderSection(resolvedSection)}
              <div style={{ fontSize: fs(10), color: T.dim, fontStyle: 'italic', padding: '8px 0 0', borderTop: `1px solid ${T.border}44`, marginTop: 12 }}>
                Course data generated by AI {'\u2014'} verify details against your syllabus and student portal.
              </div>
            </>
          : (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <div style={{ fontSize: fs(12), color: T.dim, marginBottom: 10 }}>
                No {SECTIONS.find(s => s.id === resolvedSection)?.label || 'section'} data yet.
              </div>
              {onGenerate && (
                <button
                  onClick={() => onGenerate([resolvedSection])}
                  style={{
                    padding: '8px 18px', borderRadius: 999,
                    border: `1px solid ${T.purple}44`,
                    background: T.purpleD, color: T.purple,
                    fontSize: fs(11), fontWeight: 600,
                    cursor: 'pointer', transition: 'all .15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = T.purple + '28'; e.currentTarget.style.borderColor = T.purple; }}
                  onMouseLeave={e => { e.currentTarget.style.background = T.purpleD; e.currentTarget.style.borderColor = T.purple + '44'; }}
                >
                  Generate {SECTIONS.find(s => s.id === resolvedSection)?.label}
                </button>
              )}
            </div>
          )
        }
      </div>
    </div>
  );
};

export default CourseDetail;
