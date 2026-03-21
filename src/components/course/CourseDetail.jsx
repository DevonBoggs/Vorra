import { Fragment, useState } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import { safeArr } from '../../utils/toolExecution.js';

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

const allSectionIds = [
  'assessment', 'strategy', 'competencies', 'topics', 'terms',
  'officialRes', 'externalRes', 'examTips', 'mistakes', 'focus',
  'mnemonics', 'milestones', 'instructorTips', 'community', 'meta'
];

export const CourseDetail = ({ c }) => {
  const T = useTheme();
  const [openSections, setOpenSections] = useState({
    assessment: true,
    strategy: true,
    competencies: true,
    topics: true,
  });

  if (!c) return null;

  const SectionToggle = ({ id, title, icon, children, defaultOpen }) => {
    const isOpen = openSections[id] !== undefined ? openSections[id] : (defaultOpen || false);
    return (
      <div style={{ marginTop: 14 }}>
        <div
          onClick={() => setOpenSections(s => ({ ...s, [id]: !isOpen }))}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            cursor: 'pointer', padding: '4px 0', userSelect: 'none'
          }}
        >
          <div style={{ fontSize: fs(12), fontWeight: 700, color: T.soft, display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon && <span>{icon}</span>}
            {title}
          </div>
          <span style={{ fontSize: fs(10), color: T.dim, transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}>{'\u25BC'}</span>
        </div>
        {isOpen && <div style={{ marginTop: 6 }}>{children}</div>}
      </div>
    );
  };

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

  const lbl = { fontSize: fs(10), color: T.dim, fontWeight: 600 };
  const val = { fontSize: fs(11), color: T.text, marginBottom: 4 };

  return (
    <div style={{ padding: '8px 0' }}>

      {/* Expand All / Collapse All */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 4 }}>
        <button onClick={() => setOpenSections(Object.fromEntries(allSectionIds.map(id => [id, true])))} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: fs(9) }}>Expand All</button>
        <button onClick={() => setOpenSections({})} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: fs(9) }}>Collapse All</button>
      </div>

      {/* Assessment Details */}
      {(oaHasData || paHasData) && (
        <SectionToggle id="assessment" title="Assessment Details" icon={'\uD83D\uDCCB'} defaultOpen>
          {oaHasData && (
            <SubSection T={T}>
              <div style={{ fontSize: fs(10), fontWeight: 700, color: T.accent, marginBottom: 6 }}>
                Objective Assessment (OA)
              </div>
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
              <div style={{ fontSize: fs(10), fontWeight: 700, color: T.purple, marginBottom: 6 }}>
                Performance Assessment (PA)
              </div>
              {pa.taskDescription && <><div style={lbl}>Task</div><div style={val}>{pa.taskDescription}</div></>}
              {pa.rubricSummary && <><div style={lbl}>Rubric</div><div style={val}>{pa.rubricSummary}</div></>}
              {pa.submissionFormat && <><div style={lbl}>Format</div><div style={val}>{pa.submissionFormat}</div></>}
              {pa.evaluatorNotes && <><div style={lbl}>Notes</div><div style={val}>{pa.evaluatorNotes}</div></>}
            </SubSection>
          )}
        </SectionToggle>
      )}

      {/* Study Strategy */}
      {(c.studyStrategy || studyOrder.length > 0 || timeAlloc.length > 0 || quickWins.length > 0 || hardest.length > 0 || c.practiceTestNotes) && (
        <SectionToggle id="strategy" title="Study Strategy" icon={'\uD83C\uDFAF'} defaultOpen>
          {c.studyStrategy && (
            <SubSection T={T}>
              <div style={{ fontSize: fs(11), color: T.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {c.studyStrategy}
              </div>
            </SubSection>
          )}
          {studyOrder.length > 0 && (
            <SubSection T={T}>
              <div style={{ ...lbl, marginBottom: 4 }}>Recommended Study Order</div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {studyOrder.map((s, i) => (
                  <li key={i} style={{ fontSize: fs(11), color: T.text, lineHeight: 1.5, marginBottom: 2 }}>
                    {s}
                  </li>
                ))}
              </ol>
            </SubSection>
          )}
          {timeAlloc.length > 0 && (
            <SubSection T={T}>
              <div style={{ ...lbl, marginBottom: 6 }}>Time Allocation</div>
              {timeAlloc.map((t, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: fs(10), color: T.text }}>{t.topic}</span>
                    <span style={{ fontSize: fs(10), color: T.accent, fontWeight: 600 }}>{t.percentage}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: T.border, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(t.percentage, 100)}%`, height: '100%',
                      background: `linear-gradient(90deg, ${T.accent}, ${T.blue})`, borderRadius: 2
                    }} />
                  </div>
                </div>
              ))}
            </SubSection>
          )}
          {quickWins.length > 0 && (
            <SubSection T={T}>
              <div style={{ ...lbl, marginBottom: 4 }}>Quick Wins</div>
              <div>{quickWins.map((q, i) => <Chip key={i} T={T} text={q} color={T.accent} />)}</div>
            </SubSection>
          )}
          {hardest.length > 0 && (
            <SubSection T={T}>
              <div style={{ ...lbl, marginBottom: 4 }}>Hardest Concepts</div>
              <div>{hardest.map((h, i) => <Chip key={i} T={T} text={h} color={T.red} />)}</div>
            </SubSection>
          )}
          {c.practiceTestNotes && (
            <SubSection T={T}>
              <div style={{ ...lbl, marginBottom: 4 }}>Practice Test Notes</div>
              <div style={{ fontSize: fs(11), color: T.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {c.practiceTestNotes}
              </div>
            </SubSection>
          )}
        </SectionToggle>
      )}

      {/* Competencies */}
      {competencies.length > 0 && (
        <SectionToggle id="competencies" title="Competencies" icon={'\uD83C\uDFC6'} defaultOpen>
          <SubSection T={T}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Code', 'Title', 'Weight'].map(h => (
                    <th key={h} style={{
                      fontSize: fs(9), color: T.dim, fontWeight: 600, textAlign: 'left',
                      padding: '4px 8px', borderBottom: `1px solid ${T.border}`
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {competencies.map((comp, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: fs(10), color: T.accent, padding: '4px 8px', fontWeight: 600 }}>
                      {comp.code || '-'}
                    </td>
                    <td style={{ fontSize: fs(10), color: T.text, padding: '4px 8px' }}>
                      {comp.title || comp.description || '-'}
                    </td>
                    <td style={{ fontSize: fs(10), color: T.soft, padding: '4px 8px' }}>
                      {comp.weight || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SubSection>
        </SectionToggle>
      )}

      {/* Topic Breakdown */}
      {topics.length > 0 && (
        <SectionToggle id="topics" title="Topic Breakdown" icon={'\uD83D\uDCDA'} defaultOpen>
          {topics.map((t, i) => (
            <SubSection key={i} T={T}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: fs(11), fontWeight: 700, color: T.text }}>{t.topic}</span>
                {t.weight && <WeightBadge T={T} weight={t.weight} />}
              </div>
              {t.description && (
                <div style={{ fontSize: fs(10), color: T.soft, lineHeight: 1.4, marginBottom: 4 }}>
                  {t.description}
                </div>
              )}
              {safeArr(t.subtopics).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                  {t.subtopics.map((st, j) => (
                    <Chip key={j} T={T} text={st} color={T.blue} />
                  ))}
                </div>
              )}
            </SubSection>
          ))}
        </SectionToggle>
      )}

      {/* Key Terms */}
      {keyTerms.length > 0 && (
        <SectionToggle id="terms" title="Key Terms & Concepts" icon={'\uD83D\uDCD6'}>
          <SubSection T={T}>
            <div style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px'
            }}>
              {keyTerms.map((kt, i) => (
                <Fragment key={i}>
                  <div style={{ fontSize: fs(10), color: T.accent, fontWeight: 600 }}>{kt.term}</div>
                  <div style={{ fontSize: fs(10), color: T.text }}>{kt.definition}</div>
                </Fragment>
              ))}
            </div>
          </SubSection>
        </SectionToggle>
      )}

      {/* Official Resources */}
      {officialRes.length > 0 && (
        <SectionToggle id="officialRes" title="Official Resources" icon={'\uD83D\uDD17'}>
          {officialRes.map((r, i) => (
            <SubSection key={i} T={T}>
              <div style={{ fontSize: fs(11), fontWeight: 600, color: T.text }}>{r.title}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                {r.type && <span style={{ fontSize: fs(9), color: T.blue }}>{r.type}</span>}
                {r.provider && <span style={{ fontSize: fs(9), color: T.dim }}>{r.provider}</span>}
              </div>
              {r.notes && <div style={{ fontSize: fs(10), color: T.soft, marginTop: 3 }}>{r.notes}</div>}
            </SubSection>
          ))}
        </SectionToggle>
      )}

      {/* Recommended External */}
      {externalRes.length > 0 && (
        <SectionToggle id="externalRes" title="Recommended Resources" icon={'\uD83C\uDF10'}>
          {externalRes.map((r, i) => (
            <SubSection key={i} T={T}>
              <div style={{ fontSize: fs(11), fontWeight: 600, color: T.text }}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: T.blue, textDecoration: 'none' }}
                    onMouseOver={e => e.target.style.textDecoration = 'underline'}
                    onMouseOut={e => e.target.style.textDecoration = 'none'}>
                    {r.title}
                  </a>
                ) : r.title}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                {r.type && <span style={{ fontSize: fs(9), color: T.purple }}>{r.type}</span>}
              </div>
              {r.notes && <div style={{ fontSize: fs(10), color: T.soft, marginTop: 3 }}>{r.notes}</div>}
            </SubSection>
          ))}
        </SectionToggle>
      )}

      {/* Exam Tips */}
      {examTips.length > 0 && (
        <SectionToggle id="examTips" title="Exam Tips" icon={'\uD83D\uDCA1'}>
          <SubSection T={T}>
            <BulletList T={T} items={examTips} />
          </SubSection>
        </SectionToggle>
      )}

      {/* Common Mistakes */}
      {commonMistakes.length > 0 && (
        <SectionToggle id="mistakes" title="Common Mistakes" icon={'\u26A0\uFE0F'}>
          <SubSection T={T}>
            <BulletList T={T} items={commonMistakes} />
          </SubSection>
        </SectionToggle>
      )}

      {/* Known Focus Areas */}
      {focusAreas.length > 0 && (
        <SectionToggle id="focus" title="Known Focus Areas" icon={'\uD83C\uDFAF'}>
          <SubSection T={T}>
            <div>{focusAreas.map((f, i) => <Chip key={i} T={T} text={f} color={T.orange} />)}</div>
          </SubSection>
        </SectionToggle>
      )}

      {/* Mnemonics */}
      {mnemonics.length > 0 && (
        <SectionToggle id="mnemonics" title="Mnemonics & Memory Aids" icon={'\uD83E\uDDE0'}>
          {mnemonics.map((m, i) => (
            <SubSection key={i} T={T}>
              <div style={{ fontSize: fs(10), color: T.purple, fontWeight: 600 }}>{m.concept}</div>
              <div style={{ fontSize: fs(11), color: T.text, marginTop: 2 }}>{m.mnemonic}</div>
            </SubSection>
          ))}
        </SectionToggle>
      )}

      {/* Weekly Milestones */}
      {milestones.length > 0 && (
        <SectionToggle id="milestones" title="Weekly Milestones" icon={'\uD83D\uDCC5'}>
          {milestones.map((m, i) => (
            <SubSection key={i} T={T}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: fs(10), fontWeight: 700, color: T.accent }}>Week {m.week}</span>
                <span style={{ fontSize: fs(11), color: T.text }}>{m.goals}</span>
              </div>
            </SubSection>
          ))}
        </SectionToggle>
      )}

      {/* Instructor Tips */}
      {instructorTips.length > 0 && (
        <SectionToggle id="instructorTips" title="Instructor Tips" icon={'\uD83D\uDC68\u200D\uD83C\uDFEB'}>
          <SubSection T={T}>
            <BulletList T={T} items={instructorTips} />
          </SubSection>
        </SectionToggle>
      )}

      {/* Community Insights */}
      {communityInsights.length > 0 && (
        <SectionToggle id="community" title="Community Insights" icon={'\uD83D\uDCAC'}>
          <SubSection T={T}>
            <BulletList T={T} items={communityInsights} />
          </SubSection>
        </SectionToggle>
      )}

      {/* Meta */}
      {(c.passRate || c.averageStudyHours > 0 || c.reportedDifficulty || c.certAligned || prereqs.length > 0 || related.length > 0 || c.lastUpdated || c.versionInfo) && (
        <SectionToggle id="meta" title="Course Metadata" icon={'\u2139\uFE0F'}>
          <SubSection T={T}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
              {c.passRate && (
                <>
                  <div style={lbl}>Pass Rate</div>
                  <div style={val}>{c.passRate}</div>
                </>
              )}
              {c.averageStudyHours > 0 && (
                <>
                  <div style={lbl}>Avg Study Hours</div>
                  <div style={val}>{c.averageStudyHours}</div>
                </>
              )}
              {c.reportedDifficulty > 0 && (
                <>
                  <div style={lbl}>Reported Difficulty</div>
                  <div style={val}>{c.reportedDifficulty}/5</div>
                </>
              )}
              {c.certAligned && (
                <>
                  <div style={lbl}>Cert Aligned</div>
                  <div style={val}>{c.certAligned}</div>
                </>
              )}
              {prereqs.length > 0 && (
                <>
                  <div style={lbl}>Prerequisites</div>
                  <div style={val}>{prereqs.join(', ')}</div>
                </>
              )}
              {related.length > 0 && (
                <>
                  <div style={lbl}>Related Courses</div>
                  <div style={val}>{related.join(', ')}</div>
                </>
              )}
              {c.lastUpdated && (
                <>
                  <div style={lbl}>Last Updated</div>
                  <div style={val}>{c.lastUpdated}</div>
                </>
              )}
              {c.versionInfo && (
                <>
                  <div style={lbl}>Version</div>
                  <div style={val}>{c.versionInfo}</div>
                </>
              )}
            </div>
          </SubSection>
        </SectionToggle>
      )}
    </div>
  );
};

export default CourseDetail;
