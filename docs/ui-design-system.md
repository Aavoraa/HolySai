# Holy Sai Smart School 360 — UI design system

How screens are built. Every colour comes from a token in
`frontend/src/styles/tokens.css`; the brand palette is not to be changed.

## Principles

Consistency first. Clarity second. Colour with purpose. No unnecessary decoration.

* **One brand colour** (`--brand`) for navigation, primary buttons, links, active states and icons.
* **Semantic colours only for meaning:** `--success` (on track, paid, present), `--accent` / `--warning`
  (attention, developing, late), `--critical` (overdue, at risk, absent, errors), `--caution`
  (half day, partial). Status is never shown by colour alone — always with a label or icon.
* **Neutral surfaces:** white cards on the light ground, 1px `--border`, one subtle elevation
  (`--sh-1`), 12px corners.
* No gradients, glows, per-module colours or decorative illustrations. The campus photo on the
  dashboards and the sign-in screen is the one deliberate image.

## Subtle hues (`styles/hues.css`)

A muted secondary palette used **only behind icons**, as a soft tint with a matching icon colour:
brand, blue, plum, sage, amber, teal, indigo, rose, terracotta, steel (`--hue-*`, `--hue-*-tint`,
with dark-theme equivalents). Any element with `data-hue="blue"` (etc.) exposes `--h` / `--h-tint`.

* Each module has a hue (`hue` in `layouts/nav.ts`): its sidebar icon chips, nested icons and the
  small tile beside every page title use it (Students brand, Admissions blue, Academics plum,
  Parent Experience rose, GPS & Safety terracotta, Finance sage, Staff amber, Operations steel,
  Intelligence teal, Group indigo).
* Untoned KPIs, card-header icon chips, quick actions, activity items and avatars rotate through
  the hues; event tags use one hue per event type.
* Semantic status colours always win: a KPI with `tone="critical"` stays red. Large surfaces,
  tables and text stay neutral. Never use a hue for status.

## Brand palette (from `tokens.css`)

| Token | Light | Use |
|---|---|---|
| `--brand` | `#8F0A40` Holy Sai Magenta | primary buttons, active navigation, focus, links, icons |
| `--brand-hover` | `#A3154F` | hover of brand surfaces |
| `--brand-strong` | `#6A0032` Wine | sidebar brand block |
| `--brand-tint`, `--brand-line` | rose tint / line | active nav, selected rows, icon tiles |
| `--accent` / `--accent-strong` | `#F0B020` / `#A87400` Gold | highlights, first-place marker, warnings |
| `--bg`, `--surface`, `--surface-alt` | `#F7F6F5` / white / `#F8F9FB` | page, cards, table heads |
| text | `#111529` / `#2D3748` / `#5B6475` | headings / body / muted |
| `--success --warning --caution --critical --neutral` | semantic | badges, alerts, chart bands |

The dark theme (`:root[data-theme="dark"]`) redefines the same tokens. Never hard-code a hex
value in a component; use a token.

## Where the styles live

`tokens.css` (values) → `base.css` (reset, type, utilities) → `components.css` (the component kit)
→ `layout.css` (application shell) → `responsive.css` → `app.css` (maps, QR) → `modules/*.css`
(module-only layouts) → **`system.css`** (the single design layer: shell refinements, cards, KPIs,
dashboard widgets, campus banner). Add shared rules to `components.css` or `system.css` —
never as another override file.

## Page anatomy

```
<Page>
  <PageHead title sub actions />      // breadcrumbs are automatic (from the sidebar)
  [KPI row]                           // ≤ 4 headline KPIs
  [filters / toolbar]
  [main content: cards, tables]
</Page>
```

* **One primary action** per page header (`variant="primary"`); others are default (ghost) buttons.
* `PageHead` derives "Section › Page" breadcrumbs from `layouts/nav.ts`. Pass `crumbs` only for
  records deeper than the menu (e.g. a project page), or `crumbs={false}` to hide them.
* The browser tab title is set automatically from the route.

## Shell

* **Sidebar:** wine brand block with the lotus logo; menu grouped under uppercase captions
  (`section` in `layouts/nav.ts`, display name `label`, direct links `quick`). Grey 18px icons,
  13.5px labels, 36px rows; the active page is a rose-tint pill with brand text. Nested items are
  indented with a hairline and 15px icons. Collapses to a 72px rail; a drawer below 1024px.
* **Top bar (64px):** search left; academic year, campus, alerts, theme and the user menu right.
  AI Assistant and language live in the user menu.

## Dashboards

* `<CampusBanner title sub actions />` first: greeting or page title, then the campus photo at its
  natural size (no overlay or zoom). Full width by default; `bleed={false}` for portal layouts
  (Parent 360, My Profile). To change the photo, replace `frontend/public/images/campus-hero.png`
  (at least 1600px wide recommended).
* Then `<DashLayout rail={<DashRail actions={…} />}>`: main column + right rail (Quick Actions,
  Recent Notifications, Upcoming Events). Quick actions are neutral; only an emergency action is red.
* Charts come from `components/ui/dashboardWidgets.tsx`: `SchoolPulse` for school-wide roles, or
  `TrendCard`, `DonutCard`, `RankCard` fed with role-scoped data. Line series use `--brand`; bands
  use success / accent / critical (+ caution or brand for a fourth band).

## Cards and KPIs

* `<Card icon title actions={<CardLink to="…">View all</CardLink>}>` — brand icon, 15.5px title.
* `<Kpi>` — `tone` (`teal` = success, `amber` = warning, `critical`, `info`), optional `icon`
  (shown in a tinted tile), `to` / `onClick` to link. Untoned KPIs use the brand tint.
* `size="hero"` for the 3–4 figures a page leads with. More than four figures: lead with ≤4,
  then `<div className="statgrid statgrid--card">` with `<Kpi size="compact">`. No orphan tiles.

## Tables

* `<Card flush>` → `<Toolbar>` (search + `FilterSelect`s + actions) → `<DataTable>` → `<Pagination>`.
* 11px uppercase headers, 11px cell padding, subtle hover; `DataTable` stacks into cards below 768px.
* Numeric columns use `className: 'num'` (right aligned, tabular figures).
* Row actions go in the last column as `size="sm"` buttons; destructive ones use `useConfirm()`.

## Forms

* `TextField`, `SelectField`, `TextArea`, `Checkbox` with `label`, `required`, `error`, `hint`.
* Group related fields: `<div className="formsection"><div className="formsection__title">Contact</div><div className="form-grid">…</div></div>`.
* Errors sit under their field (`error` prop). Submit buttons use `loading`.
* Disable submit while saving; close the modal and `toast()` on success; `InlineError` on failure.

## Records (profiles)

`.profilehead` → `__main` (avatar, `__id` with `__name`, `__meta`, `__facts`; `__actions`) and
`__stats` (a `<dl>` of 3–5 figures). Follow with `<div className="tabsbar"><Tabs …/></div>`
so tabs stay reachable while scrolling. See `pages/students/Student360Page.tsx`.

## Feedback

* Loading: `PageSkeleton` / `QueryState`; tables show skeleton rows.
* Empty: `<Empty icon title sub action>` — say what will appear and how to add it.
* Errors: `ErrorState` (with retry) for pages, `InlineError` inside forms.
* Destructive actions: `useConfirm({ danger: true })`.
* Success: `useToast()('Saved', 'success')`.

## Spacing and type

4-pt spacing tokens `--s-1 … --s-10`; page gutter `--page-x`. Control heights: `--control-h`
(38px) for buttons and form inputs, `--control-h-sm` (32px) for small buttons and every toolbar or
filter control. Type: `--fs-h1` 22px page and banner titles, 15.5px card titles, 13.5px body and
navigation, 11px table headers. Use the utility classes in `base.css` (`row`, `col`, `g-3`,
`grid g-2col`, `t-muted`, `t-num` …) before writing inline styles.

## Responsive

Desktop ≥ 1200px; tablet 768–1199px (sidebar becomes a drawer); mobile < 768px (bottom
navigation, stacked tables, 44px touch targets). Avoid fixed pixel widths on content; use
`minmax()` grids and `flex-wrap`.
