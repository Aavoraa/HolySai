import { useRef, useState, type ReactNode } from 'react';
import { api } from '@/api/client';
import { useInvalidate } from '@/hooks/useApi';
import { Badge, Banner, Button, Card, DataTable, Empty, InlineError, Modal, errorMessage, useToast } from '@/components/ui';

export interface CsvImportResult {
  dryRun: boolean; rows: number; valid: number; failed: number; imported: number;
  results: { row: number; label: string; ok: boolean; errors?: { field: string; message: string }[] }[];
}

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Upload a CSV made from a downloadable template: "Check file" validates every row
 * without saving; "Import" saves. Servers reply with per-row results (see backend utils/csv.ts).
 */
export function CsvImportModal({ title, sub, help, endpoint, template, templateName, fields, labelHeading, invalidate, onClose }: {
  title: string; sub?: string; help: ReactNode;
  endpoint: string; template: string; templateName: string;
  /** Extra form fields sent with the file (e.g. campusId). */
  fields?: Record<string, string | undefined>;
  labelHeading: string;
  invalidate: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const refresh = useInvalidate();
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);

  const run = async (dryRun: boolean) => {
    if (!file) { setFileError('Choose the CSV file'); return; }
    if (!/\.csv$/i.test(file.name)) { setFileError('Save the spreadsheet as CSV first'); return; }
    if (file.size > 2 * 1024 * 1024) { setFileError('The file must be 2 MB or smaller'); return; }
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(fields ?? {})) if (v) fd.append(k, v);
    fd.append('dryRun', String(dryRun));
    setBusy(dryRun ? 'check' : 'import');
    setError(null);
    try {
      const r = await api.upload<CsvImportResult>(endpoint, fd, 300_000);
      setResult(r.data);
      toast(r.message, r.data.failed ? 'warning' : 'success');
      if (!dryRun && r.data.imported) await refresh(...invalidate);
    } catch (err) {
      setError(err);
    } finally { setBusy(null); }
  };

  const done = result && !result.dryRun && !result.failed;
  return (
    <Modal open onClose={onClose} size="wide" busy={!!busy} title={title} sub={sub}
      foot={<>
        <Button onClick={onClose} disabled={!!busy}>{done ? 'Done' : 'Cancel'}</Button>
        <Button icon="checkSquare" loading={busy === 'check'} disabled={!!busy} onClick={() => run(true)}>Check file</Button>
        <Button variant="primary" icon="upload" loading={busy === 'import'} disabled={!!busy || !!done} onClick={() => run(false)}>Import</Button>
      </>}>
      <div className="col g-4">
        {error ? <InlineError error={error} /> : null}
        <Banner icon="info"><span>{help}</span></Banner>
        <div className="row g-2 wrap">
          <Button size="sm" icon="download" onClick={() => api.download(template, templateName).catch((e) => toast(errorMessage(e), 'critical'))}>Download CSV template</Button>
        </div>
        <div className="field">
          <span className="label">CSV file<span className="req"> *</span></span>
          <div className="row g-2" style={{ alignItems: 'center' }}>
            <Button size="sm" icon="folder" onClick={() => ref.current?.click()}>{file ? 'Choose another' : 'Choose file'}</Button>
            <span className="t-sm t-clip">{file ? `${file.name} · ${size(file.size)}` : 'No file chosen'}</span>
          </div>
          <input ref={ref} type="file" accept=".csv,text/csv" hidden aria-label="CSV file"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setFileError(''); e.target.value = ''; }} />
          {fileError && <span className="field__error" role="alert">{fileError}</span>}
        </div>
        {result && (
          <Card flush title={result.dryRun || result.failed ? `Check: ${result.valid} of ${result.rows} rows ready` : `${result.imported} saved`}
            sub={!result.dryRun && result.failed ? 'Nothing was saved — fix the rows below and import again.' : undefined}>
            {result.results.length ? (
              <DataTable compact stack={false} rows={result.results} rowKey={(r) => String(r.row)}
                columns={[
                  { key: 'row', label: 'Row', className: 'num', render: (r) => r.row },
                  { key: 'label', label: labelHeading, render: (r) => r.label || '—' },
                  {
                    key: 'result', label: 'Result', render: (r) => r.ok
                      ? <Badge tone="success" icon="check">{result.dryRun ? 'Ready' : 'Saved'}</Badge>
                      : <span className="t-xs t-critical">{(r.errors ?? []).map((x) => (x.field ? `${x.field}: ${x.message}` : x.message)).join(' · ')}</span>,
                  },
                ]} />
            ) : <Empty title="No rows" />}
          </Card>
        )}
      </div>
    </Modal>
  );
}
