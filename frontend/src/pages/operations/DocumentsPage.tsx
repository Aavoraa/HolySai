import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Banner, Button, Card, DataTable, Empty, ErrorState, FilterSelect, Grid, Icon, Kpi, Modal, Page, PageHead, Pagination, SearchInput, SelectField,
  Status, StudentLink, Tabs, TextArea, TextField, Toolbar, errorMessage, useToast,
} from '@/components/ui';
import { api, ApiError } from '@/api/client';
import { useApiMutation, useApiQuery, useInvalidate, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { cx, fmt } from '@/lib/format';
import { CRITICAL_ROW, FormError, FormGrid, bytes, req, useForm } from './shared';

interface Summary { total: number; school: number; student: number; pendingVerification: number; awaitingUpload: number; rejected: number; expired: number; collections: number; storageBytes: number }
interface Collection { name: string; count: number; pending: number; files: number; updatedAt: string; owner: string | null }
interface SchoolDoc { id: string; name: string; category: string; collection: string | null; status: string; hasFile: boolean; originalName: string | null; sizeBytes: number | null; uploadedBy: string | null; updatedAt: string; verifiedBy: string | null }
interface PendingDoc { id: string; name: string; category: string; status: string; hasFile: boolean; requestedOn: string | null; updatedAt: string; uploadedBy: string | null; studentId: string; studentName: string; admissionNo: string; grade: string | null; section: string | null; campusName: string; waitingDays: number }

const CATEGORIES = ['Policy', 'Handbook', 'Contract', 'Certificate', 'Student record', 'Vehicle', 'Minutes', 'General'];
/** Days a student document may wait before it is flagged. */
const WAIT_LIMIT = 14;

export default function DocumentsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as 'sets' | 'queue') ?? 'sets';
  const openSet = sp.get('set');
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('documents.manage');
  const sum = useApiQuery<Summary>('/documents/summary', campusParam);
  const [upload, setUpload] = useState<string | null | false>(false);
  const setParam = (k: string, v: string | null) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k === 'tab') n.delete('page'); return n; }, { replace: true });
  const s = sum.data;
  return (
    <Page>
      <PageHead title="Documents" sub="Student files, employee files, policies and certificates — with verification status tracked per document."
        actions={manage && <Button variant="primary" icon="upload" onClick={() => setUpload(openSet)}>Upload</Button>} />
      {!!s?.expired && (
        <div className="mb-4">
          <Banner tone="critical" icon="alertCircle">
            <strong>{s.expired} document{s.expired === 1 ? ' has' : 's have'} expired.</strong> Expired documents are flagged in their sets — upload a current copy to replace them.
          </Banner>
        </div>
      )}
      <Grid cols="g-4col">
        <Kpi label="Documents on file" icon="fileText" value={fmt.n(s?.total)} loading={sum.isLoading} foot={s ? `${fmt.n(s.school)} school · ${fmt.n(s.student)} student` : undefined} />
        <Kpi label="Pending verification" icon="clock" value={fmt.n(s?.pendingVerification)} tone="amber" loading={sum.isLoading} onClick={() => setParam('tab', 'queue')}
          foot={s ? `${s.awaitingUpload} requested, not yet uploaded` : undefined} />
        <Kpi label="Expired or rejected" icon="alertCircle" value={fmt.n(s ? s.expired + s.rejected : undefined)} tone="critical" loading={sum.isLoading}
          foot={s ? `${fmt.n(s.expired)} expired · ${fmt.n(s.rejected)} rejected` : undefined} />
        <Kpi label="Storage used" icon="layers" value={bytes(s?.storageBytes)} tone="info" loading={sum.isLoading} foot={s ? `${s.collections} document sets` : undefined} />
      </Grid>
      <div className="tabsbar">
        <Tabs items={[{ id: 'sets', label: 'Document sets' }, { id: 'queue', label: 'Verification queue', count: s ? s.pendingVerification + s.awaitingUpload : undefined }]}
          active={tab} onChange={(t) => setParam('tab', t)} />
      </div>
      <div className="mt-4">
        {tab === 'sets'
          ? (openSet ? <SetDocuments name={openSet} onBack={() => setParam('set', null)} onUpload={() => setUpload(openSet)} />
            : <Sets onOpen={(n) => setParam('set', n)} onUpload={manage ? () => setUpload(null) : undefined} />)
          : <Queue />}
      </div>
      {upload !== false && <UploadModal collection={upload} onClose={() => setUpload(false)} />}
    </Page>
  );
}

function Sets({ onOpen, onUpload }: { onOpen: (name: string) => void; onUpload?: () => void }) {
  const [q, setQ] = useState('');
  const list = useApiQuery<Collection[]>('/documents/collections', { q: q || undefined });
  return (
    <Card icon="folder" title="Document sets" sub="Open a set to see its documents and their verification status." flush>
      <Toolbar>
        <SearchInput value={q} onSearch={setQ} placeholder="Search sets" />
      </Toolbar>
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.isLoading && list.data && !list.data.length && !q ? (
        <Empty icon="folder" title="No document sets yet"
          sub="Sets group school documents — policies, contracts, vehicle papers, minutes. Upload a document and name a new set to start one."
          action={onUpload ? <Button variant="primary" icon="upload" onClick={onUpload}>Upload a document</Button> : undefined} />
      ) : (
        <DataTable<Collection>
          rows={list.data} loading={list.isLoading} rowKey={(r) => r.name} onRowClick={(r) => onOpen(r.name)} emptyText="No document sets match your search."
          columns={[
            { key: 'name', label: 'Set', render: (r) => <span className="row g-3"><Icon name="folder" size={17} className="t-muted" /><span className="t-bold">{r.name}</span></span> },
            { key: 'count', label: 'Documents', className: 'num', render: (r) => <><span className="t-num">{fmt.n(r.count)}</span>
              {r.pending > 0 && <div className="t-micro t-warning">{r.pending} to verify</div>}</> },
            { key: 'owner', label: 'Owner', render: (r) => r.owner ?? <span className="t-faint">—</span> },
            { key: 'updated', label: 'Last updated', render: (r) => <span className="t-num">{fmt.date(r.updatedAt)}</span> },
            { key: 'a', label: '', className: 'num', render: (r) => <Button size="sm" iconRight="chevronRight" onClick={(e) => { e.stopPropagation(); onOpen(r.name); }}>Open</Button> },
          ]}
        />
      )}
    </Card>
  );
}

function useDownload() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return {
    busy,
    download: async (id: string, name: string) => {
      setBusy(id);
      try { await api.download(`/documents/${id}/download`, name); } catch (e) { toast(errorMessage(e), 'critical'); } finally { setBusy(null); }
    },
  };
}

function VerifyButtons({ id, name, invalidate }: { id: string; name: string; invalidate: string[] }) {
  const [reject, setReject] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const verify = useApiMutation<{ status: 'Verified' | 'Rejected'; note?: string }>('patch', `/documents/${id}/verify`,
    { invalidate, success: (_r, vars) => (vars.status === 'Verified' ? `“${name}” verified` : `“${name}” rejected — uploader notified`) });
  return (
    <>
      <Button size="sm" variant="teal" icon="check" loading={verify.isPending && verify.variables?.status === 'Verified'} onClick={() => verify.mutate({ status: 'Verified' })}>Verify</Button>
      <Button size="sm" variant="quiet" onClick={() => setReject(true)}>Reject</Button>
      <Modal open={reject} onClose={() => setReject(false)} title={`Reject "${name}"?`} sub="The uploader is notified with your reason." busy={verify.isPending}
        foot={<><Button onClick={() => setReject(false)}>Cancel</Button><Button variant="danger" loading={verify.isPending} onClick={async () => {
          if (!note.trim()) { setErr('Give a reason'); return; }
          try { await verify.mutateAsync({ status: 'Rejected', note: note.trim() }); setReject(false); } catch { /* toast shown */ }
        }}>Reject document</Button></>}>
        <TextArea label="Reason" required rows={3} maxLength={300} value={note} onChange={(x) => { setNote(x); setErr(''); }} error={err} />
        {reject && <FormError error={verify.error} />}
      </Modal>
    </>
  );
}

function SetDocuments({ name, onBack, onUpload }: { name: string; onBack: () => void; onUpload: () => void }) {
  const list = useListParams({ sort: 'updated', dir: 'desc' }, ['status']);
  const { can } = useAuth();
  const manage = can('documents.manage');
  const q = usePagedQuery<SchoolDoc>('/documents/school', { ...list.query, collection: name });
  const dl = useDownload();
  return (
    <Card title={<span className="row g-2"><Icon name="folder" size={17} />{name}</span>} flush
      actions={<>
        <Button size="sm" icon="arrowLeft" onClick={onBack}>All sets</Button>
        {manage && <Button size="sm" icon="upload" onClick={onUpload}>Upload to this set</Button>}
      </>}>
      <Toolbar>
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search documents" />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Submitted', 'Verified', 'Rejected', 'Expired']} />
        {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
      </Toolbar>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.isLoading && q.data && !q.data.rows.length && !list.hasFilters ? (
        <Empty icon="folder" title="This set is empty" sub="Documents uploaded to this set appear here with their verification status."
          action={manage ? <Button variant="primary" icon="upload" onClick={onUpload}>Upload to this set</Button> : undefined} />
      ) : (
        <DataTable<SchoolDoc>
          rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort} emptyText="No documents in this set match the current filters."
          rowClassName={(r) => (r.status === 'Expired' ? CRITICAL_ROW : undefined)}
          columns={[
            { key: 'name', label: 'Document', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.category}{r.originalName ? ` · ${r.originalName}` : ''}</div></> },
            { key: 'status', label: 'Status', render: (r) => <Status value={r.status} dot={r.status === 'Expired'} /> },
            { key: 'size', label: 'File', className: 'num', render: (r) => r.hasFile ? <span className="t-num">{bytes(r.sizeBytes)}</span> : <span className="t-faint">Record only</span> },
            { key: 'updated', label: 'Updated', render: (r) => <><span className="t-num">{fmt.date(r.updatedAt)}</span><div className="t-micro t-muted">{r.uploadedBy ?? ''}</div></> },
            { key: 'a', label: '', sortable: false, className: 'num', render: (r) => (
              <div className="row g-2 end wrap">
                {r.hasFile && <Button size="sm" icon="download" loading={dl.busy === r.id} onClick={() => dl.download(r.id, r.originalName ?? r.name)}>Download</Button>}
                {manage && r.status === 'Submitted' && <VerifyButtons id={r.id} name={r.name} invalidate={['/documents']} />}
              </div>
            ) },
          ]}
        />
      )}
      <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
    </Card>
  );
}

function Queue() {
  const list = useListParams({ sort: 'waiting' }, ['status']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const q = usePagedQuery<PendingDoc>('/documents/pending', { ...list.query, ...campusParam });
  const dl = useDownload();
  return (
    <Card icon="checkSquare" title="Student documents awaiting action" sub="Uploaded files waiting for verification appear first, then requests parents have not fulfilled yet." flush>
      <Toolbar>
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student or document" />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)}
          options={[{ value: 'Submitted', label: 'Uploaded — verify' }, { value: 'Pending', label: 'Requested — not uploaded' }]} />
        {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
      </Toolbar>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.isLoading && q.data && !q.data.rows.length && !list.hasFilters ? (
        <Empty icon="check" title="Nothing waiting" sub="Every student document in your scope is verified. New uploads and parent requests will appear here." />
      ) : (
        <DataTable<PendingDoc>
          rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} emptyText="No documents match the current filters."
          rowClassName={(r) => (r.waitingDays > WAIT_LIMIT ? CRITICAL_ROW : undefined)}
          columns={[
            { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.admissionNo} · ${r.grade ?? ''}${r.section ?? ''} · ${r.campusName}`} /> },
            { key: 'name', label: 'Document', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.category}</div></> },
            { key: 'status', label: 'Status', render: (r) => <Status value={r.status} label={r.status === 'Submitted' ? 'Uploaded' : 'Requested'} /> },
            { key: 'waiting', label: 'Waiting', className: 'num', render: (r) => (
              <span className={cx('t-num', r.waitingDays > WAIT_LIMIT && 't-critical t-bold')}>{r.waitingDays} day{r.waitingDays === 1 ? '' : 's'}</span>
            ) },
            { key: 'a', label: '', className: 'num', render: (r) => (
              <div className="row g-2 end wrap">
                {r.hasFile && <Button size="sm" icon="download" loading={dl.busy === r.id} onClick={() => dl.download(r.id, r.name)}>Download</Button>}
                {can('documents.manage') && r.status === 'Submitted' && <VerifyButtons id={r.id} name={r.name} invalidate={['/documents']} />}
              </div>
            ) },
          ]}
        />
      )}
      <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
    </Card>
  );
}

const MAX_MB = 10;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx';

function UploadModal({ collection, onClose }: { collection: string | null; onClose: () => void }) {
  const sets = useApiQuery<Collection[]>('/documents/collections');
  const toast = useToast();
  const invalidate = useInvalidate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const f = useForm({ name: '', category: 'General', collection: collection ?? '', newCollection: '' });
  const v = f.values;
  const target = v.collection === '__new' ? v.newCollection.trim() : v.collection;
  const submit = async () => {
    if (!f.validate({
      file: !file ? 'Choose a file' : file.size > MAX_MB * 1024 * 1024 ? `Files must be ${MAX_MB} MB or smaller` : null,
      name: req(v.name, 'Name') ?? (v.name.trim().length < 2 ? 'Name is too short' : null),
      collection: !target ? 'Choose or name a document set' : null,
    })) return;
    const form = new FormData();
    form.append('file', file!);
    form.append('name', v.name.trim());
    form.append('category', v.category);
    form.append('collection', target);
    setBusy(true);
    setError(null);
    try {
      await api.upload('/documents', form);
      toast('Document uploaded — awaiting verification');
      await invalidate('/documents');
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.details?.length) f.setErrors(e.fieldErrors);
      setError(e);
      toast(errorMessage(e), 'critical');
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Upload a school document" sub="Files are stored privately and only served to signed-in staff with document access." busy={busy}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="upload" loading={busy} onClick={submit}>Upload</Button></>}>
      <div className="field">
        <span className="label">File<span className="req"> *</span></span>
        <input ref={fileRef} type="file" accept={ACCEPT} aria-label="File" className="input" style={{ paddingTop: 6 }} aria-invalid={!!f.errors.file || undefined}
          onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !v.name) f.set('name', x.name.replace(/\.[^.]+$/, '')); f.setErrors({ ...f.errors, file: '' }); }} />
        {f.errors.file ? <span className="hint t-critical" role="alert">{f.errors.file}</span>
          : <span className="hint">PDF, image, Word or Excel · up to {MAX_MB} MB{file ? ` · ${bytes(file.size)}` : ''}</span>}
      </div>
      <div className="mt-3">
        <FormGrid>
          <TextField label="Document name" required value={v.name} maxLength={160} onChange={(x) => f.set('name', x)} error={f.errors.name} />
          <SelectField label="Category" value={v.category} onChange={(x) => f.set('category', x)} options={CATEGORIES} />
          <SelectField label="Document set" required value={v.collection} onChange={(x) => f.set('collection', x)} error={f.errors.collection}
            placeholder="Choose…" options={[...(sets.data ?? []).filter((s) => s.name !== 'Unfiled').map((s) => s.name), { value: '__new', label: 'New set…' }]} />
          {v.collection === '__new' && <TextField label="New set name" required value={v.newCollection} maxLength={80} onChange={(x) => f.set('newCollection', x)} />}
        </FormGrid>
      </div>
      <FormError error={error} />
    </Modal>
  );
}
