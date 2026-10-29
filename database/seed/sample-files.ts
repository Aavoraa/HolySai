/**
 * SAMPLE files for student documents: a one-page PDF per document that has been
 * received (Verified, Submitted or Rejected), clearly marked as sample data, so
 * "View" and "Download" work in development. Documents still Pending (requested
 * from the family, not received) keep no file. Idempotent: only documents
 * without a file are touched.
 */
import crypto from 'node:crypto';
import type { Db } from './context.js';
import { putObject } from '../../backend/src/services/storage.service.js';

/** Helvetica in a PDF only covers Latin-1 well; keep text plain ASCII. */
const ascii = (s: string) => s.replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, '');
const pdfText = (s: string) => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** A minimal, valid single-page A4 PDF with a title, label/value rows and a SAMPLE watermark. */
export function samplePdf(title: string, rows: [string, string][], footer: string): Buffer {
  const t = (x: number, y: number, size: number, bold: boolean, s: string) => `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfText(s)}) Tj ET`;
  const lines = [
    // Watermark: large light-grey "SAMPLE" across the page
    'q 0.92 g BT /F2 110 Tf 0.7071 0.7071 -0.7071 0.7071 150 260 Tm (SAMPLE) Tj ET Q',
    // Border and header band
    'q 0.55 0.07 0.25 RG 2 w 36 36 523 770 re S Q',
    'q 0.55 0.07 0.25 rg 36 736 523 70 re f Q',
    'q 1 g', t(56, 778, 18, true, 'Holy Sai International School'), t(56, 758, 10, false, 'SAMPLE DOCUMENT - for demonstration only'), 'Q',
    t(56, 690, 20, true, title),
    ...rows.flatMap(([k, v], i) => [t(56, 640 - i * 28, 11, true, k), t(220, 640 - i * 28, 11, false, v)]),
    'q 0.4 g', t(56, 70, 9, false, footer), 'Q',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** Attaches a SAMPLE PDF to every received student document that has no file. Returns how many were attached. */
export async function attachStudentDocumentFiles(db: Db) {
  const docs = (await db.query(
    `SELECT d.id, d.name, d.category, d.status, d.created_at, s.full_name, s.admission_no, s.date_of_birth,
            COALESCE(c.name || ' ' || sec.name, '') AS class
       FROM documents d JOIN students s ON s.id = d.student_id
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
      WHERE d.deleted_at IS NULL AND d.storage_key IS NULL AND d.status IN ('Verified', 'Submitted', 'Rejected')
      ORDER BY d.created_at`,
  )).rows as { id: string; name: string; category: string; status: string; created_at: Date; full_name: string; admission_no: string; date_of_birth: Date | null; class: string }[];
  for (const d of docs) {
    const pdf = samplePdf(d.name, [
      ['Student', d.full_name],
      ['Admission no.', d.admission_no],
      ['Class', d.class || '-'],
      ...(d.date_of_birth ? [['Date of birth', fmtDate(d.date_of_birth)] as [string, string]] : []),
      ['Document type', d.category],
      ['Issued', fmtDate(d.created_at)],
      ['Reference', `HS-DOC-${d.id.slice(0, 8).toUpperCase()}`],
    ], 'Generated sample data. This is not a real certificate or record and has no legal value.');
    const file = `${d.name.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')}_${d.admission_no}.pdf`;
    // Named by student and document, not the row id, so re-seeding overwrites instead of piling up files.
    const key = `sample-documents/${file}`;
    await putObject(key, pdf, 'application/pdf');
    await db.query(
      `UPDATE documents SET storage_key = $2, original_name = $3, mime_type = 'application/pdf', size_bytes = $4, checksum_sha256 = $5
        WHERE id = $1 AND storage_key IS NULL`,
      [d.id, key, file, pdf.length, crypto.createHash('sha256').update(pdf).digest('hex')]);
  }
  return docs.length;
}
