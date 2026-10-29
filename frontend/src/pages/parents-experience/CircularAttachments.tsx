import { useRef, useState } from 'react';
import { api } from '@/api/client';
import { Button, Icon, errorMessage, useToast } from '@/components/ui';
import { viewFile } from '../admissions/AdmissionForm';
import type { CircularAttachment } from './types';

// Same allow-list and limit the API enforces (documents.service, UPLOAD_MAX_MB).
export const MAX_ATTACHMENTS = 5;
const MAX_MB = 10;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export const bytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const iconFor = (mime: string) => (mime.startsWith('image/') ? 'camera' : 'fileText');

/**
 * Attachments while writing a circular: files already saved (removable) and newly
 * chosen ones, which upload only when the circular is saved.
 */
export function AttachmentPicker({ saved, removed, onRemoveSaved, pending, onPending, error, disabled }: {
  saved: CircularAttachment[]; removed: string[]; onRemoveSaved: (id: string) => void;
  pending: File[]; onPending: (files: File[]) => void; error?: string; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const kept = saved.filter((a) => !removed.includes(a.id));
  const room = MAX_ATTACHMENTS - kept.length - pending.length;

  const take = (list: FileList | null) => {
    if (!list?.length) return;
    const files = [...list];
    const bad = files.find((f) => !FILE_TYPES.includes(f.type)) ? 'Choose PDF, JPG, PNG or WebP files'
      : files.find((f) => f.size > MAX_MB * 1024 * 1024) ? `Each file must be ${MAX_MB} MB or smaller`
        : files.length > room ? `A circular can carry at most ${MAX_ATTACHMENTS} attachments` : null;
    setProblem(bad);
    if (!bad) onPending([...pending, ...files]);
  };

  return (
    <div className="field">
      <div className="col g-2">
        {kept.map((a) => (
          <AttachmentRow key={a.id} name={a.name} meta={bytes(a.sizeBytes)} icon={iconFor(a.mimeType)}
            end={<Button size="sm" variant="quiet" icon="x" disabled={disabled} onClick={() => onRemoveSaved(a.id)} aria-label={`Remove ${a.name}`}>Remove</Button>} />
        ))}
        {pending.map((f, i) => (
          <AttachmentRow key={`${f.name}-${i}`} name={f.name} meta={`${bytes(f.size)} · uploads when you save`} icon={iconFor(f.type)}
            end={<Button size="sm" variant="quiet" icon="x" disabled={disabled} onClick={() => onPending(pending.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</Button>} />
        ))}
        <div className="row g-3 wrap" style={{ alignItems: 'center' }}>
          <Button size="sm" icon="link" disabled={disabled || room <= 0} onClick={() => ref.current?.click()}>Add attachment</Button>
          <span className="t-micro t-muted">PDF, JPG, PNG or WebP · up to {MAX_MB} MB each · {MAX_ATTACHMENTS} files at most</span>
        </div>
      </div>
      <input ref={ref} type="file" multiple accept={ACCEPT} hidden aria-label="Attachment files" onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      {(problem || error) && <span className="field__error" role="alert">{problem ?? error}</span>}
    </div>
  );
}

/** Read-only list with View / Download. `base` is the circular's attachment path, e.g. /circulars/{id}/attachments. */
export function AttachmentList({ items, base }: { items: CircularAttachment[]; base: string }) {
  const toast = useToast();
  if (!items.length) return null;
  const fail = (e: unknown) => toast(errorMessage(e), 'critical');
  return (
    <div className="col g-2">
      <div className="eyebrow">Attachments</div>
      {items.map((a) => (
        <AttachmentRow key={a.id} name={a.name} meta={bytes(a.sizeBytes)} icon={iconFor(a.mimeType)}
          end={<>
            <Button size="sm" icon="eye" onClick={() => viewFile(`${base}/${a.id}/download`, fail)}>View</Button>
            <Button size="sm" variant="quiet" icon="download" onClick={() => api.download(`${base}/${a.id}/download`, a.name).catch(fail)}>Download</Button>
          </>} />
      ))}
    </div>
  );
}

function AttachmentRow({ name, meta, icon, end }: { name: string; meta: string; icon: string; end: React.ReactNode }) {
  return (
    <div className="row g-3" style={{ alignItems: 'center', padding: 'var(--s-2) var(--s-3)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <Icon name={icon} size={18} />
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="t-sm t-bold t-clip">{name}</span>
        <span className="t-micro t-muted">{meta}</span>
      </div>
      <div className="row g-2">{end}</div>
    </div>
  );
}
