# Holy Sai Smart School 360

A full-stack school management platform for Holy Sai International School, built from
the approved clickable wireframe (`wireframe/`). One **common REST API** serves the web
application today and the mobile applications next; all data lives in **PostgreSQL**.

```
 React web app ─┐
                ├──►  Common REST API (Express 5, TypeScript)  ──►  Services  ──►  PostgreSQL
 Mobile apps  ──┘       auth · RBAC · validation · audit · notifications
```

Highlights: Student 360, **GPS student tracking** with interactive maps and location history,
Parent 360 portal (own children only), Command Center, admissions CRM, academics, finance,
workforce & payroll, safety & transport, operations, innovation lab, multi-campus group
management, **Paper Correction** (Claude reads handwritten answer sheets and suggests marks;
teachers approve), role-based access enforced on every API call, audit logging and OpenAPI docs.

> **Sample data.** Development databases are seeded with fictional records, including
> **generated GPS coordinates**. No record is a real person, transaction or location.

---

## Quick start (local development)

Prerequisites: **Node.js 20+** and **PostgreSQL 15+**.

```bash
npm install
```

Create your environment file and fill in the database URL, two long random JWT secrets
and a demo password:

```bash
cp .env.example .env
```

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Create the database schema and load the sample data:

```bash
npm run db:reset
```

Start the API (http://localhost:4000) and the web app (http://localhost:5173):

```bash
npm run dev
```

API documentation (Swagger UI): http://localhost:4000/api/docs · raw spec: `/api/docs/openapi.json`.

### Don't want to touch your system PostgreSQL?

`scripts/local-db.mjs` creates a private cluster in `./.pgdata` on port 5544
(PostgreSQL binaries must be on `PATH`, or set `PG_BIN`):

```bash
LOCAL_PG_PASSWORD=choose-a-password node scripts/local-db.mjs init
```

Later: `npm run db:local:start` / `npm run db:local:stop`.

### Demo accounts

Every demo account uses the password in `SEED_DEMO_PASSWORD`. The sign-in screen lists them
(development builds only) — pick a role tile, then enter the password.

| Role | Email | Lands on |
|---|---|---|
| Principal (Management tile) | meera.krishnan.demo@holysai.edu | Command Center |
| Teacher | priya.raghavan.demo@holysai.edu | Teacher Dashboard |
| Parent (Aditya & Surya) | ranjith.kumar.demo@parents.holysai.edu | Parent 360 |
| Office | kavitha.s.demo@holysai.edu | Admissions |
| Non-teaching staff | murugan.p.demo@holysai.edu | Staff Self-Service |
| Super Admin | admin.demo@holysai.edu | Command Center |
| School Admin | anand.rao.demo@holysai.edu | Command Center |
| Management (trustee) | srinivasan.demo@holysai.edu | Command Center |
| HR | lakshmi.n.demo@holysai.edu | Workforce |
| Finance | rajesh.iyer.demo@holysai.edu | Fee Collection |
| Student | aditya.kumar.demo@students.holysai.edu | My Profile |
| Second parent (isolation testing) | sudha.raman.demo@parents.holysai.edu | Parent 360 |
| Second teacher | ganesh.venkat.demo@holysai.edu | Teacher Dashboard |

### The end-to-end flow

Login → Command Center → Students → Student 360 → **Student Tracking** tab (map, coordinates,
last update, history) → sign out → parent login → Parent 360 → choose child → **Track** →
live map and last 7 days of history. Staff use **Student Tracking** in the sidebar
(Student Management / Safety & Transport) for the school-wide map, filters and list.
The brief's example student, **Aarav Kumar (HS-2026-1091)**, sits at 11.0168, 76.9558 (Coimbatore)
with the 10:00 / 10:15 / 10:30 history points from the brief.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (watch) + web dev server |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Load sample data into an empty database |
| `npm run db:reset` | Drop, migrate and seed (refuses to run in production) |
| `npm run test:db` | Reset the separate **test** database |
| `npm test` | API integration & security tests (run `test:db` first) |
| `npm run test:screens` | Renders every screen for 8 roles against the running API and fails on crashes, error states or missing data (API must be running; dev rate limits must allow ~10k requests) |
| `npm run typecheck` | TypeScript checks for API and web |
| `npm run build` | Production builds (`backend/dist`, `frontend/dist`) |
| `npm run docs:schema --workspace backend` | Regenerate `docs/DATABASE.md` from the live schema |
| `npm start` | Run the built API |

---

## Repository layout

```
backend/            REST API (Express 5 + TypeScript)
  src/config/       env validation, database pool, RBAC definitions
  src/middleware/   authentication, permission guards, validation, security, errors
  src/routes/       one router per domain (mounted under /api)
  src/controllers/  request handlers for the larger core modules
  src/services/     business logic and SQL
  src/validators/   Zod request schemas
  src/utils/        response envelope, errors, pagination, SQL builder, codes
  scripts/          migrate / seed / reset
  tests/            integration & security tests (Vitest + Supertest)
frontend/           React 19 web app (Vite)
  src/api/          the HTTP client (token refresh, envelope, errors) and shared types
  src/auth/         session context
  src/components/   UI kit (ported 1:1 from the wireframe), maps, tracking panel
  src/layouts/      application shell, navigation model, campus/year context
  src/hooks/        data hooks (queries, mutations, URL-synced lists, lookups)
  src/pages/        screens, one folder per domain, each with a routes file
  src/styles/       design tokens (light + dark theme) and the component/layout styles
  src/theme/        theme switch (light/dark, remembered per browser)
database/
  migrations/       ordered SQL migrations (schema source of truth)
  seed/             sample data generators (relative to today's date)
docs/               architecture, database, security, tracking, deployment, mobile, OpenAPI
exam-vision/        Paper Correction service (Python/FastAPI): Claude reads and marks
                    handwritten answer sheets; reached only through the API (/api/exam-correction)
wireframe/          the approved prototype (UI reference)
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE.md)
- [Authentication, RBAC & security](docs/SECURITY.md)
- [Student tracking (staff, parent, admin)](docs/TRACKING.md)
- [API usage & mobile integration](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Module development guide](docs/MODULE-DEVELOPMENT.md)
- [Assumptions and decisions](docs/ASSUMPTIONS.md)
- OpenAPI: `docs/openapi/` (served at `/api/docs`)
