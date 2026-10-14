import { useState } from 'react';
import { iconNames } from '@/lib/legacy-icons';
import {
  AiNotice, AlertItem, Badge, Banner, Button, Card, Chart, charts, Checkbox, Flow, Icon, Kpi, Lotus, Meter, Modal, Page,
  PageHead, Segment, SelectField, Stepper, Switch, TextField, useToast,
} from '@/components/ui';

const SWATCHES: [string, string, string][] = [
  ['Holy Sai Magenta', '--brand', 'Primary brand color, primary actions, core brand identity'],
  ['Deep Magenta', '--brand-hover', 'Vibrant accent, hover highlights, interactive elements'],
  ['Warm Yellow (Gold)', '--accent', 'Secondary accent, badges, active indicators & borders'],
  ['Charcoal Black', '--charcoal', 'Headings, primary typography, high-contrast surfaces'],
  ['Surface', '--surface', 'Cards, tables, panels and pristine containers'],
  ['Deep Royal Wine', '--magenta-deep', 'Sidebar and dark application shell surfaces'],
  ['Warm Luxury Ground', '--bg', 'Application ground and soothing background canvas'],
  ['Muted Charcoal', '--text-muted', 'Body text labels, secondary metadata and subtitles'],
  ['Warm Border', '--border', 'Dividers, subtle lines and card borders'],
];
const STATUSES: [string, string, string][] = [
  ['Critical', 'critical', 'Immediate attention required.'],
  ['Attention', 'warning', 'Act today before escalating.'],
  ['Caution', 'caution', 'Monitor closely.'],
  ['Information', 'info', 'Contextual update.'],
  ['Completed', 'success', 'Finished and logged.'],
  ['Neutral', 'neutral', 'Standard state.'],
];
const VALUES: [string, string, string][] = [
  ['book', 'Educational', 'Academic rigour and lifelong learning'],
  ['lotus', 'Elegant', 'Refined, timeless aesthetic & dignity'],
  ['sparkle', 'Inspiring', 'Encouraging students to reach higher'],
  ['trending', 'Modern', 'Connected, forward-looking digital campus'],
  ['shieldCheck', 'Trustworthy', 'Transparent, reliable and safe'],
];

export default function DesignSystemPage() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [sw, setSw] = useState(true);
  const [check, setCheck] = useState(true);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [text, setText] = useState('');
  const [sel, setSel] = useState('Option one');

  return (
    <Page>
      <PageHead
        title="Brand Guidelines & Design System"
        sub="Official Holy Sai International School Brand Guidelines: Holy Sai Magenta, Deep Magenta, Warm Yellow/Gold, Charcoal Black, Cinzel Display and Montserrat UI. Every sample below is the live component used by the application."
      />
      <Card flush>
        <div className="row between wrap g-4" style={{ padding: 24, background: 'var(--magenta-deep)', color: 'var(--text-on-navy)', borderRadius: 'var(--r-lg)' }}>
          <div className="row g-4">
            <Lotus size={60} />
            <div>
              <div className="serif" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '.02em', color: 'var(--text-on-navy)' }}>Holy Sai International School</div>
              <div style={{ fontSize: 12, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '.14em', marginTop: 2 }}>Brand Identity &amp; Digital System</div>
            </div>
          </div>
          <div className="col end">
            <div className="script-font" style={{ fontSize: 22, color: 'var(--gold)' }}>Growing Minds. Inspiring Futures.</div>
            <div className="t-micro" style={{ color: 'var(--text-on-navy)', letterSpacing: '.1em', textTransform: 'uppercase' }}>A Brighter Tomorrow Begins Here</div>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Card icon="grid" title="Brand Color Palette" sub="Live design tokens from tokens.css — each swatch follows the current light or dark theme">
          <div className="grid g-3col g-4">
            {SWATCHES.map(([n, token, use]) => (
              <div className="card card--tint" style={{ padding: 12 }} key={token}>
                <div className="swatch-tile" style={{ background: `var(${token})` }} />
                <div className="t-sm t-bold mt-2">{n}</div>
                <div className="t-micro t-muted t-mono">var({token})</div>
                <div className="t-micro t-muted mt-1">{use}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid g-2col g-4 mt-4">
        <Card icon="grid" title="Typography System" sub="Cinzel for Headings & Display, Montserrat for Body & Supporting UI">
          <div className="col g-4">
            <div><div className="eyebrow">Primary Typeface · Cinzel Display 32</div><div className="display mt-1">Holy Sai International</div></div>
            <div><div className="eyebrow">Heading 1 · Cinzel 24</div><div className="h1 mt-1">Student Intelligence 360</div></div>
            <div><div className="eyebrow">Heading 2 · Cinzel 19</div><div className="h2 mt-1">Academic &amp; Campus Analytics</div></div>
            <div><div className="eyebrow">Secondary Typeface · Montserrat 14</div><p className="mt-1">Our typography combines elegance with modern clarity. Built for readability, scalability and cross-platform harmony.</p></div>
            <div><div className="eyebrow">Script Accent · Caveat</div><div className="script-font mt-1" style={{ fontSize: 24, color: 'var(--magenta)' }}>Learning Beyond Limits · Growing Minds. Inspiring Futures.</div></div>
            <div><div className="eyebrow">Data Figures · Montserrat Tabular</div><div className="t-num mt-1" style={{ fontSize: 22, fontWeight: 700, color: 'var(--magenta)' }}>1,284 Students · ₹17.96L · 98.4%</div></div>
          </div>
        </Card>
        <Card icon="grid" title="Brand Mood & Values" sub="The feeling we create in everything we do">
          <div className="col g-4">
            <div className="grid g-2col g-3">
              {VALUES.map(([ic, t, d]) => (
                <div className="card card--tint" style={{ padding: 14 }} key={t}>
                  <div className="row g-2">
                    <span className="avatar avatar--sm" style={{ background: 'var(--magenta)', color: 'var(--text-invert)' }}><Icon name={ic} size={15} /></span>
                    <span className="t-sm t-bold" style={{ color: 'var(--magenta)' }}>{t}</span>
                  </div>
                  <div className="t-micro t-muted mt-2">{d}</div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <div className="eyebrow mb-2">Semantic Status System</div>
            <div className="col g-2">
              {STATUSES.map(([label, tone, d]) => (
                <div className="row g-3" key={label}><Badge tone={tone} dot lg>{label}</Badge><span className="t-xs t-muted grow">{d}</span></div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="grid" title="Buttons and controls">
          <div className="col g-5">
            <div>
              <div className="eyebrow mb-3">Buttons</div>
              <div className="row g-3 wrap">
                <Button variant="primary">Primary</Button>
                <Button variant="amber">Amber</Button>
                <Button variant="teal">Teal</Button>
                <Button>Ghost</Button>
                <Button variant="quiet">Quiet</Button>
                <Button variant="danger">Danger</Button>
                <Button icon="download">With icon</Button>
                <Button icon="more" aria-label="More" />
                <Button loading>Loading</Button>
                <Button disabled>Disabled</Button>
              </div>
            </div>
            <div>
              <div className="eyebrow mb-3">Inputs</div>
              <div className="grid g-4col g-3">
                <TextField label="Text input" placeholder="Placeholder" value={text} onChange={setText} />
                <SelectField label="Select" value={sel} onChange={setSel} options={['Option one', 'Option two']} />
                <div className="field">
                  <span className="label">Toggle and checkbox</span>
                  <div className="row g-4" style={{ height: 38 }}>
                    <Switch checked={sw} onChange={setSw} label={sw ? 'On' : 'Off'} />
                    <Checkbox checked={check} onChange={setCheck} label="Enabled" />
                  </div>
                </div>
                <div className="field">
                  <span className="label">Segmented</span>
                  <div style={{ height: 38, display: 'flex', alignItems: 'center' }}>
                    <Segment items={[{ id: 'a', label: 'Day' }, { id: 'b', label: 'Week' }, { id: 'c', label: 'Term' }]} active={seg} onChange={setSeg} />
                  </div>
                </div>
                <TextField label="With validation error" value="" onChange={() => undefined} error="This field is required" required />
              </div>
            </div>
            <div>
              <div className="eyebrow mb-3">Progress and meters</div>
              <div className="grid g-3col g-4">
                <Meter label="Attendance" value={94} right="94%" tone="teal" />
                <Meter label="Collection" value={82} right="82.2%" tone="amber" />
                <Meter label="Coverage" value={41} right="41%" tone="critical" />
              </div>
            </div>
            <div>
              <div className="eyebrow mb-3">Workflow</div>
              <Flow steps={[{ label: 'Draft', state: 'done' }, { label: 'Submitted', state: 'done' }, { label: 'Under Review', state: 'active' }, { label: 'Approved' }, { label: 'Rejected' }]} />
            </div>
            <div>
              <div className="eyebrow mb-3">Stepper</div>
              <Stepper steps={['Signal', 'Review', 'Intervention', 'Action', 'Follow-up', 'Closed']} active={2} />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g-2col g-4 mt-4">
        <Card icon="grid" title="Data visualisation" sub="Every chart is inline SVG — no library, works offline, scales to any container">
          <div className="col g-5">
            <Chart svg={charts.line({ labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], series: [{ name: 'Attendance', values: [93, 94, 92, 94, 91], color: 'var(--teal)' }], yMin: 85, yMax: 100, height: 160 })} />
            <Chart svg={charts.bar({ labels: ['G3', 'G4', 'G5', 'G6'], series: [{ name: 'Students', values: [96, 98, 96, 99], color: 'var(--navy)' }], height: 150 })} />
            <div className="row g-5 wrap center">
              <Chart svg={charts.donut({ size: 130, thickness: 20, center: '82%', data: [{ label: 'a', value: 82, color: 'var(--teal)' }, { label: 'b', value: 18, color: 'var(--bg-sunken)' }] })} />
              <Chart svg={charts.gauge({ percent: 68, value: '68%', sub: 'Gauge', color: 'var(--amber)' })} />
              <Chart svg={charts.radar({ size: 170, axes: ['A', 'B', 'C', 'D', 'E'], series: [{ name: 's', values: [82, 74, 88, 64, 79], color: 'var(--navy)' }] })} />
            </div>
          </div>
        </Card>
        <Card icon="wallet" title="Cards, lists and feedback">
          <div className="col g-4">
            <Kpi icon="activity" label="KPI card" value="1,284" unit="students" tone="teal" delta={3.1} foot="With sparkline" spark={[8, 11, 9, 14, 12, 16]} />
            <AlertItem tone="critical" icon="alert" title="Attention row" meta="Used in Command Center and notifications" onClick={() => toast('Attention rows open the related screen', 'info')} />
            <Banner tone="warning" icon="info">Banner — context that applies to the whole screen.</Banner>
            <AiNotice />
            <div className="row g-3 wrap">
              <Button onClick={() => toast('This is a toast message', 'success')}>Show a toast</Button>
              <Button onClick={() => setModal(true)}>Open a modal</Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="grid" title="Responsive behaviour">
          <div className="grid g-3col g-4">
            {[
              ['Desktop', '1200px and above', 'Fixed left sidebar, top header, multi-column dashboards, wide data tables.', 'grid'],
              ['Tablet', '768 to 1199px', 'Sidebar collapses to an overlay drawer, cards drop to two columns, tables scroll.', 'layers'],
              ['Mobile', 'Below 768px', 'Bottom navigation, single-column cards, swipeable sections, 44px touch targets, tables become card lists.', 'home'],
            ].map(([t, w, d, ic]) => (
              <div className="card card--tint" style={{ padding: 16 }} key={t}>
                <div className="row g-2"><Icon name={ic} size={16} /><span className="t-sm t-bold">{t}</span></div>
                <div className="t-micro t-muted mt-1">{w}</div>
                <div className="t-xs mt-2">{d}</div>
              </div>
            ))}
          </div>
          <p className="t-xs t-muted mt-4">Parent and staff experiences are mobile-first: they are designed at 390px and expand, rather than the other way round.</p>
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="grid" title="Icon set" sub={`One stroke-based family at 24px (${iconNames.length} icons). No emoji is used as an interface icon anywhere.`}>
          <div className="row g-4 wrap">
            {iconNames.map((n) => (
              <span className="col center" style={{ width: 62, alignItems: 'center', gap: 5 }} title={n} key={n}>
                <span className="avatar none" style={{ background: 'var(--surface-alt)', color: 'var(--navy)' }}><Icon name={n} size={18} /></span>
                <span className="t-micro t-faint t-clip" style={{ maxWidth: 60 }}>{n}</span>
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Approval workflow" sub="The shared vocabulary every module uses"
        foot={<><Button onClick={() => setModal(false)}>Cancel</Button><Button variant="primary" icon="check" onClick={() => setModal(false)}>Got it</Button></>}>
        <Flow steps={[{ label: 'Draft', state: 'done' }, { label: 'Submitted', state: 'done' }, { label: 'Under Review', state: 'active' }, { label: 'Approved' }, { label: 'Rejected' }]} />
        <p className="t-sm mt-4">Every approval records who decided and when. Destructive or irreversible actions always ask for confirmation first.</p>
      </Modal>
    </Page>
  );
}
