# Architecture

## Overview

```
┌──────────────────────┐   ┌───────────────────────┐   ┌─────────────────────┐
│ Web app (React 19)   │   │ Mobile apps (future)  │   │ Integrations        │
│ Vite · React Router  │   │ Flutter / React Native│   │ GPS units, gateways │
│ TanStack Query       │   │                       │   │                     │
└──────────┬───────────┘   └───────────┬───────────┘   └──────────┬──────────┘
           │  HTTPS · JSON · Bearer JWT (same endpoints for every client)   │
           ▼                           ▼                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Common REST API — Express 5 + TypeScript  (/api)                           │
│  helmet · CORS allow-list · rate limits · body sanitising · request ids    │
│  authenticate (JWT) → requirePermission (RBAC) → validate (Zod)            │
│  routes → controllers → services (business rules, data scope, audit)       │
│  notification outbox · document storage · OpenAPI (/api/docs)              │
└──────────────────────────────────┬─────────────────────────────────────────┘
                                   ▼
                     ┌───────────────────────────────┐
                     │ PostgreSQL                    │
                     │ normalised schema, FKs,       │
                     │ indexes, soft delete, audit   │
                     └───────────────────────────────┘
```

There is exactly one implementation of every business rule: the API. The web app holds
no business logic beyond presentation and client-side form validation (which the API
repeats). The mobile app will call the same endpoints — see [API.md](API.md).

## Backend

| Layer | Location | Responsibility |
|---|---|---|
| Config | `src/config` | Validated environment (`env.ts`, refuses weak secrets), pg pool with typed parsers, RBAC catalogue (`rbac.ts`) |
| Middleware | `src/middleware` | `authenticate`, `requirePermission` / `requireAny`, `validate(schema, source)`, rate limits, sanitising, centralised `errorHandler` |
| Routes | `src/routes/*.routes.ts` | One router per domain, mounted in `routes/index.ts` behind authentication. Every route declares a permission. |
| Controllers | `src/controllers` | HTTP concerns for the larger core modules (auth, students) |
| Services | `src/services` | SQL and business rules. `access.service.ts` owns **data scope** (school / class / family / self). `audit.service.ts`, `notification.service.ts`, `token.service.ts`, `documents.service.ts` are shared. |
| Validators | `src/validators` | Zod schemas; handlers read only validated input via `v(req)` |
| Utils | `src/utils` | Response envelope, `AppError` family, pagination + safe `ORDER BY`, `Where` builder (parameterised SQL), business code generator |

Request lifecycle: request id → security headers → CORS → JSON body (1 MB) → sanitise →
rate limit → `authenticate` (loads user, role, permissions, linked employee/parent/student)
→ route permission guard → Zod validation → service (scope + transaction + audit) →
envelope response. Any thrown error becomes `{ success:false, message, error }`; database
constraint violations map to 400/409; internals are never leaked in production.

## Frontend

- **Design system:** `src/styles` keeps the wireframe's class names and Holy Sai colour
  palette with a modern presentation: light shell (white sidebar, frosted top bar),
  Plus Jakarta Sans headings, Inter body text, rounded cards and soft shadows. All
  colours, radii and shadows are tokens in `tokens.css`; a dark theme is the same token set
  under `:root[data-theme="dark"]`.
- **Theme:** `src/theme/theme.ts` sets `data-theme` on `<html>`. The top-bar sun/moon button
  switches it and saves the choice in `localStorage` (`hs.theme`). With no saved choice the
  device setting is followed. A small inline script in `index.html` applies the theme
  before first paint so the page does not flash.
- **UI lab (development only):** `/__ui` renders the shell and component kit with static
  sample values for checking the look in light and dark. It calls no API and is not
  registered in production builds.
- **Components:** the wireframe's string
  builders (`HS.ui.*`) were re-implemented as React components with identical markup and
  class names (`src/components/ui`). Icons, charts and the i18n dictionaries are the
  wireframe's own code, ported as ES modules (`src/lib/legacy-*.ts`).
- **Shell:** `layouts/AppShell.tsx` reproduces the sidebar (collapsible groups, page finder,
  rail mode, drawer on tablets), top bar (campus & year selectors, global search, language,
  profile menu) and the mobile bottom navigation. `layouts/nav.ts` is the navigation model;
  items appear when the user holds the item's permission.
- **Routing:** `pages/registry.ts` merges per-domain route files; each route declares its
  permissions and is lazy-loaded. Unauthorised routes render the wireframe's access screen.
- **Data:** `api/client.ts` is the only HTTP client (envelope parsing, typed `ApiError`,
  timeouts, single-flight silent refresh). `hooks/useApi.ts` wraps TanStack Query;
  `useListParams` keeps search/filter/sort/page in the URL.
- **Maps:** Leaflet + OpenStreetMap tiles (`components/map/StudentMap.tsx`), no API key.
- **Session:** access token in memory only; refresh token in an httpOnly, SameSite=Strict
  cookie scoped to `/api/auth`.

## Cross-cutting

- **Campus scope:** the header selector (`SchoolContext`) passes `campusId` (or nothing for
  group view) to list and dashboard endpoints.
- **Notifications:** `notifyUsers/notifyRoles/notifyGuardians` write in-app notifications
  and queue WhatsApp/SMS/Email/Push rows in `notification_deliveries`. A dispatcher in
  `server.ts` sends only when provider credentials are configured (none are, by design).
- **Audit:** every write, plus reads of sensitive data (Student 360, locations, documents,
  audit trail itself), is recorded with user, role, IP, user agent and client type.
- **Sample data:** generated relative to "today" in Asia/Kolkata, so dashboards always
  look live. All sample GPS points are flagged `is_sample_data`.

## Why these choices

| Decision | Reason |
|---|---|
| Express 5 over NestJS | Small surface, native async error handling, easy for the team to read; layering is enforced by convention and folder structure. |
| Raw SQL (pg) over an ORM | Dashboards and scoped queries are aggregate-heavy; explicit SQL keeps them fast and reviewable. All values are parameterised. |
| SQL migration files | The schema is the contract between web, mobile and reporting; plain SQL is portable and reviewable. |
| Permission-based RBAC in the database | Roles can be tuned by an administrator without a deploy; the code checks permissions, not role names. |
| Opaque rotating refresh tokens | Revocable sessions, theft detection by reuse, per-device session listing. |
| Vite SPA over Next.js | The product is an authenticated application with no SEO surface; an SPA served as static files is simpler to host next to the API. |
