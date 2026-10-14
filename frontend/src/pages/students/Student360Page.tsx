import { useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import { useApiMutation, useApiQuery, useInvalidate, usePagedQuery } from '@/hooks/useApi';
import {
  AiNotice, Avatar, Badge, Banner, Button, Card, Chart, charts, DataTable, Dl, Empty, ErrorState, Grid, Icon, Kpi, Legend, Meter,
  Modal, Page, PageSkeleton, Ring, Risk, SearchInput, SelectField, Status, Stepper, Tabs, TextArea, TextField, Timeline, StudentLink,
  useToast,
} from '@/components/ui';
import { TrackingPanel } from '@/components/tracking/TrackingPanel';
import { fmt, todayKey } from '@/lib/format';
import type { StudentRow } from '@/api/types';
import { StudentFormModal } from './StudentFormModal';
import { TrendCell, TODAY_LABEL, toneForToday } from './StudentsPage';

export interface Profile {
  student: {
    id: string; admissionNo: string; fullName: string; firstName: string; lastName: string; photoUrl: string | null; dateOfBirth: string;
    gender: string; bloodGroup: string | null; campusId: string; campusName: string; campusShort: string; sectionId: string | null;
    grade: string | null; gradeLevel: number | null; stage: string | null; section: string | null; room: string | null; rollNo: number | null;
    academicYear: string | null; house: string | null; address: string | null; city: string | null; pincode: string | null;
    email: string | null; phone: string | null; admittedOn: string | null; status: string; risk: string; classTeacher: string | null;
    counsellor: string | null; attendance: number | null; average: number | null; trend: number; feeStatus: string | null; today: string;
  };
  guardians: { id: string; parentCode: string; fullName: string; relationship: string; isPrimary: boolean; canPickup: boolean; phone: string | null; email: string | null; occupation: string | null }[];
  attendance: {
    months: { label: string; value: number }[];
    totals: { marked: number; present: number; late: number; absent: number; leave: number } | null;
    recent: { date: string; status: string; arrivalTime: string | null; remarks: string | null }[];
  };
  academics: {
    subjects: { name: string; score: number; grade: string; target: number | null; trend: number | null; teacher: string | null }[];
    termTrend: { label: string; value: number }[];
    assessments: { code: string; name: string; subject: string; heldOn: string; maxMarks: number; marks: number | null; grade: string | null; isAbsent: boolean; pct: number | null }[];
  };
  skills: { name: string; value: number; confidence: string | null; evidence: string[] }[];
  interests: string[];
  activities: { name: string; category: string; role: string; since: string; hours: number; status: string }[];
  achievements: { id: string; title: string; type: string; level: string | null; date: string; verified: boolean }[];
  behaviour: { id: string; date: string; type: string; note: string; by: string | null }[];
  observations?: { id: string; date: string; text: string; by: string; role: string }[];
  interventions?: { id: string; code: string; signal: string; signalType: string; stage: number; opened: string; action: string | null; next: string | null; decision: string | null; closedAt: string | null; owner: string | null }[];
  documents: { id: string; name: string; category: string; status: string; requestedOn: string | null; verifiedAt: string | null; createdAt: string; hasFile: boolean }[];
  innovationProjects: { id: string; code: string; title: string; stage: number; status: string; mentor: string | null; milestones: number; done: number }[];
  transport: {
    routeId: string; routeCode: string; routeName: string; area: string; runStatus: string; delayMinutes: number; eta: string | null; busNo: string | null;
    registrationNo: string | null; driver: string | null; attendant: string | null; stopName: string | null; pickupTime: string | null; dropTime: string | null;
  } | null;
  timeline: { date: string; title: string; body: string | null; category: string; tone: string }[];
  talent: { strengths: { name: string; score: number; confidence: string | null; evidence: string[] }[] };
  wellbeing: {
    checkins?: { date: string; mood: string; notes: string | null; by: string | null }[];
    infirmaryVisits?: number;
    counsellingSessions?: number;
    medicalNotes?: string | null;
    lastCheckin?: { date: string; mood: string } | null;
  };
  fees?: { billed: number; paid: number; outstanding: number; nextDue: string | null };
  tracking?: { enabled: boolean; status: string; latitude: number | null; longitude: number | null; locationStatus: string | null; recordedAt: string | null } | null;
}

const EW_STAGES = ['Signal', 'Teacher Review', 'Intervention', 'Action', 'Follow-up', 'Closed'];
type Tab = 'overview' | 'academics' | 'attendance' | 'skills' | 'activities' | 'behaviour' | 'wellbeing' | 'achievements' | 'portfolio' | 'interventions' | 'documents' | 'tracking';

export default function Student360Page() {
  const { id } = useParams();
  if (!id) return <StudentPicker />;
  return <Student360 id={id} />;
}

export function Student360({ id }: { id: string }) {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const requestedTab = (sp.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setSp((p) => { const n = new URLSearchParams(p); if (t === 'overview') n.delete('tab'); else n.set('tab', t); return n; }, { replace: true });
  const q = useApiQuery<Profile>(`/students/${id}/profile`);
  const [editing, setEditing] = useState(false);
  const staff = can(['students.read', 'students.read_assigned']);
  const canTrack = can(['tracking.read_all', 'tracking.read_assigned']);

  if (q.isLoading) return <Page><PageSkeleton /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data;
  const s = d.student;
  const primary = d.guardians[0];

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'academics', label: 'Academics' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'skills', label: 'Skills' },
    { id: 'activities', label: 'Activities' },
    { id: 'behaviour', label: 'Behaviour' },
    { id: 'wellbeing', label: 'Wellbeing' },
    { id: 'achievements', label: 'Achievements' },
    { id: 'portfolio', label: 'Portfolio' },
    ...(d.interventions ? [{ id: 'interventions' as Tab, label: 'Interventions' }] : []),
    { id: 'documents', label: 'Documents' },
    ...(canTrack ? [{ id: 'tracking' as Tab, label: 'Student Tracking' }] : []),
  ];
  // A tab the viewer cannot open (e.g. from a shared link) falls back to the overview.
  const tab: Tab = tabs.some((t) => t.id === requestedTab) ? requestedTab : 'overview';

  return (
    <Page>
      {staff && (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => navigate('/students')}>Students</button>
          <Icon name="chevronRight" size={12} />
          <span aria-current="page">{s.fullName}</span>
        </nav>
      )}
      <section className="card profilehead">
        <div className="profilehead__main">
          <Avatar name={s.fullName} size="xl" src={s.photoUrl} />
          <div className="profilehead__id">
            <div className="row g-2 wrap">
              <h1 className="profilehead__name">{s.fullName}</h1>
              <Badge tone={s.risk === 'At Risk' ? 'critical' : s.risk === 'Developing Risk' ? 'warning' : 'success'} dot>{s.risk}</Badge>
              <Badge tone={toneForToday(s.today)}>{TODAY_LABEL[s.today] ?? s.today}</Badge>
              {s.status !== 'active' && <Status value={s.status} />}
            </div>
            <p className="profilehead__meta">
              <span className="t-strong t-semi">{s.admissionNo}</span> ·{s.grade} {s.section}{s.rollNo ? ` · Roll ${s.rollNo}` : ''} · {s.house ? `${s.house} House · ` : ''}{s.campusName}
            </p>
            <div className="profilehead__facts">
              <span title="Primary parent"><Icon name="user" size={14} />{primary ? <>{primary.fullName}{primary.phone ? <span className="t-muted"> · {primary.phone}</span> : null}</> : 'No parent linked'}</span>
              <span title="Class teacher"><Icon name="graduation" size={14} />{s.classTeacher ?? 'No class teacher'}</span>
              <span title="Date of birth and blood group"><Icon name="calendar" size={14} />{fmt.date(s.dateOfBirth)} · {s.bloodGroup ?? 'Blood group not recorded'}</span>
            </div>
          </div>
          <div className="profilehead__actions">
            {can('communication.send') && primary && (
              <Button size="sm" variant="primary" icon="message" to={`/parent-communication?parent=${primary.id}`}>Message parent</Button>
            )}
            {canTrack && <Button size="sm" icon="mapPin" onClick={() => setTab('tracking')}>Track</Button>}
            {can('earlywarning.read') && d.interventions && (
              <Button size="sm" icon="flag" onClick={() => setTab('interventions')}>Interventions</Button>
            )}
            {can('students.update') && <Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
            <Button size="sm" variant="quiet" icon="printer" onClick={() => window.print()} title="Print profile">Print</Button>
          </div>
        </div>
        <dl className="profilehead__stats">
          <div>
            <dt>Attendance</dt>
            <dd className={s.attendance != null && s.attendance < 85 ? 't-critical' : undefined}>{s.attendance != null ? `${s.attendance}%` : '—'}</dd>
            <span>this academic year</span>
          </div>
          <div>
            <dt>Academic average</dt>
            <dd>{s.average ?? '—'}</dd>
            <span className={s.trend > 0 ? 't-success' : s.trend < 0 ? 't-critical' : undefined}>{s.average != null ? `${s.trend >= 0 ? '+' : ''}${s.trend} trend` : 'No results yet'}</span>
          </div>
          {d.fees && (
            <div>
              <dt>Fees</dt>
              <dd className={d.fees.outstanding > 0 ? 't-critical' : 't-success'}>{d.fees.outstanding > 0 ? fmt.money(d.fees.outstanding, { compact: true }) : 'Cleared'}</dd>
              <span>{d.fees.outstanding > 0 ? (d.fees.nextDue ? `outstanding · next due ${fmt.date(d.fees.nextDue)}` : 'outstanding') : 'for this year'}</span>
            </div>
          )}
          <div>
            <dt>Transport</dt>
            <dd className="t-clip">{d.transport ? d.transport.routeCode : 'Own'}</dd>
            <span className="t-clip">{d.transport ? `${d.transport.routeName} · ${d.transport.stopName ?? d.transport.area}` : 'Own transport'}</span>
          </div>
        </dl>
      </section>

      <div className="tabsbar">
        <Tabs items={tabs} active={tab} onChange={setTab} />
      </div>

      <div className="mt-4">
        {tab === 'overview' && <Overview d={d} onTab={setTab} />}
        {tab === 'academics' && <AcademicsTab d={d} />}
        {tab === 'attendance' && <AttendanceTab d={d} />}
        {tab === 'skills' && <SkillsTab d={d} />}
        {tab === 'activities' && <ActivitiesTab d={d} />}
        {tab === 'behaviour' && <BehaviourTab d={d} studentId={s.id} canWrite={staff && !!user?.employeeId} />}
        {tab === 'wellbeing' && <WellbeingTab d={d} />}
        {tab === 'achievements' && <AchievementsTab d={d} studentId={s.id} canWrite={staff} />}
        {tab === 'portfolio' && <PortfolioTab d={d} />}
        {tab === 'interventions' && <InterventionsTab d={d} />}
        {tab === 'documents' && <DocumentsTab d={d} studentId={s.id} />}
        {tab === 'tracking' && canTrack && (
          <TrackingPanel
            locationPath={`/students/${s.id}/location`}
            historyPath={can('tracking.history') ? `/students/${s.id}/location/history` : undefined}
          />
        )}
      </div>

      {editing && (
        <StudentFormModal
          studentId={s.id}
          initial={{
            firstName: s.firstName, lastName: s.lastName, dateOfBirth: s.dateOfBirth, gender: s.gender, bloodGroup: s.bloodGroup ?? '',
            campusId: s.campusId, sectionId: s.sectionId ?? '', classId: undefined, house: s.house ?? '', address: s.address ?? '',
            city: s.city ?? '', pincode: s.pincode ?? '', admittedOn: s.admittedOn ?? '', medicalNotes: d.wellbeing.medicalNotes ?? '',
          }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); q.refetch(); }}
        />
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
function skillsIndex(d: Profile) {
  return d.skills.length ? Math.round(d.skills.reduce((a, k) => a + k.value, 0) / d.skills.length) : null;
}

function Overview({ d, onTab }: { d: Profile; onTab: (t: Tab) => void }) {
  const s = d.student;
  const si = skillsIndex(d);
  const strongest = d.skills[0];
  const openInterventions = (d.interventions ?? []).filter((i) => !i.closedAt && i.decision !== 'dismissed');
  const positives = d.behaviour.filter((b) => b.type === 'Positive').length;
  const totals = d.attendance.totals;
  return (
    <Grid cols="g-main">
      <div className="col g-4">
        <Grid cols="g-4col">
          <Kpi icon="trending" label="Academic average" value={s.average ?? '—'} unit="/100" tone="teal" delta={s.trend} deltaUnit="" foot={`Across ${d.academics.subjects.length} subjects`} onClick={() => onTab('academics')} />
          <Kpi icon="checkSquare" label="Attendance" value={s.attendance != null ? `${s.attendance}%` : '—'} foot={totals ? `${totals.absent} absences · ${totals.late} late` : undefined} onClick={() => onTab('attendance')} />
          <Kpi icon="activity" label="Skills index" value={si ?? '—'} unit="/100" tone="amber" foot={strongest ? `${strongest.name} strongest` : undefined} onClick={() => onTab('skills')} />
          <Kpi icon="award" label="Achievements" value={d.achievements.length} tone="info" foot={`${d.achievements.filter((a) => a.level && a.level !== 'School').length} beyond school level`} onClick={() => onTab('achievements')} />
        </Grid>
        <Card icon="activity" title="Growth timeline" sub="Admission → assessments → activities → achievements → interventions → certifications → competitions">
          {d.timeline.length ? (
            <Timeline items={d.timeline.map((t) => ({ time: fmt.date(t.date), title: t.title, body: t.body ?? undefined, tone: t.tone }))} />
          ) : <Empty icon="clock" title="No timeline entries yet" />}
        </Card>
        {d.observations && (
          <Card icon="grid" title="Teacher observations" sub="Qualitative evidence recorded alongside the numbers">
            {d.observations.length ? d.observations.map((o) => (
              <div className="row-top g-3 mb-4" key={o.id}>
                <Avatar name={o.by} size="sm" />
                <div className="grow">
                  <div className="row between wrap">
                    <span className="t-sm t-bold">{o.by}<span className="t-muted t-semi"> · {o.role}</span></span>
                    <span className="t-micro t-muted">{fmt.date(o.date)}</span>
                  </div>
                  <p className="t-sm mt-2">{o.text}</p>
                </div>
              </div>
            )) : <Empty icon="edit" title="No observations recorded" />}
            <ObservationForm studentId={s.id} />
          </Card>
        )}
      </div>
      <div className="col g-4">
        <SkillWebCard d={d} onOpen={() => onTab('skills')} />
        <TalentCard d={d} />
        <Card icon="grid" title="At a glance">
          <div className="col g-4">
            <Meter label="Academic performance" value={s.average ?? 0} right={s.average != null ? `${s.average}/100` : '—'} tone="teal" />
            <Meter label="Attendance" value={s.attendance ?? 0} right={s.attendance != null ? `${s.attendance}%` : '—'} />
            <Meter label="Skills development" value={si ?? 0} right={si != null ? `${si}/100` : '—'} tone="amber" />
            <Meter label="Activity participation" value={Math.min(100, d.activities.length * 22)} right={`${d.activities.length} activities`} tone="info" />
            <Meter label="Behaviour" value={d.behaviour.length ? Math.round((positives / d.behaviour.length) * 100) : 100} right={`${positives} positive of ${d.behaviour.length}`} tone="teal" />
            {d.wellbeing.lastCheckin && <Meter label="Wellbeing" value={d.wellbeing.lastCheckin.mood === 'Settled' || d.wellbeing.lastCheckin.mood === 'Positive' ? 88 : 55} right={d.wellbeing.lastCheckin.mood} tone="teal" />}
            {d.wellbeing.checkins?.[0] && <Meter label="Wellbeing" value={['Settled', 'Positive'].includes(d.wellbeing.checkins[0].mood) ? 88 : 55} right={d.wellbeing.checkins[0].mood} tone="teal" />}
          </div>
        </Card>
        {d.interventions && (
          <Card icon="grid" title="Open intervention" actions={<Badge tone={openInterventions.length ? 'warning' : 'success'}>{openInterventions.length} active</Badge>}>
            {openInterventions.length ? openInterventions.slice(0, 2).map((i) => (
              <div key={i.id} className="mb-4">
                <div className="t-sm t-bold">{i.signal}</div>
                <div className="t-micro t-muted mt-1">{i.code} · opened {fmt.date(i.opened)}{i.owner ? ` · owner ${i.owner}` : ''}</div>
                <div className="mt-3"><Stepper steps={EW_STAGES} active={i.stage} /></div>
                {i.action && <div className="mt-3 t-sm">{i.action}</div>}
                {i.next && <div className="t-micro t-muted mt-1">Next review {fmt.date(i.next)}</div>}
              </div>
            )) : <Empty icon="check" title="No open interventions" />}
          </Card>
        )}
        {d.tracking && (
          <Card icon="bus" title="Location" actions={<Button size="sm" iconRight="arrowRight" onClick={() => onTab('tracking')}>Track</Button>}>
            {d.tracking.enabled && d.tracking.recordedAt ? (
              <Dl items={[
                ['Status', d.tracking.locationStatus ? ({ at_school: 'At school', in_transit: 'In transit', at_home: 'At home', on_trip: 'On a school trip' } as Record<string, string>)[d.tracking.locationStatus] ?? '—' : '—'],
                ['Coordinates', <span key="c" className="coord">{Number(d.tracking.latitude).toFixed(4)}, {Number(d.tracking.longitude).toFixed(4)}</span>],
                ['Last updated', fmt.dateTime(d.tracking.recordedAt)],
              ]} />
            ) : <p className="t-sm t-muted">{d.tracking.enabled ? 'No location recorded yet.' : 'Tracking is disabled for this student.'}</p>}
          </Card>
        )}
      </div>
    </Grid>
  );
}

function ObservationForm({ studentId }: { studentId: string }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const save = useApiMutation<{ observation: string }>('post', `/students/${studentId}/observations`, {
    invalidate: [`/students/${studentId}`], success: 'Observation saved to the profile', onSuccess: () => setText(''),
  });
  if (!user?.employeeId) return null;
  return (
    <form className="col g-2" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) save.mutate({ observation: text.trim() }); }}>
      <TextArea label="Add an observation" value={text} onChange={setText} rows={2} maxLength={2000} placeholder="What did you observe, and in what context?" />
      <div><Button size="sm" variant="primary" type="submit" disabled={text.trim().length < 3} loading={save.isPending}>Save observation</Button></div>
    </form>
  );
}

function TalentCard({ d }: { d: Profile }) {
  const [open, setOpen] = useState<string | null>(d.talent.strengths[0]?.name ?? null);
  const top = d.talent.strengths[0];
  const low = d.talent.strengths[d.talent.strengths.length - 1];
  return (
    <section className="ai-card">
      <div className="ai-card__head">
        <span className="ai-badge"><Icon name="sparkle" size={12} />AI Talent Discovery</span>
        <span className="t-xs t-muted grow">Potential strengths, with the evidence behind each</span>
      </div>
      <div className="card__body">
        {d.talent.strengths.length ? (
          <div className="col g-2">
            {d.talent.strengths.map((st) => {
              const isOpen = open === st.name;
              return (
                <div className="card" style={{ borderRadius: 'var(--r-md)' }} key={st.name}>
                  <button type="button" className="row g-3 hoverable" style={{ width: '100%', padding: '10px 12px', textAlign: 'left', borderRadius: 'var(--r-md)' }}
                    aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : st.name)}>
                    <span className="none"><Ring pct={st.score} size={38} color={st.score >= 80 ? 'var(--teal)' : st.score >= 70 ? 'var(--amber)' : 'var(--neutral)'} /></span>
                    <span className="col grow">
                      <span className="t-sm t-bold">{st.name}</span>
                      <span className="t-micro t-muted">{st.confidence ?? '—'} confidence · {st.evidence.length} piece{st.evidence.length === 1 ? '' : 's'} of evidence</span>
                    </span>
                    <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={15} />
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 12px 12px 12px' }}>
                      <div className="evidence">
                        {st.evidence.map((e) => <div className="evidence__item" key={e}><Icon name="check" size={12} /> {e}</div>)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : <Empty icon="sparkle" title="No skill evidence recorded yet" />}
        {top && low && top.name !== low.name && (
          <div className="mt-4">
            <Banner tone="neutral" icon="lightbulb">
              <strong>Suggested next step.</strong> Pair the confirmed strength ({top.name.toLowerCase()}) with the development area ({low.name.toLowerCase()}) through a structured opportunity such as an Innovation Lab mentoring role.
            </Banner>
          </div>
        )}
        <div className="mt-3"><AiNotice /></div>
      </div>
    </section>
  );
}

function AcademicsTab({ d }: { d: Profile }) {
  const s = d.student;
  const latest = d.academics.termTrend[d.academics.termTrend.length - 1]?.value ?? s.average ?? 0;
  const predicted = latest >= 85 ? 'A+' : latest >= 78 ? 'A' : latest >= 72 ? 'B+' : latest >= 65 ? 'B' : latest >= 55 ? 'C' : 'D';
  const gaps = [...d.academics.subjects].filter((x) => x.target != null && x.score < (x.target ?? 0)).sort((a, b) => (a.score - (a.target ?? 0)) - (b.score - (b.target ?? 0)));
  return (
    <Grid cols="g-main">
      <div className="col g-4">
        <Card icon="trending" title="Subject performance" sub="Current scores against personal targets" flush>
          <DataTable
            rows={d.academics.subjects}
            rowKey={(r) => r.name}
            emptyText="No results recorded this year."
            columns={[
              { key: 'name', label: 'Subject', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.teacher ?? '—'}</div></> },
              { key: 'score', label: 'Score', className: 'num', render: (r) => <span className="t-num t-bold">{r.score}</span> },
              { key: 'grade', label: 'Grade', render: (r) => <Badge tone={r.score >= 80 ? 'success' : r.score >= 70 ? 'info' : 'warning'}>{r.grade}</Badge> },
              { key: 'trend', label: 'Trend', render: (r) => (r.trend == null ? '—' : <TrendCell v={r.trend} />) },
              {
                key: 'target', label: 'Against target', render: (r) => r.target
                  ? <Meter label="" value={Math.min(100, (r.score / r.target) * 100)} right={`${r.score} / ${r.target}`} tone={r.score >= r.target ? 'teal' : 'amber'} />
                  : '—',
              },
            ]}
          />
        </Card>
        <Card icon="trending" title="Performance trend" sub="Average across terms">
          {d.academics.termTrend.length > 1 ? (
            <Chart svg={charts.line({ labels: d.academics.termTrend.map((t) => t.label), series: [{ name: 'Average', values: d.academics.termTrend.map((t) => t.value), color: 'var(--navy)' }], yMin: 30, yMax: 100, height: 210, label: 'Average across terms' })} />
          ) : <Empty icon="trending" title="Not enough terms yet" />}
        </Card>
        <Card icon="grid" title="Recent assessments" flush>
          <DataTable
            compact
            rows={d.academics.assessments}
            rowKey={(r) => r.code}
            emptyText="No assessment marks recorded yet."
            columns={[
              { key: 'name', label: 'Assessment', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.subject} · {fmt.date(r.heldOn)}</div></> },
              { key: 'marks', label: 'Marks', className: 'num', render: (r) => (r.isAbsent ? <Badge tone="critical">Absent</Badge> : <span className="t-num">{r.marks ?? '—'} / {r.maxMarks}</span>) },
              { key: 'pct', label: '%', className: 'num', render: (r) => (r.pct == null ? '—' : `${r.pct}%`) },
              { key: 'grade', label: 'Grade', render: (r) => r.grade ?? '—' },
            ]}
          />
        </Card>
      </div>
      <div className="col g-4">
        <Card icon="trending" title="Predicted grade" sub="Model output — advisory">
          <div className="row center"><Chart svg={charts.gauge({ percent: latest, value: predicted, sub: 'Predicted end of year', color: 'var(--teal)' })} /></div>
          <div className="mt-3">
            <AiNotice><strong>Prediction, not a decision.</strong> Based on {d.academics.termTrend.length} data points this year. The class teacher confirms predicted grades before they are shared with parents.</AiNotice>
          </div>
        </Card>
        <Card icon="grid" title="Learning gaps" sub="Subjects currently below the personal target">
          {gaps.length ? gaps.map((g) => (
            <div className="mb-4" key={g.name}>
              <div className="row between"><span className="t-sm t-bold">{g.name}</span><Badge tone="warning">{g.score} of {g.target}</Badge></div>
              <div className="t-xs t-muted mt-1">{(g.target ?? 0) - g.score} points below target{g.trend != null ? ` · trend ${g.trend >= 0 ? '+' : ''}${g.trend}` : ''}</div>
            </div>
          )) : <Empty icon="check" title="On or above target in every subject" />}
        </Card>
      </div>
    </Grid>
  );
}

function AttendanceTab({ d }: { d: Profile }) {
  const recent = d.attendance.recent;
  const totals = d.attendance.totals;
  const col: Record<string, string> = { present: 'var(--teal)', late: 'var(--amber)', absent: 'var(--critical)', leave: 'var(--info)' };
  const exceptions = recent.filter((r) => r.status !== 'present');
  return (
    <Grid cols="g-main">
      <div className="col g-4">
        <Card icon="checkSquare" title="Monthly attendance" sub="Percentage present per month this academic year">
          {d.attendance.months.length ? (
            <Chart svg={charts.bar({ labels: d.attendance.months.map((m) => m.label), series: [{ name: 'Attendance %', values: d.attendance.months.map((m) => m.value), color: 'var(--teal)' }], yMax: 100, target: 93, targetLabel: 'Expected 93%', height: 210 })} />
          ) : <Empty icon="calendar" title="No attendance marked yet" />}
        </Card>
        <Card icon="grid" title="Recent days" sub="Last 20 marked school days">
          <div className="heat" style={{ gridTemplateColumns: 'repeat(10, 1fr)', maxWidth: 520 }}>
            {[...recent].reverse().map((r) => (
              <div key={r.date} className="heat__cell" style={{ background: col[r.status] ?? 'var(--border)' }} title={`${fmt.date(r.date)} — ${TODAY_LABEL[r.status] ?? r.status}`}>
                {r.date.slice(8)}
              </div>
            ))}
          </div>
          <div className="mt-4"><Legend items={[{ label: 'Present', color: 'var(--teal)' }, { label: 'Late', color: 'var(--amber)' }, { label: 'Absent', color: 'var(--critical)' }, { label: 'Leave', color: 'var(--info)' }]} /></div>
        </Card>
      </div>
      <div className="col g-4">
        {totals && (
          <Grid cols="g-2col">
            <Kpi icon="checkSquare" label="Days marked" value={totals.marked} />
            <Kpi icon="checkSquare" label="Present" value={totals.present} tone="teal" />
            <Kpi icon="clock" label="Late" value={totals.late} tone="amber" />
            <Kpi icon="alert" label="Absent / leave" value={`${totals.absent} / ${totals.leave}`} tone="critical" />
          </Grid>
        )}
        <Card icon="checkSquare" title="Absence record" flush>
          <DataTable
            compact
            rows={exceptions}
            rowKey={(r) => r.date}
            emptyText="No absences or late arrivals in the recent record."
            columns={[
              { key: 'date', label: 'Date', render: (r) => fmt.date(r.date) },
              { key: 'status', label: 'Type', render: (r) => <Badge tone={toneForToday(r.status)}>{TODAY_LABEL[r.status]}</Badge> },
              { key: 'remarks', label: 'Detail', render: (r) => r.remarks ?? (r.arrivalTime ? `Arrived ${r.arrivalTime.slice(0, 5)}` : '—') },
            ]}
          />
        </Card>
      </div>
    </Grid>
  );
}

/**
 * The skill web: a radar of the student's skills (needs at least 3), with the
 * strongest skill and the development area. Used on the Student 360 overview and
 * on the student's own home screen.
 */
export function SkillWebCard({ d, onOpen, title = 'Skill web' }: { d: Profile; onOpen?: () => void; title?: string }) {
  // A fixed axis order, so webs look alike from one student to the next
  const skills = [...d.skills].sort((a, b) => a.name.localeCompare(b.name));
  const ranked = [...d.skills].sort((a, b) => b.value - a.value);
  const top = ranked[0], low = ranked[ranked.length - 1];
  return (
    <Card icon="activity" title={title} sub="Built from assessments, activities and teacher observation"
      actions={onOpen && <Button size="sm" variant="quiet" iconRight="arrowRight" onClick={onOpen}>Details</Button>}>
      {skills.length >= 3 ? (
        <div className="col g-3 center">
          <Chart svg={charts.radar({ size: 240, axes: skills.map((k) => k.name), series: [{ name: 'Current', values: skills.map((k) => k.value), color: 'var(--teal)' }] })} />
          <div className="row g-2 wrap center">
            {top && <Badge tone="success" icon="trending">Strongest: {top.name} {top.value}</Badge>}
            {low && low.name !== top?.name && <Badge tone="warning">Develop: {low.name} {low.value}</Badge>}
          </div>
        </div>
      ) : <Empty icon="sparkle" title="Not enough skill evidence yet" sub="The web appears once three or more skills are assessed." />}
    </Card>
  );
}

function SkillsTab({ d }: { d: Profile }) {
  return (
    <Grid cols="g-main">
      <Card icon="user" title="Skills profile" sub="Built from assessments, activities, teacher observation and peer feedback">
        {d.skills.length >= 3 ? (
          <div className="row g-5 wrap center">
            <div className="none">
              <Chart svg={charts.radar({ size: 262, axes: d.skills.map((k) => k.name), series: [{ name: 'Current', values: d.skills.map((k) => k.value), color: 'var(--teal)' }] })} />
            </div>
            <div className="grow col g-4" style={{ minWidth: 250 }}>
              {d.skills.map((k) => <Meter key={k.name} label={k.name} value={k.value} right={`${k.value}/100`} tone={k.value >= 80 ? 'teal' : k.value >= 70 ? 'info' : 'amber'} />)}
            </div>
          </div>
        ) : <Empty icon="sparkle" title="Not enough skill evidence yet" />}
        {d.interests.length > 0 && (
          <div className="mt-4">
            <div className="eyebrow mb-2">Interests</div>
            <div className="row g-2 wrap">{d.interests.map((i) => <span key={i} className="tag">{i}</span>)}</div>
          </div>
        )}
      </Card>
      <TalentCard d={d} />
    </Grid>
  );
}

function ActivitiesTab({ d }: { d: Profile }) {
  return (
    <Card icon="grid" title="Activities and participation" sub="Clubs, sport and elective engagement" flush>
      <DataTable
        rows={d.activities}
        rowKey={(r) => r.name}
        emptyText="No activities recorded."
        columns={[
          { key: 'name', label: 'Activity', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.category}</div></> },
          { key: 'role', label: 'Role' },
          { key: 'since', label: 'Since', render: (r) => fmt.date(r.since) },
          { key: 'hours', label: 'Logged hours', className: 'num', render: (r) => <span className="t-num">{r.hours} h</span> },
          { key: 'bar', label: 'Engagement', render: (r) => <Meter label="" value={Math.min(100, r.hours * 1.4)} right={r.hours > 40 ? 'High' : r.hours > 18 ? 'Steady' : 'Light'} tone="teal" /> },
        ]}
      />
    </Card>
  );
}

function BehaviourTab({ d, studentId, canWrite }: { d: Profile; studentId: string; canWrite: boolean }) {
  const [note, setNote] = useState('');
  const save = useApiMutation<{ recordType: string; note: string }>('post', `/students/${studentId}/behaviour`, {
    invalidate: [`/students/${studentId}`], success: (_r, v) => `${v.recordType} note saved to the profile`, onSuccess: () => setNote(''),
  });
  const counts = d.behaviour.reduce<Record<string, number>>((a, b) => ({ ...a, [b.type]: (a[b.type] ?? 0) + 1 }), {});
  const tone = (t: string) => (t === 'Positive' ? 'teal' : t === 'Note' ? 'amber' : 'critical');
  return (
    <Grid cols="g-main">
      <Card icon="grid" title="Behaviour record" sub="Positive notes and concerns, logged by staff">
        {d.behaviour.length ? (
          <Timeline items={d.behaviour.map((b) => ({ time: `${fmt.date(b.date)}${b.by ? ` · ${b.by}` : ''}`, title: b.note, body: b.type, tone: tone(b.type) }))} />
        ) : <Empty icon="heart" title="No behaviour notes recorded" />}
      </Card>
      <div className="col g-4">
        <Card icon="grid" title="Balance">
          {d.behaviour.length ? (
            <div className="row center">
              <Chart svg={charts.donut({
                size: 150, thickness: 22, center: `${counts.Positive ?? 0}:${d.behaviour.length - (counts.Positive ?? 0)}`, centerSub: 'Positive to other',
                data: Object.entries(counts).map(([k, n]) => ({ label: k, value: n, color: k === 'Positive' ? 'var(--teal)' : k === 'Note' ? 'var(--amber)' : 'var(--critical)' })),
              })} />
            </div>
          ) : null}
          <p className="t-xs t-muted mt-3">Behaviour is recorded as evidence, not as a score. No automatic labelling is applied.</p>
        </Card>
        {canWrite && (
          <Card icon="grid" title="Record a note">
            <TextArea label="Observation" value={note} onChange={setNote} placeholder="What did you observe, and in what context?" maxLength={1000} />
            <div className="row g-2 mt-3 wrap">
              <Button variant="teal" size="sm" disabled={note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate({ recordType: 'Positive', note: note.trim() })}>Save as positive</Button>
              <Button size="sm" disabled={note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate({ recordType: 'Note', note: note.trim() })}>Save as note</Button>
              <Button size="sm" variant="danger" disabled={note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate({ recordType: 'Concern', note: note.trim() })}>Save as concern</Button>
            </div>
          </Card>
        )}
      </div>
    </Grid>
  );
}

function WellbeingTab({ d }: { d: Profile }) {
  const w = d.wellbeing;
  if (!w.checkins) {
    return (
      <Card icon="heart" title="Wellbeing">
        {w.lastCheckin ? <p className="t-sm">Last check-in on {fmt.date(w.lastCheckin.date)}: <strong>{w.lastCheckin.mood}</strong>.</p> : <p className="t-sm t-muted">No check-ins recorded.</p>}
        <div className="mt-4"><Banner tone="neutral" icon="lock">Wellbeing records are restricted. Only the counsellor, the Principal and authorised staff can open the full record.</Banner></div>
      </Card>
    );
  }
  const last = w.checkins[0];
  return (
    <Grid cols="g-main">
      <div className="col g-4">
        <Grid cols="g-3col">
          <Kpi icon="activity" label="Current state" value={last?.mood ?? '—'} tone="teal" foot={last ? `Last check-in ${fmt.date(last.date)}` : undefined} />
          <Kpi icon="target" label="Infirmary visits" value={w.infirmaryVisits ?? 0} tone="info" foot="All recorded visits" />
          <Kpi icon="shield" label="Counselling sessions" value={w.counsellingSessions ?? 0} foot="Scheduled and completed" />
        </Grid>
        <Card icon="grid" title="Check-ins">
          {w.checkins.length ? (
            <Timeline items={w.checkins.map((c) => ({ time: `${fmt.date(c.date)}${c.by ? ` · ${c.by}` : ''}`, title: c.mood, body: c.notes ?? undefined, tone: ['Settled', 'Positive'].includes(c.mood) ? 'teal' : 'amber' }))} />
          ) : <Empty icon="heart" title="No check-ins recorded" />}
          <div className="mt-4"><Banner tone="neutral" icon="lock">Wellbeing records are restricted. Only the counsellor, the Principal and authorised staff can open this tab.</Banner></div>
        </Card>
      </div>
      <div className="col g-4">
        <Card icon="grid" title="Medical notes"><p className="t-sm">{w.medicalNotes || 'No medical notes recorded.'}</p></Card>
        <Card icon="grid" title="Request support">
          <p className="t-sm t-muted">Staff can request a counsellor check-in without creating a formal record.</p>
          <div className="mt-3"><Button block icon="heart" to="/counselling">Open counselling</Button></div>
        </Card>
      </div>
    </Grid>
  );
}

function AchievementsTab({ d, studentId, canWrite }: { d: Profile; studentId: string; canWrite: boolean }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', achievementType: 'Competition', level: 'School', achievedOn: todayKey() });
  const save = useApiMutation<typeof form>('post', `/students/${studentId}/achievements`, {
    invalidate: [`/students/${studentId}`], success: 'Achievement recorded and verified', onSuccess: () => { setAdding(false); setForm({ ...form, title: '' }); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form.title.trim().length >= 3) save.mutate({ ...form, title: form.title.trim() });
  };
  return (
    <Card title="Achievements" sub="Verified records that feed the portfolio and talent view"
      actions={canWrite ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add achievement</Button> : undefined}>
      {d.achievements.length ? (
        <div className="grid g-2col">
          {d.achievements.map((a) => (
            <div className="card card--tint" style={{ padding: 16 }} key={a.id}>
              <div className="row-top g-3">
                <span className="avatar avatar--amber none"><Icon name="award" size={18} /></span>
                <div className="grow">
                  <div className="t-sm t-bold">{a.title}</div>
                  <div className="t-micro t-muted mt-1">{fmt.date(a.date)} · {a.type}{a.level ? ` · ${a.level}` : ''}</div>
                  <div className="mt-2"><Badge tone={a.verified ? 'success' : 'neutral'} icon={a.verified ? 'check' : undefined}>{a.verified ? 'Verified' : 'Unverified'}</Badge></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty icon="award" title="No achievements recorded yet" />}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add achievement" busy={save.isPending}
        foot={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" type="submit" form="ach-form" loading={save.isPending} disabled={form.title.trim().length < 3}>Save</Button></>}>
        <form id="ach-form" className="form-grid" onSubmit={submit}>
          <TextField className="span-2" label="Title" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} maxLength={200} autoFocus />
          <SelectField label="Type" value={form.achievementType} onChange={(v) => setForm({ ...form, achievementType: v })} options={['Competition', 'Academic', 'Co-curricular', 'Attendance', 'Sports', 'Service']} />
          <SelectField label="Level" value={form.level} onChange={(v) => setForm({ ...form, level: v })} options={['School', 'District', 'State', 'National', 'International']} />
          <TextField label="Date" type="date" required value={form.achievedOn} max={todayKey()} onChange={(v) => setForm({ ...form, achievedOn: v })} />
        </form>
      </Modal>
    </Card>
  );
}

function PortfolioTab({ d }: { d: Profile }) {
  return (
    <Grid cols="g-main">
      <div className="col g-4">
        <Card icon="rocket" title="Innovation projects" sub="Projects this student leads or contributes to" flush>
          <DataTable
            rows={d.innovationProjects}
            rowKey={(r) => r.id}
            emptyText="No innovation projects yet."
            columns={[
              { key: 'title', label: 'Project', render: (r) => <><span className="t-bold">{r.title}</span><div className="t-micro t-muted">{r.code}{r.mentor ? ` · mentor ${r.mentor}` : ''}</div></> },
              { key: 'status', label: 'Stage', render: (r) => <Status value={r.status} /> },
              { key: 'milestones', label: 'Milestones', render: (r) => <Meter label="" value={r.milestones ? (r.done / r.milestones) * 100 : 0} right={`${r.done}/${r.milestones}`} tone="teal" /> },
            ]}
          />
        </Card>
        <Card icon="grid" title="Recognition">
          {d.achievements.filter((a) => a.verified).length ? (
            <Timeline items={d.achievements.filter((a) => a.verified).map((a) => ({ time: fmt.date(a.date), title: a.title, body: `${a.type}${a.level ? ` · ${a.level}` : ''}`, tone: 'teal' }))} />
          ) : <Empty icon="award" title="No verified achievements yet" />}
        </Card>
      </div>
      <div className="col g-4">
        <Card icon="grid" title="Activities">
          {d.activities.length ? d.activities.map((a) => (
            <div key={a.name} className="row between mb-2"><span className="t-sm">{a.name} <span className="t-muted">· {a.role}</span></span><span className="t-xs t-num">{a.hours} h</span></div>
          )) : <Empty icon="star" title="No activities" />}
        </Card>
        <Card icon="grid" title="Share">
          <p className="t-sm t-muted">The portfolio is compiled from verified records only. Print it or save it as PDF from the browser.</p>
          <div className="mt-3"><Button block icon="printer" onClick={() => window.print()}>Print portfolio</Button></div>
        </Card>
      </div>
    </Grid>
  );
}

function InterventionsTab({ d }: { d: Profile }) {
  const { can } = useAuth();
  const list = d.interventions ?? [];
  return (
    <Card icon="alert" title="Early Warning and interventions" sub="Signal → Teacher Review → Intervention → Action → Follow-up → Closed"
      actions={can('earlywarning.read') ? <Button size="sm" iconRight="arrowRight" to="/early-warning">Open Early Warning</Button> : undefined}>
      {list.length ? (
        <div className="col g-4">
          {list.map((i) => (
            <div key={i.id} className="card" style={{ padding: 16 }}>
              <div className="row between wrap g-2">
                <div>
                  <div className="t-sm t-bold">{i.signal}</div>
                  <div className="t-micro t-muted mt-1">{i.code} · {i.signalType} · opened {fmt.date(i.opened)}{i.owner ? ` · owner ${i.owner}` : ''}</div>
                </div>
                {i.closedAt ? <Badge tone="success">Closed {fmt.dateShort(i.closedAt)}</Badge> : i.decision === 'dismissed' ? <Badge>Dismissed</Badge> : <Badge tone="warning">{EW_STAGES[i.stage]}</Badge>}
              </div>
              <div className="mt-3"><Stepper steps={EW_STAGES} active={i.closedAt ? 5 : i.stage} /></div>
              {i.action && <p className="t-sm mt-3">{i.action}</p>}
              {i.next && !i.closedAt && <p className="t-micro t-muted mt-1">Next review {fmt.date(i.next)}</p>}
            </div>
          ))}
        </div>
      ) : <Empty icon="check" title="No signals raised for this student" />}
    </Card>
  );
}

function DocumentsTab({ d, studentId }: { d: Profile; studentId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const [uploadFor, setUploadFor] = useState<{ id?: string; name: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const verify = useApiMutation<{ id: string; status: string }>('patch', (v) => `/documents/${v.id}/verify`, {
    invalidate: [`/students/${studentId}`], body: (v) => ({ status: v.status }),
  });
  const canUpload = can(['documents.manage', 'students.update', 'parent_portal.use']);
  const invalidate = useInvalidate();

  const doUpload = async () => {
    if (!file || !uploadFor) return;
    if (file.size > 10 * 1024 * 1024) { toast('File is larger than 10 MB', 'critical'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('name', uploadFor.name);
      form.append('category', 'Student');
      form.append('studentId', studentId);
      if (uploadFor.id) form.append('documentId', uploadFor.id);
      form.append('file', file);
      await api.upload('/documents', form);
      toast('Document uploaded for verification', 'success', 'upload');
      setUploadFor(null);
      setFile(null);
      await invalidate(`/students/${studentId}`);
    } catch (err) {
      toast((err as Error).message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Documents" sub="Identity, admission and health records" flush
      actions={canUpload ? <Button size="sm" icon="upload" onClick={() => setUploadFor({ name: '' })}>Upload document</Button> : undefined}>
      <DataTable
        rows={d.documents}
        rowKey={(r) => r.id}
        emptyText="No documents on file."
        columns={[
          { key: 'name', label: 'Document', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.category}</div></> },
          { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
          { key: 'date', label: 'Date', render: (r) => (r.status === 'Pending' && r.requestedOn ? `Requested ${fmt.date(r.requestedOn)}` : fmt.date(r.verifiedAt ?? r.createdAt)) },
          {
            key: 'actions', label: '', className: 'num', render: (r) => (
              <div className="row g-2" style={{ justifyContent: 'flex-end' }}>
                {r.hasFile && <Button size="sm" icon="download" onClick={() => api.download(`/documents/${r.id}/download`, r.name).catch((e) => toast(e.message, 'critical'))}>Download</Button>}
                {!r.hasFile && canUpload && <Button size="sm" icon="upload" onClick={() => setUploadFor({ id: r.id, name: r.name })}>Upload</Button>}
                {r.status === 'Submitted' && can('documents.manage') && (
                  <>
                    <Button size="sm" variant="teal" onClick={() => verify.mutate({ id: r.id, status: 'Verified' })}>Verify</Button>
                    <Button size="sm" onClick={() => verify.mutate({ id: r.id, status: 'Rejected' })}>Reject</Button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
      <Modal open={!!uploadFor} onClose={() => setUploadFor(null)} title={uploadFor?.id ? `Upload “${uploadFor.name}”` : 'Upload document'} busy={busy}
        foot={<><Button onClick={() => setUploadFor(null)} disabled={busy}>Cancel</Button><Button variant="primary" icon="upload" loading={busy} disabled={!file || !uploadFor?.name.trim()} onClick={doUpload}>Upload</Button></>}>
        <div className="col g-4">
          {!uploadFor?.id && <TextField label="Document name" required value={uploadFor?.name ?? ''} onChange={(v) => setUploadFor((u) => (u ? { ...u, name: v } : u))} maxLength={160} />}
          <div className="field">
            <label className="label" htmlFor="doc-file">File <span className="req">*</span></label>
            <input id="doc-file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="hint">PDF, PNG, JPEG or WebP, up to 10 MB. Files are stored privately and verified by the school office.</span>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function StudentPicker() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list = usePagedQuery<StudentRow>('/students', { q: q || undefined, pageSize: 12, sort: 'risk' });
  return (
    <Page>
      <div className="pagehead">
        <div className="grow">
          <h1 className="pagehead__title">Student 360</h1>
          <p className="pagehead__sub">Choose a student to open their complete development record.</p>
        </div>
      </div>
      <Card>
        <SearchInput value={q} onSearch={setQ} placeholder="Search by name or admission number" maxWidth={480} />
        <div className="mt-4">
          {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
            <DataTable
              rows={list.data?.rows}
              loading={list.isLoading}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/student-360/${r.id}`)}
              emptyText="No students match that search."
              columns={[
                { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={`${r.grade}${r.section} · ${r.admissionNo}`} /> },
                { key: 'risk', label: 'Risk', render: (r) => <Risk value={r.risk} /> },
                { key: 'attendance', label: 'Attendance', render: (r) => (r.attendance != null ? `${r.attendance}%` : '—') },
                { key: 'go', label: '', className: 'num', render: () => <Icon name="chevronRight" size={15} /> },
              ]}
            />
          )}
        </div>
      </Card>
    </Page>
  );
}
