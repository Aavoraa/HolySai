# Assumptions and decisions

Where the brief or the wireframe was silent or ambiguous, these choices were made.

## Product

| Topic | Decision |
|---|---|
| Wireframe roles vs brief roles | The wireframe's five sign-in roles are kept (Management = Principal, Teacher, Parent, Office, Non-Teaching Staff). The brief's extra roles (Super Admin, School Admin, Management/trustee, HR, Finance, Student) were added. Permissions, not role names, drive access. |
| Student role | Students see only their own Student 360 ("My Profile"), notifications and tasks. |
| Student IDs | The wireframe's `HS-YYYY-NNNN` admission numbers are used (the brief's `STU001` was an example). APIs accept the UUID or the admission number. |
| The brief's example student | "Aarav Kumar" was added as HS-2026-1091 at the Vadavalli (Coimbatore) campus with the exact coordinates and history from the brief. |
| Wireframe statistics | Hard-coded wireframe figures (e.g. 1,284 students) are not reproduced; every number is computed from the database. The sample data is smaller (about 300 students, at least 5 in every class section), so figures are smaller. |
| Cards with no data source | Where a wireframe card had no possible data source (e.g. "staff trained 96%", "payslips downloaded", Parent NPS on some screens), it was replaced with the closest computable measure. |
| Next.js vs React | A Vite React SPA was chosen (see ARCHITECTURE.md). Every screen is behind sign-in, so server rendering adds no value. |
| Languages | English, Tamil and Hindi dictionaries from the wireframe are used for interface chrome; data stays in English, as in the wireframe. |

## Tracking

| Topic | Decision |
|---|---|
| Who sees history | Staff with `tracking.history` (Super Admin, School Admin, Management, Principal). Parents see their own child's last 7 days. Teachers and Office see current locations only. |
| Teachers | May see current locations of students in their assigned sections (the brief lists teachers as "assigned students/classes"). |
| Staleness | 30 minutes without an update → "Offline / last known". Configurable in `system_settings`. |
| Home detection | Uses the student's bus stop (250 m) until per-student home geofences are registered. |
| Parent notifications | Sent on campus arrival and departure only, not for every GPS point. |
| Consent | Stored on the tracking profile; the sample data records the primary guardian's consent at the start of the year. Parents can only see a child when `can_view_tracking` is true. |

## Integrations deliberately not implemented

No credentials were provided, so these are ready but inactive:

- **WhatsApp / SMS / Email / Push** — queued in `notification_deliveries`; the dispatcher sends nothing until provider credentials and adapters are added.
- **Payment gateway** — parent payments are simulated (`SIM-…` reference, clearly labelled); the payment rule, receipts and allocation are real.
- **AI (Co-Pilot, Knowledge AI)** — deterministic, template/retrieval-based drafts from school data behind a provider interface; every output goes through Review → Edit → Approve.
- **Map tiles** — OpenStreetMap (no key). A commercial provider can be configured with `MAP_TILE_URL` / `MAP_API_KEY`.
- **GPS hardware** — devices post to the documented endpoint; sample data stands in for them.
- **OTP delivery** — pickup codes are shown on screen in development only (`devCode`).

## Technical

| Topic | Decision |
|---|---|
| Timezone | Asia/Kolkata for all "today" logic; timestamps stored as `timestamptz`. |
| Money | INR, `numeric(14,2)`. |
| Soft delete | Students, parents, employees, users, enquiries, documents, assets. Transactions (payments, attendance, locations, audit) are never deleted by the application. |
| Sample data dates | Generated relative to the day the seed runs, so the demo always looks current. Nothing that "already happened" is dated in the future. |
| Tax on payslips | A simplified slab (documented in the workforce service) — replace with the statutory calculation before real payroll. |
| Rate limiting | In-memory store (single instance). Use a shared store if you run several API instances. |
