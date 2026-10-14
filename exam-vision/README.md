# EXAM Vision — AI Paper Correction with Claude

Claude reads handwritten answer sheets and marks them against teacher rubrics; teachers stay in
control of every final mark. No local GPU, models or Vision API are needed — only internet
access to Claude. (The original EXAM module, which reads with our own Vision AI, is unchanged
in `D:\vision API\EXAM`, port 8004.)

## As the Holy Sai "Paper Correction" module

This folder is the AI marking service behind **Academics → Paper Correction** in Holy Sai
Smart School 360. In that setup:

- Holy Sai signs users in and forwards their requests through `/api/exam-correction/api/*`,
  signed with HMAC-SHA256 (`EXAM_VISION_SECRET` in Holy Sai = `EXAM_GATEWAY_SECRET` here).
  Local sign-in, user and student management are switched off (`/api/auth/*` → 404).
- Roles come from Holy Sai permissions: `settings.manage` → admin, other school-level
  `assessments.manage` → coordinator, class-level (teachers) → teacher.
- Holy Sai pushes active students (admission number, class as `Grade 5 · GDV`, section, roll)
  and marking staff to `POST /api/integration/sync`.
- Approved totals go back into a Holy Sai assessment (`POST /api/exam-correction/exams/{id}/push-marks`).
- `npm run dev` in the project folder starts this service when `EXAM_VISION_URL` points at
  this machine. See HOW-TO-RUN.txt, section G.

The steps below run it **on its own** (no `EXAM_GATEWAY_SECRET`).

## Start (standalone)

1. Double-click `start-exam-vision.bat` → **http://localhost:8006** opens.
2. First visit: create the administrator account.
3. Settings → AI Configuration: the Claude key and the external-processing acknowledgement
   were copied from EXAM. Click **Test reading model** / **Read a sample page** to check.
4. Add teachers (Settings → Users) and assign them to exams.

## How a sheet is processed

1. Upload a PDF or page photos (one student) or bulk-upload files named with admission numbers.
2. Claude reads **all pages in one request** together with the exam's question list and
   returns each answer already matched to its question (numbers, topic headings, unnumbered
   answers, answers continuing on the next page), the name written on the sheet, and any
   writing that belongs to no question.
3. Claude marks each answer against the rubric; the code checks every mark (limits, steps,
   totals, quoted evidence, numerical answers).
4. The teacher confirms the student, checks flagged transcriptions and suggestions, and approves.

The name on the sheet is only a check ("matches" / "differs"); the student is always the one
chosen at upload.

## Models and cost

Settings → AI Configuration: Claude Opus 5.5 (default, most accurate) or Claude Sonnet 5.5
(about half the cost), chosen separately for reading and marking. Each sheet shows its
token usage and estimated cost. Measured on the demo sheets with Opus 5.5: reading
about $0.03–0.05 per sheet, marking about $0.015 per answer; a 1-page, 4-question sheet
≈ $0.09.

## Demo

A demo exam *Unit Test 1 — Science (demo)* with rubrics and three students is loaded;
`sample-answer-sheets/` holds their dummy sheets (A1001.pdf, A1002.pdf, A1003.pdf) and the
teacher key in `ground_truth.json`.

## Folders

| Path | |
|---|---|
| `backend/app` | FastAPI application |
| `backend/static` | web UI |
| `backend/tests` | 37 automated tests (Claude faked): `.venv\Scripts\python.exe -m pytest tests -q` |
| `backend/tools` | `benchmark_claude`, `seed_demo`, `make_dummy_sheets`, `reset_password` |
| `backend/data` | database, page images, encryption key — back up, keep private |
| `benchmarks` | benchmark results |
| `docs/ai-paper-correction` | architecture, API, plan, testing |

## Benchmark (spends Claude credit, ≈ $0.30)

```
cd backend
.venv\Scripts\python.exe -m tools.benchmark_claude
```
