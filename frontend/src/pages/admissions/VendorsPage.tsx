import { useState, type FormEvent } from 'react';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Grid, Icon, Kpi, Page, PageHead, Pagination, SearchInput, SelectField, Status,
  TextField, TextArea, Toolbar,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { FormModal, useFieldErrors } from './LeadForms';
import { EMAIL_RE, PHONE_RE } from './shared';

interface Vendor {
  id: string; name: string; category: string; contactPerson: string | null; phone: string | null; email: string | null;
  contractStart: string | null; contractEnd: string | null; contractValue: number; status: string; daysToExpiry: number | null; renewalSoon: boolean;
}
interface Partner { id: string; name: string; partnerType: string; sinceYear: number | null; status: string; note: string | null }
interface Comm { id: string; channel: string; who: string; subject: string; status: string; recipients: number; occurredAt: string; leadCode: string | null; sentBy: string | null }
interface Summary { total: number; active: number; renewalDue: number; contractValue: number; partners: number }

const CHANNEL_ICON: Record<string, string> = { WhatsApp: 'message', Call: 'phone', Email: 'mail', SMS: 'message', Note: 'edit', 'In-app': 'bell' };
const monthYear = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '…');

export default function VendorsPage() {
  const { can } = useAuth();
  const manage = can('crm.manage');
  const s = useApiQuery<Summary>('/vendors/summary');
  const vl = useListParams({ sort: 'name' }, ['status']);
  const vendors = usePagedQuery<Vendor>('/vendors', { ...vl.query, pageSize: 10 });
  const partners = usePagedQuery<Partner>('/partners', { pageSize: 50 });
  const [comPage, setComPage] = useState(1);
  const [channel, setChannel] = useState('');
  const comms = usePagedQuery<Comm>(can('communication.read') ? '/crm/communications' : null, { page: comPage, pageSize: 10, channel: channel || undefined });
  const [vendor, setVendor] = useState<Vendor | 'new' | null>(null);
  const [partner, setPartner] = useState<Partner | 'new' | null>(null);
  const d = s.data;

  return (
    <Page>
      <PageHead title="Vendors & Partners" sub="Contracts, renewals and the relationships that keep the campus running."
        actions={manage && (
          <>
            <Button icon="plus" onClick={() => setPartner('new')}>Add partner</Button>
            <Button variant="primary" icon="plus" onClick={() => setVendor('new')}>Add vendor</Button>
          </>
        )} />
      {!s.error && (
        <Grid cols="g-4col" className="mb-4">
          <Kpi icon="briefcase" label="Active vendors" value={d?.active ?? '—'} tone="teal" loading={s.isLoading} foot={d ? `${d.total} on record` : undefined} onClick={() => vl.setFilter('status', 'Active')} />
          <Kpi icon="refresh" label="Renewals due" value={d?.renewalDue ?? '—'} tone="amber" loading={s.isLoading} foot="Marked due or ending within 90 days" onClick={() => vl.setFilter('status', 'Renewal due')} />
          <Kpi icon="rupee" label="Contract value" value={d ? fmt.money(d.contractValue, { compact: true }) : '—'} tone="info" loading={s.isLoading} foot="Active and renewing contracts" />
          <Kpi icon="building" label="Active partners" value={d?.partners ?? '—'} loading={s.isLoading} />
        </Grid>
      )}
      <div className="grid g-2col g-4">
        <Card icon="grid" title="Vendors" flush>
          <Toolbar>
            <SearchInput value={vl.q} onSearch={vl.setQ} placeholder="Search vendor or category" />
            <FilterSelect label="Status" value={vl.filters.status} onChange={(x) => vl.setFilter('status', x)} options={['Active', 'Renewal due', 'Expired', 'Suspended']} />
          </Toolbar>
          {vendors.error ? <ErrorState error={vendors.error} onRetry={() => vendors.refetch()} /> : (
            <DataTable rows={vendors.data?.rows} loading={vendors.isLoading || vendors.isPlaceholderData} rowKey={(r) => r.id} sort={vl.sort} onSort={vl.setSort}
              onRowClick={manage ? (r) => setVendor(r) : undefined} emptyText={vl.hasFilters ? 'No vendors match the current filters.' : 'No vendors yet. Add the contracts the campus relies on to track renewals.'}
              columns={[
                { key: 'name', label: 'Vendor', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.category}{r.contactPerson ? ` · ${r.contactPerson}` : ''}</div></> },
                {
                  key: 'contractEnd', label: 'Contract', render: (r) => (
                    <span className={r.renewalSoon ? 't-warning t-bold' : ''} title={r.daysToExpiry != null ? `${r.daysToExpiry} days to expiry` : undefined}>
                      {monthYear(r.contractStart)} – {monthYear(r.contractEnd)}
                    </span>
                  ),
                },
                { key: 'value', label: 'Value', className: 'num', render: (r) => fmt.money(r.contractValue, { compact: true }) },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'Active' ? 'success' : r.status === 'Renewal due' ? 'warning' : 'critical'}>{r.status}</Badge> },
              ]} />
          )}
          <Pagination meta={vendors.data?.meta} onPage={vl.setPage} />
        </Card>
        <Card icon="grid" title="Partners & institutions" flush>
          {partners.error ? <ErrorState error={partners.error} onRetry={() => partners.refetch()} /> : (
            <DataTable rows={partners.data?.rows} loading={partners.isLoading} rowKey={(r) => r.id}
              onRowClick={manage ? (r) => setPartner(r) : undefined} emptyText="No partners yet. Curriculum bodies, institutions and community partners appear here."
              columns={[
                { key: 'name', label: 'Partner', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.partnerType}{r.status !== 'Active' ? ` · ${r.status}` : ''}</div></> },
                { key: 'since', label: 'Since', className: 'num', render: (r) => r.sinceYear ?? '—' },
                { key: 'note', label: 'Current activity', render: (r) => <span className="t-xs">{r.note ?? '—'}</span> },
              ]} />
          )}
        </Card>
      </div>
      {can('communication.read') && (
        <div className="mt-4">
          <Card icon="bell" title="Communication history" sub="One timeline across parents, alumni, vendors and partners — WhatsApp, email, SMS, calls and notes" flush
            actions={<FilterSelect label="Channel" value={channel} onChange={(x) => { setChannel(x); setComPage(1); }} options={['WhatsApp', 'Call', 'Email', 'SMS', 'Note', 'In-app']} />}>
            {comms.error ? <ErrorState error={comms.error} onRetry={() => comms.refetch()} /> : (
              <DataTable rows={comms.data?.rows} loading={comms.isLoading || comms.isPlaceholderData} rowKey={(r) => r.id} emptyText="No communication recorded."
                columns={[
                  { key: 'channel', label: 'Channel', render: (r) => <span className="row g-2"><Icon name={CHANNEL_ICON[r.channel] ?? 'message'} size={15} className="t-muted" />{r.channel}</span> },
                  { key: 'who', label: 'With', render: (r) => <>{r.who}{r.leadCode && <div className="t-micro t-muted">{r.leadCode}</div>}</> },
                  { key: 'subject', label: 'Subject' },
                  { key: 'when', label: 'When', render: (r) => fmt.relative(r.occurredAt) },
                  { key: 'status', label: 'Outcome', render: (r) => <Status value={r.status} label={r.recipients > 1 ? `${r.status} · ${r.recipients} recipients` : undefined} /> },
                ]} />
            )}
            <Pagination meta={comms.data?.meta} onPage={setComPage} />
          </Card>
        </div>
      )}
      {vendor && <VendorModal vendor={vendor === 'new' ? null : vendor} onClose={() => setVendor(null)} />}
      {partner && <PartnerModal partner={partner === 'new' ? null : partner} onClose={() => setPartner(null)} />}
    </Page>
  );
}

function VendorModal({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const fe = useFieldErrors();
  const [v, setV] = useState({
    name: vendor?.name ?? '', category: vendor?.category ?? '', contactPerson: vendor?.contactPerson ?? '', phone: vendor?.phone ?? '',
    email: vendor?.email ?? '', contractStart: vendor?.contractStart ?? '', contractEnd: vendor?.contractEnd ?? '',
    contractValue: String(vendor?.contractValue ?? ''), status: vendor?.status ?? 'Active',
  });
  const set = (k: keyof typeof v, val: string) => { setV((s) => ({ ...s, [k]: val })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>>(vendor ? 'patch' : 'post', vendor ? `/vendors/${vendor.id}` : '/vendors', {
    invalidate: ['/vendors', '/partners'], error: false, onSuccess: onClose,
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const value = v.contractValue === '' ? 0 : Number(v.contractValue);
    if (v.name.trim().length < 2) e.name = 'Enter the vendor name';
    if (v.category.trim().length < 2) e.category = 'Enter a category';
    if (v.phone && !PHONE_RE.test(v.phone)) e.phone = 'Enter a valid phone number';
    if (v.email && !EMAIL_RE.test(v.email)) e.email = 'Enter a valid email';
    if (Number.isNaN(value) || value < 0) e.contractValue = 'Enter a valid amount';
    if (v.contractStart && v.contractEnd && v.contractEnd < v.contractStart) e.contractEnd = 'Contract end must be after the start';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    const opt = (x: string) => x.trim() || undefined;
    save.mutate({
      name: v.name.trim(), category: v.category.trim(), contactPerson: opt(v.contactPerson), phone: opt(v.phone), email: opt(v.email),
      contractStart: opt(v.contractStart), contractEnd: opt(v.contractEnd), contractValue: value, status: v.status,
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={vendor ? `Edit ${vendor.name}` : 'Add vendor'} onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors}
      submitLabel={vendor ? 'Save changes' : 'Add vendor'} formId="vendor-form" size="wide">
      <form id="vendor-form" onSubmit={submit} noValidate>
        <div className="formsection">
          <div className="formsection__title">Vendor</div>
          <div className="form-grid">
            <TextField label="Vendor name" required value={v.name} onChange={(x) => set('name', x)} error={fe.errors.name} maxLength={120} autoFocus />
            <TextField label="Category" required value={v.category} onChange={(x) => set('category', x)} error={fe.errors.category} maxLength={60} placeholder="e.g. Housekeeping" />
            <TextField label="Contact person" value={v.contactPerson} onChange={(x) => set('contactPerson', x)} maxLength={120} />
            <TextField label="Phone" type="tel" value={v.phone} onChange={(x) => set('phone', x)} error={fe.errors.phone} />
            <TextField label="Email" type="email" value={v.email} onChange={(x) => set('email', x)} error={fe.errors.email} />
            <SelectField label="Status" value={v.status} onChange={(x) => set('status', x)} options={['Active', 'Renewal due', 'Expired', 'Suspended']} />
          </div>
        </div>
        <div className="formsection">
          <div className="formsection__title">Contract</div>
          <div className="form-grid">
            <TextField label="Contract start" type="date" value={v.contractStart} onChange={(x) => set('contractStart', x)} error={fe.errors.contractStart} />
            <TextField label="Contract end" type="date" value={v.contractEnd} onChange={(x) => set('contractEnd', x)} error={fe.errors.contractEnd} hint="Renewals are flagged 90 days before" />
            <TextField label="Contract value (₹)" type="number" min={0} value={v.contractValue} onChange={(x) => set('contractValue', x)} error={fe.errors.contractValue} />
          </div>
        </div>
      </form>
    </FormModal>
  );
}

function PartnerModal({ partner, onClose }: { partner: Partner | null; onClose: () => void }) {
  const fe = useFieldErrors();
  const [v, setV] = useState({
    name: partner?.name ?? '', partnerType: partner?.partnerType ?? '', sinceYear: partner?.sinceYear ? String(partner.sinceYear) : '',
    status: partner?.status ?? 'Active', note: partner?.note ?? '',
  });
  const set = (k: keyof typeof v, val: string) => { setV((s) => ({ ...s, [k]: val })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>>(partner ? 'patch' : 'post', partner ? `/partners/${partner.id}` : '/partners', {
    invalidate: ['/partners', '/vendors'], error: false, onSuccess: onClose,
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const year = v.sinceYear ? Number(v.sinceYear) : undefined;
    if (v.name.trim().length < 2) e.name = 'Enter the partner name';
    if (v.partnerType.trim().length < 2) e.partnerType = 'Enter the partner type';
    if (year !== undefined && (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear())) e.sinceYear = 'Enter a valid year';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({ name: v.name.trim(), partnerType: v.partnerType.trim(), sinceYear: year, status: v.status, note: v.note.trim() || undefined }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={partner ? `Edit ${partner.name}` : 'Add partner'} onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors}
      submitLabel={partner ? 'Save changes' : 'Add partner'} formId="partner-form">
      <form id="partner-form" onSubmit={submit} noValidate className="form-grid">
        <TextField className="span-2" label="Name" required value={v.name} onChange={(x) => set('name', x)} error={fe.errors.name} maxLength={120} autoFocus />
        <SelectField label="Type" required value={v.partnerType} onChange={(x) => set('partnerType', x)} error={fe.errors.partnerType} placeholder="Select…"
          options={Array.from(new Set(['Curriculum authority', 'Institution', 'Partner', 'Community', v.partnerType].filter(Boolean)))} />
        <TextField label="Partner since" type="number" value={v.sinceYear} onChange={(x) => set('sinceYear', x)} error={fe.errors.sinceYear} />
        <SelectField label="Status" value={v.status} onChange={(x) => set('status', x)} options={['Active', 'Inactive']} />
        <TextArea className="span-2" label="Current activity" rows={2} value={v.note} onChange={(x) => set('note', x)} maxLength={300} />
      </form>
    </FormModal>
  );
}
