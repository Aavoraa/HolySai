import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon } from './primitives';

const ATTACH_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const ATTACH_MAX_MB = 10;
const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Compact one-row attachment: Browse (or drop) a PDF/photo; once chosen, a preview with
 * Change / Remove. Same allow-list and size limit as the API (documents.service, UPLOAD_MAX_MB).
 */
export function AttachField({ file, onFile, error, disabled, label = 'Attach a file', inputLabel = 'File to attach' }: {
  file: File | null; onFile: (f: File | null, error?: string) => void; error?: string; disabled?: boolean;
  /** Prompt shown before a file is chosen, e.g. "Attach the receipt". */ label?: string; inputLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const take = (f: File | undefined | null) => {
    if (!f) return;
    if (!ATTACH_TYPES.includes(f.type)) return onFile(null, 'Choose a PDF, JPG, PNG or WebP file');
    if (f.size > ATTACH_MAX_MB * 1024 * 1024) return onFile(null, `The file must be ${ATTACH_MAX_MB} MB or smaller`);
    onFile(f);
  };
  return (
    <div className="field">
      <div className="attachfield" data-over={over || undefined} data-error={error ? true : undefined} data-filled={file ? true : undefined}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files?.[0]); }}>
        {file ? (
          preview
            ? <img className="attachfield__thumb" src={preview} alt="" />
            : <span className="attachfield__ico"><Icon name="fileText" size={18} /></span>
        ) : <span className="attachfield__ico"><Icon name="upload" size={18} /></span>}
        <div className="col grow" style={{ minWidth: 0 }}>
          <span className="t-sm t-bold t-clip">{file ? file.name : label}</span>
          <span className="t-micro t-muted">{file ? `${file.type === 'application/pdf' ? 'PDF' : 'Image'} · ${fileSize(file.size)}` : `PDF, JPG, PNG or WebP · up to ${ATTACH_MAX_MB} MB · or drop it here`}</span>
        </div>
        {file ? (
          <div className="row g-1 none">
            <Button size="sm" variant="quiet" disabled={disabled} onClick={() => ref.current?.click()}>Change</Button>
            <Button size="sm" variant="quiet" icon="x" disabled={disabled} onClick={() => onFile(null)} aria-label="Remove file">Remove</Button>
          </div>
        ) : <Button size="sm" icon="folder" className="none" disabled={disabled} onClick={() => ref.current?.click()}>Browse</Button>}
        <input ref={ref} type="file" hidden accept={ATTACH_TYPES.join(',')} aria-label={inputLabel}
          onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {error && <span className="field__error" role="alert">{error}</span>}
    </div>
  );
}
