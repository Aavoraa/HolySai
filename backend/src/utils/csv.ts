import type { Response } from 'express';
import multer from 'multer';
import { badRequest } from './errors.js';

/** RFC 4180 CSV → rows of strings (quoted fields, escaped quotes, CRLF/LF). Blank rows are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A CSV document from a header row and example rows. */
export function csvDocument(columns: readonly string[], rows: Partial<Record<string, string>>[]) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c] ?? '')).join(','))].join('\r\n') + '\r\n';
}

/** Sends a CSV download (with a BOM so Excel reads it as UTF-8). */
export function sendCsv(res: Response, filename: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`﻿${body}`);
}

/** Multer for one CSV file held in memory (2 MB). `what` names the file in the error message. */
export function csvUpload(what: string) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => {
      const okType = /\.csv$/i.test(file.originalname) && ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'].includes(file.mimetype);
      if (!okType) return cb(badRequest(`Upload the ${what} as a .csv file (save the spreadsheet as CSV)`, 'UNSUPPORTED_FILE_TYPE'));
      cb(null, true);
    },
  });
}

/**
 * Reads an uploaded CSV into header-keyed records. Checks the header against the
 * known and required columns and caps the row count.
 */
export function readCsvRecords(file: Express.Multer.File | undefined, opts: { columns: readonly string[]; required: readonly string[]; maxRows: number; what: string }) {
  if (!file) throw badRequest('Attach the CSV in the "file" field', 'FILE_REQUIRED', [{ field: 'file', message: 'Choose a CSV file' }]);
  const rows = parseCsv(file.buffer.toString('utf8'));
  if (rows.length < 2) throw badRequest(`The file has no data rows — download the template and add one row per ${opts.what}`, 'EMPTY_IMPORT');
  const header = rows[0].map((h) => h.trim());
  const unknown = header.filter((h) => h && !opts.columns.includes(h));
  if (unknown.length) throw badRequest(`Unknown column${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`, 'IMPORT_COLUMNS');
  for (const col of opts.required) {
    if (!header.includes(col)) throw badRequest(`Missing required column "${col}"`, 'IMPORT_COLUMNS');
  }
  const data = rows.slice(1);
  if (data.length > opts.maxRows) throw badRequest(`Import up to ${opts.maxRows} rows at a time`, 'IMPORT_TOO_LARGE');
  return data.map((cells, i) => {
    const rec: Record<string, string> = {};
    header.forEach((h, k) => { if (h) rec[h] = (cells[k] ?? '').trim(); });
    return { row: i + 2, rec }; // spreadsheet row number (header is row 1)
  });
}

export interface ImportRowResult { row: number; label: string; ok: boolean; errors?: { field: string; message: string }[] }
