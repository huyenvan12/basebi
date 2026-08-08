# base·bi Design System

Single source of truth for UI patterns. Derived from a full code-level audit (`AUDIT_UI_PATTERNS.md`, 2026-08-08) covering 99 existing component implementations and 35 flagged inconsistencies, plus a round of visual decisions made against the real app's dark-theme tokens.

Every new module or feature should build against this spec from day one. Existing modules are migrated module-by-module in separate PRs (see roadmap in memory / project notes) — this file does not imply the whole app already matches it.

---

## Foundational tokens (existing, unchanged)

- `--accent`: `#4f6fd9` (blue)
- Section/amber labels: `var(--amber)` (`#d9a94f`) — not green; green is reserved for positive/success states
- `--success`: `#4ade80` — canonical positive-state green. All "success" tints must derive from this token (e.g. `color-mix` or a documented `--success-dim`), never a separately hardcoded green.
- `--danger`: `#f87171` (dark theme) / `#dc2626` (light theme) — always reference `var(--danger)`, never hardcode `#f87171` inline (this was a real theming bug: inline hardcodes render the wrong red in light mode).
- Font: mono for IDs/numbers/code (PROC SQL/terminal aesthetic), sans-serif for content.
- Dark mono background, `--surface`/`--surface2` for elevated panels, `--border` for hairlines.

---

## 1. Navigation (previously approved)

Three tiers, distinguished by fill style so navigation and filtering are never visually confused:

- **L2 · Module Tabs** — top-level module switcher. Solid fill when active, always paired with an icon. Changes the content set entirely.
- **L3a · Sub Tabs** — nested navigation within a module (e.g. My Checklists / Shared with me). Same solid-fill language as L2, smaller size — because it's the same kind of action (navigation), it should look the same family.
- **L3b · Filter Group** — modifies the current view without navigating away (e.g. "Group by: Status/Due date/Priority"). Outline-only active state, with a label prefix ("Group by:") to signal it's a filter, not a destination.

**Implementation note (Phase 4, Delivery Tracker PR):** L3a's canonical shared class is `.subtab-l3a` (`basebi.css`), first extracted from Delivery Tracker's Timeline/Calendar/Tasks switcher (no visual change from the prior `.dt-subtab`). Recipe: `padding:6px 14px;font-size:11px;font-weight:500;color:var(--text-muted);background:var(--surface);border:1px solid var(--border);border-bottom:none;border-radius:6px 6px 0 0`, with `.active` set to `background:var(--accent-dim);color:var(--accent)`. Other modules with their own L3a sub-tab implementations (Notes/Team Shared, Checklist, Monitor Log) should migrate onto this same class in their own Phase 4 PRs rather than inventing per-module names. Note L2's active state still uses the `accent-dim` tint shown above, not genuinely solid fill (`background:var(--accent);color:#fff`) as this spec calls for — moving L2 to solid fill is out of scope for this PR and should happen in a future pass.

---

## 2. Section labels

Two intentional tiers (not one, not nine):

- **`.section-label`** — 11px, weight 600, letter-spacing `.6px`, uppercase, `color: var(--text-muted)`. Default for all section headers (sidebar labels, list titles, linked-notes headers, shortcut-panel labels, etc.)
- **`.section-label-sub`** — 9px, weight 700, letter-spacing `.7px`, uppercase, `color: var(--text-dim)`. Reserved for dense filter-bar contexts where space is tight (currently Campaign Log's filter label and field labels).

All letter-spacing values use `px` units consistently (retire the mixed `em`/`px` usage found in the audit). This retires: `.sidebar-label`, `.note-list-title`, `.checklist-group-label`, `.checklist-section-title`, `.shortcut-section-label`, `.linked-label`/`.popup-linked-label`, `.graph-link-list-title`, `.dt-agenda-day-label`, `.mob-section-label`, `.tp-header-stat-label`, `.camp-filter-label`, `.csp-field-label` — each maps to one of the two classes above.

Note: `.form-label` (modal field labels like "Title *") stays a separate concept — it is not a section header and should not be merged in.

---

## 3. Badges / status pills

Single convention: **`border-radius: 10px`** for every badge — type badges, status pills, priority pills, chips, feature-flag status, etc. Retires the 3px/4px/10px three-era split found in the audit.

Color semantics (fixes real inconsistencies found):
- All "positive/done/success" badges use `var(--success)` (or a token-derived tint) — never `#1f8a4c`, `#22c55e33`, or other one-off greens.
- All "warning/beta" badges use `var(--amber)` or `var(--sql)` consistently — never ad-hoc hex like `#f59e0b33`.
- `checklist-status-badge.is-done` must pair `--success` background *and* text (fix the current `--danger-dim` background + `--success` text mismatch).
- Any new categorical color (e.g. the `cb-event` teal) must be added to the `:root` token list rather than hardcoded inline.

---

## 4. Buttons

### Standard buttons
Keep `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-danger` as the base system. Anything currently reimplementing these standalone (`.login-run-btn`, `.graph-open-btn`, `.csp-edit-btn`/`.csp-del-btn`, `.ci-share-btn`) should be migrated to compose the base classes instead of redeclaring their own radius/padding/color.

`.btn-primary` hover state must use a token (not the current hardcoded `#4a7de0`).

### Icon-ghost buttons — two density tiers
- **`.icon-btn`** — 28×28px, `border-radius: 6px`, 1px border, transparent background, hover fills `var(--surface)`. Default for standalone icon actions (gear/settings, close, delete-row, edit).
- **`.icon-btn-sm`** — 24×22px, `border-radius: 5px`. Reserved for dense toolbars where multiple icon buttons sit side by side (e.g. note editor formatting bar).
- **`.icon-btn-lg`** — 34×34px, `border-radius: 8px`. Mobile-only, larger touch target per accessibility guidance.

This retires `.fmt-btn`, `.gear-btn`, `.mob-icon-btn`, and the various bare `background:none;border:none` ad-hoc icon buttons — each maps to one of the three classes above by context.

---

## 5. Toast / notification system

**New component — none existed before this spec.** Replaces `window.alert()` (currently ~40 call sites) as the mechanism for transient success/failure feedback.

- **Position**: fixed banner docked directly under the topbar, horizontally centered.
- **Behavior**: one notification visible at a time (no stacking). Success states auto-dismiss after a few seconds; error states can auto-dismiss too but should stay legible long enough to read (recommend ~4-5s, with a manual dismiss affordance).
- **Styling**: `background: var(--surface2)`, 1px border, rounded bottom corners only (`border-radius: 0 0 8px 8px`), left-edge accent stripe colored by state (`var(--success)` / `var(--danger)` / `var(--amber)` for warning).
- Class name: `.notification-banner` with modifiers `.is-success` / `.is-error` / `.is-warning`.
- Field-level validation errors (e.g. "Title already exists" inside the Note modal) are NOT routed through this component — see Modals section below; they render inline near the relevant field instead.
- Migration of the ~40 `alert()` call sites happens module-by-module in Phase 4, not all at once.

---

## 6. Form inputs

Three tiers:

- **`.form-input`** — canonical. `background: var(--bg)`, 1px border, `border-radius: 6px`, `padding: 8px 10px`. Used in modal/form fields.
- **`.form-input-compact`** — `background: var(--surface2)` (not `var(--bg)` — this is a deliberate fix, several compact variants had inconsistently used `var(--surface)`), `border-radius: 4px`, `padding: 5px 7px`, smaller font. Used for filter bars, inline-editable table cells, popover inputs, and any dense inline-add row. Retires `.camp-filter-input`, `.camp-add-input`, `.monitor-cell-input`, `.task-popover-input`, `.csp-add-extra-input` as separate classes — all map to this one.
- **`.form-input-search`** — `border: 2px solid var(--accent-dim)`, `border-radius: 10px`, larger font (13-15px). Formalizes the topbar search box and full-screen search input as an intentional, named tier (previously two separately-coded classes with no shared name).

Known bug to fix in the same pass: the dark-mode date-picker icon visibility fix (currently scoped only to `.task-popover-input[type="date"]`) must apply to every `type="date"` input in the app, not just one.

---

## 7. Modal / popover / confirm

Three tiers, organized by how much the UI is blocked — not by which module they live in:

- **`.modal`** — full backdrop (`rgba(0,0,0,.75)`). For forms and any confirmation that involves real data loss (delete note, delete ticket, delete checklist template, etc.) This is a deliberate fix: currently note-deletion uses a no-backdrop `.confirm-box` while ticket-overlap deletion uses a full modal, even though both are equally destructive. Under this spec, all destructive confirms use `.modal.modal-sm`.
- **`.note-popup`** — dimmed backdrop with blur (`rgba(0,0,0,.72)` + `blur(4-6px)`). For lightweight, non-form "preview" experiences that still warrant blocking background interaction — currently the search-result popup.
- **`.popover`** — no backdrop, fixed-position, anchored to a trigger element. For pickers, menus, and any lightweight non-destructive inline confirmation. This retires `.task-popover`, `.dt-type-picker-popover`, `.dt-cal-popover` as three separately-declared rulesets (all three redeclare an identical background/border/radius/shadow combo) — they become modifiers or direct uses of one shared `.popover` base. `.confirm-box` is also retired into `.popover` for any *non-destructive* inline confirmation; destructive ones move to `.modal` per above.

---

## 8. Tables

- **`.data-table`** — base class (current `.camp-table` recipe): sticky header (`position: sticky; top: 0`), sort-arrow affordance, row hover (`var(--surface2)`), active-row highlight with left accent border, `min-width: 860px` floor.
- **`.data-table-fixed`** — modifier adding `table-layout: fixed` + explicit column widths, for tables that need fixed columns (Monitor Log list, Monitor Log report). Both currently-separate implementations (`.monitor-log-list-table`, `.monitor-report-table`) consolidate onto this one modifier instead of each hand-rolling their own override.
- **`.data-table-sticky-cols`** — new reusable mixin extracted from the Delivery Tracker Gantt/timeline table's sticky-column pattern (currently bespoke, only used once). Any future table needing sticky first-column(s) — e.g. a wide Monitor Log report — can compose this instead of re-implementing the sticky/z-index/box-shadow logic from scratch.
- `.tp-recent-table` stays intentionally simple (no sort/hover/sticky) since it's read-only reference data — not every table needs full `.data-table` treatment.
- The export-only inline-styled table in `monitor-report.js` (`buildMonitorReportCopyHtml`) stays outside this system by design — it's copy-pasted HTML for external use, not in-app UI.

---

## 9. Empty states

Two classes, split by *why* something is empty (not by module):

- **`.empty-state`** — for "nothing selected" contexts (e.g. detail pane with no note/item selected). Centered flex column, icon at `font-size: 32px; opacity: .4`, text below at 12px, `color: var(--text-dim)`. Unchanged from current canonical implementation.
- **`.empty-list`** — renamed and consolidated from `.note-empty`. For "the list/search/filter returned zero results." No icon, more compact. This absorbs all ~21 existing `.note-empty` call sites across Notes, Checklist, Monitor Log, Delivery Tracker, Admin Hub, and Test Prep Hub — the class name no longer implies "Notes-only." Also absorbs `.mob-empty` (mobile duplicate) and `.task-column-empty` (kanban column) via a size modifier: `.empty-list-sm` for the smallest (10px, kanban column) context.
- The two dropdown-empty variants (`.dropdown-empty`, `.inline-link-dd-empty`) consolidate into one, centered (matching the majority convention).
- `.graph-empty` (Graph View's default instructional text) is explicitly NOT an empty state under this taxonomy — it's a hint/instruction, and should be renamed accordingly in a future pass (not blocking for this spec).
- `.csp-empty` (Campaign side-panel "No note added", currently italicized) should drop the italic and use `.empty-list` for consistency.

---

## 10. Card containers

**Previously had no shared base class or token set at all** — 26 distinct card-family implementations found across the app, using 5 different radius values (6/8/10/12/14px) with no semantic pattern, and no `--card-shadow` token (every "floating" card hand-rolled its own hardcoded shadow rgba).

One shared radius for in-page cards, with a single named exception for floating cards:

- **`.card`** — `border-radius: 8px`, `background: var(--surface2)`, `1px solid var(--border)`, no shadow. Default for every in-grid/in-list card: kanban task cards, checklist template/instance cards, mobile note/campaign/team cards, info boxes, Test Prep stat header. This replaces the previous 6px/14px variants — mobile cards move from 14px to 8px for full consistency with desktop.
- **`.card-floating`** — `border-radius: 12px`, `background: var(--surface)`, `1px solid var(--border)`, plus a new shared `--card-shadow` token (define once in `:root`, e.g. `0 12px 32px rgba(0,0,0,.4)`, replacing the currently hardcoded per-component values). Reserved for surfaces that visually float above other content: login card, onboarding tour card, search-result popup cards.

Both tiers always set an explicit `background` — this fixes `.dt-legend-row` and `.template-picker-row`, which currently have border+radius but no background and render see-through; decide during migration whether each should adopt `.card` or intentionally stay a borderless utility box (document the choice inline if kept borderless).

---

## Known bugs to fix alongside migration (not design decisions — just correct the token)

These don't require a design choice; they're places where existing code already deviates from its own conventions:

1. Hardcoded `#f87171` in `.form-hint` error states (3 sites in `index.html`) and two JS-driven loading-screen error messages — replace with `var(--danger)`. This is a real light-theme bug, not just style drift.
2. Four different hardcoded "success green" values across badges/buttons — replace all with `var(--success)`-derived values.
3. `.checklist-status-badge.is-done` background/text token mismatch (see Badges section above).
4. Dark-mode date-picker icon fix currently scoped to one input only — extend to all `type="date"` inputs.
5. `.monitor-cell-input`'s "edited" indicator hardcodes `#BA7517` instead of `var(--amber)` (`#d9a94f`).
6. `.btn-primary` hover hardcodes `#4a7de0` instead of a token.
7. `.popup-code-block` hardcodes `background:#1a1d2e; border:1px solid #2a3047` instead of `var(--code-bg)`/`var(--border)` (used correctly by the near-identical `.code-block`) — will not adapt under `[data-theme="light"]`, a real theming bug.
8. `.login-log-panel` hardcodes `background:#0a0c12` while its border correctly uses `var(--border)` — half-varred, finish the token conversion.
9. `admin-flag-card` (appended in `admin-hub.js`) has no matching CSS rule anywhere — dead class. Either remove it or give Admin Hub's feature-flag cards actual visual differentiation from the Checklist Templates grid they currently borrow wholesale.
10. `.checklist-phase` and `.tp-accordion-section` are byte-for-byte identical CSS rules under two names in the same module (Test Prep) — merge into one shared accordion-card class.
11. `.mob-note-card`, `.mob-camp-card`, `.mob-team-card` are pixel-identical CSS declared three separate times — consolidate into one `.card` (see Card containers above) with no modifiers needed beyond the existing `:active`/selected-state ones. Standardize the selected-state modifier naming too (`.mob-camp-card.camp-row-active` vs `.mob-team-card.active` — pick one convention, e.g. `.is-selected`).
12. `.confirm-box` creation is duplicated via `document.createElement` + manual `className` assignment in three separate files (`notes.js`, `monitor-report.js`, `checklist-share.js`) — extract into one shared helper function. (Note: per the Modals section above, destructive confirms using `.confirm-box` today should migrate to `.modal.modal-sm` instead; non-destructive ones can keep this pattern via the shared helper.)
13. Two different top-level mobile-card-list wrapper classes exist for the same layout (`.mob-note-cards` vs `.mob-card-list`) — consolidate to one.

---

*This spec is the target state. Migration happens module-by-module (Phase 4 of the Design System Sweep), each as an independently reviewable, independently rollback-able PR.*
