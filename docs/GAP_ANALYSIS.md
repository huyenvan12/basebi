# base·bi Design System — Full Gap Analysis (Phase 3)

Compares each module's actual UI code against `docs/DESIGN_SYSTEM.md`. This is an audit only — no functional code changes are made in this document or its companion PR.

Modules covered, in order: Delivery Tracker, Notes (incl. Team Shared), Checklist, Campaign Log, Monitor Log, Admin Hub, Test Prep Hub.

Note on baseline: as of this analysis, none of the spec's new shared classes (`.card`, `.card-floating`, `.icon-btn`/`.icon-btn-sm`/`.icon-btn-lg`, `.notification-banner`, `.data-table`/`.data-table-fixed`/`.data-table-sticky-cols`, `.empty-list`/`.empty-list-sm`, `.form-input-compact`/`.form-input-search`, `.section-label`/`.section-label-sub`, `.popover`) exist yet anywhere in `basebi.css`. Every module's Phase 4 fix therefore involves both introducing the new shared classes (once, app-wide) and migrating that module's call sites onto them — flagged per-module below where relevant.

---

## 1. Delivery Tracker

**Files audited:** `js/gantt-tracker.js`, `js/tasks.js`, Delivery Tracker markup in `index.html` (lines 495–555, 923–1080), and the corresponding rule blocks in `basebi.css` (lines 855–1041 "DELIVERY TRACKER" block, plus 1302–1316 agenda block, 98–103 buttons, 207–223 empty/hint states).

### Navigation

**Spec:** *"L3a · Sub Tabs — nested navigation within a module... Same solid-fill language as L2, smaller size."* / *"L3b · Filter Group — modifies the current view without navigating away (e.g. 'Group by: Status/Due date/Priority'). Outline-only active state, with a label prefix ('Group by:') to signal it's a filter, not a destination."*

- L3a already visually correct, just needs class rename. `.dt-subtab` (`basebi.css:860-862`, `index.html:498-500` — `#dtSubTabTimeline/Calendar/Tasks`) uses `background:var(--accent-dim);color:var(--accent)` on `.active`, matching L2's fill language. Fix: rename into shared L3a token/class, no visual change.
- L3b is the literal example cited in the spec, and it's currently wrong. DT's `.task-groupby-switcher` (`index.html:537-542`) already has the correct "Group by:" label prefix, but `.task-gb-btn.active` (`basebi.css:964-965`) is `background:var(--accent-dim);color:var(--accent);border-color:var(--accent)` — a solid/tinted fill, not the required outline-only active state. Fix: change to border-only (`background:transparent;border-color:var(--accent);color:var(--accent)`).

### Section labels

**Spec:** `.dt-agenda-day-label` is named explicitly in the retirement list.

- `.dt-agenda-day-label` (`basebi.css:1305`): `font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em`. Size/weight/color match `.section-label`, but letter-spacing uses `em` (`.04em`) not the mandated `px`. Fix: retire class, apply `.section-label`, convert `.04em` → `.6px`.

### Badges / status pills

**Spec:** *"border-radius: 10px for every badge"* (already true) / *"positive/done/success badges use var(--success)... never one-off greens."*

- `.dt-status-badge` and `.task-priority-badge` already use `border-radius:10px` — no gap on radius.
- `.dt-status-Done{background:rgba(74,222,128,.15);color:var(--success)}` (`basebi.css:922`) is one of the "four different hardcoded success green values" in the spec's known-bugs list — hand-computed alpha tint instead of a derived token. Fix: replace with a `--success-dim`/`color-mix` token once defined.

### Buttons

- Most DT buttons already correctly compose `.btn`/`.btn-primary`/`.btn-ghost`/`.btn-danger` — no gap.
- `.dt-ticket-edit-btn` (`basebi.css:905-906`, `gantt-tracker.js:395`, the ✎ edit-ticket icon) is an ad-hoc icon button (`background:none;border:none`). Fix: migrate to `.icon-btn-sm` (dense row context).
- `.task-add-btn` (`basebi.css:974-975`, `tasks.js:391`, "+ Add task" per kanban column) is the same ad-hoc pattern. Fix: decide during migration whether it stays a text-link or becomes `.icon-btn-sm` with a `+` icon.
- Inherited, not DT-specific: `.btn-primary:hover{background:#4a7de0}` (known bug #6) — DT consumes `.btn-primary` heavily but the fix belongs in the shared base class.

### Toast / notification system

**Spec:** replaces `window.alert()` — module-by-module migration in Phase 4.

- DT is one of the heaviest `alert()` users in the app. ~9 true error/success-feedback alerts map to `.notification-banner`:
  `gantt-tracker.js:593, 610, 658, 722, 739, 788, 800, 858`; `tasks.js:132, 312`.
- ~4 are field-level validation and should become inline errors per the spec's carve-out, not toasts:
  `gantt-tracker.js:768` ("Project name is required."), `gantt-tracker.js:841` ("Every task type needs a code and a label."), `gantt-tracker.js:1208, 1209` (agenda entry date validation).

### Form inputs

**Spec:** `.form-input-compact` retires `.task-popover-input`, background must be `var(--surface2)` not `var(--surface)`. Known bug #4: dark-mode date-picker icon fix scoped to one input.

- `.task-popover-input` (`basebi.css:1029`) is explicitly named for retirement into `.form-input-compact`, and demonstrates the exact bug the spec calls out by name: `background:var(--surface)` instead of `var(--surface2)`. Radius (4px) and padding (5px 7px) already match. Fix: swap background token, then retire class.
- **Known bug #4, confirmed still present.** The dark-mode calendar-icon fix (`basebi.css:1034`) only targets `.task-popover-input[type="date"]`. Three other DT date inputs get no fix and will show an invisible calendar glyph in dark mode: `#dtStartDate` (`index.html:507`), `#dtAgendaStartDate` (`index.html:1032`), `#dtAgendaEndDate` (`index.html:1036`). Fix: broaden the selector app-wide.

### Modal / popover / confirm

**Spec:** consolidate `.task-popover`, `.dt-type-picker-popover`, `.dt-cal-popover` into `.popover`. All destructive confirms → `.modal.modal-sm`.

- **Confirmed byte-for-byte duplication named in spec.** `.dt-type-picker-popover,.dt-cal-popover` (`basebi.css:926`) and `.task-popover` (`basebi.css:1025`) share an identical `position/z-index/background/border/border-radius/box-shadow` recipe (only padding/width differ). Fix: extract shared base into `.popover`.
- **Gap beyond the known-bugs list:** four destructive DT actions use raw `window.confirm()`, not even the legacy `.confirm-box`: `gantt-tracker.js:580, 605, 654, 793` (the last — "Delete this ticket and all its scheduled entries?" — is clearly data-loss and should be `.modal.modal-sm`). Note `#dtOverlapModalOverlay` (`index.html:985-997`) already correctly uses `.modal.modal-sm`, so the pattern exists in-module, just inconsistently applied.

### Tables

**Spec:** `.data-table-sticky-cols` is a new mixin explicitly extracted from DT's own timeline/Gantt table.

- `#dtTimelineTable`/`.dt-timeline-table` (`index.html:516-519`, `basebi.css:875-885`) is the spec's own named source for the new mixin — the sticky-column logic (incl. hand-authored `box-shadow:2px 0 4px rgba(0,0,0,.25)`) is currently fully bespoke and needs extraction — new shared-component work, not a simple fix.
- No row-hover (`var(--surface2)`) or active-row accent on `.dt-ticket-row` — gap vs. the base `.data-table` recipe once composed.

### Empty states

**Spec:** DT explicitly named as one of the modules whose `.note-empty` usage gets absorbed into `.empty-list`; `.task-column-empty` becomes the source for `.empty-list-sm`.

- `gantt-tracker.js:420` ("No tickets yet") and `gantt-tracker.js:1145` ("No upcoming scheduled work") — rename `.note-empty` → `.empty-list`, no visual change.
- `.task-column-empty` (`basebi.css:973`, `tasks.js:394`) already matches the spec's stated `.empty-list-sm` target values (10px) almost exactly — rename-only fix.

### Card containers

**Spec:** `.dt-legend-row` is named verbatim as a confirmed live bug (border+radius, no background). `.task-card` is explicitly named as a `.card` target.

- **`.dt-legend-row`** (`basebi.css:867`) has no `background` property at all — confirmed see-through. Used at `index.html:505` (`#dtLegendRow`). Fix: decide whether it adopts `.card` (add `background:var(--surface2)`, bump radius 6→8px) or stays an intentionally borderless utility box, documented inline.
- **`.task-card`** (`basebi.css:1005`): `border-radius:6px;background:var(--surface)` vs. target `.card` (`8px`/`var(--surface2)`) — two-property mismatch. Fix: bump radius, swap background token.
- `.task-column` (the column container, not the card) already matches `.card`'s exact values today — no gap, though it isn't literally a "card"; confirm during migration it's intentionally left bespoke.
- `.dt-agenda-ticket-card` (`basebi.css:1307`, mobile-only) not named in the spec's `.card` list or known-bug #11's mobile-card list, but structurally a reasonable `.card` candidate: radius already 8px, background is `var(--surface)` not `var(--surface2)`. Flag for a design decision alongside the mobile-card consolidation.

### Known-bugs checklist — Delivery Tracker relevance

| # | Bug | Touches DT? | Status |
|---|-----|--------------|--------|
| 1 | Hardcoded `#f87171` in `.form-hint` | No | N/A — all 3 sites are Notes/Folder/Password |
| 2 | Four hardcoded "success green" values | **Yes** | Still present — `.dt-status-Done` (`basebi.css:922`) |
| 3 | `.checklist-status-badge.is-done` mismatch | No | N/A — Checklist only |
| 4 | Date-picker icon fix scoped to one input | **Yes** | Still present — DT has 3 affected inputs |
| 5 | `.monitor-cell-input` amber hardcode | No | N/A — Monitor Log only |
| 6 | `.btn-primary` hover hardcode | Indirect | Still present (shared); DT is a heavy consumer |
| 7 | `.popup-code-block` hardcode | No | N/A |
| 8 | `.login-log-panel` hardcode | No | N/A |
| 9 | `admin-flag-card` dead class | No | N/A — Admin Hub only |
| 10 | `.checklist-phase`/`.tp-accordion-section` duplicate | No | N/A |
| 11 | `.mob-note-card`/`.mob-camp-card`/`.mob-team-card` triplication | No, adjacent | DT's own `.dt-agenda-ticket-card` is a separate, unnamed mobile-card implementation worth bundling into the same pass |
| 12 | `.confirm-box` duplication (3 named files) | No, but related/worse | DT never adopted `.confirm-box` — uses raw `window.confirm()` for 4 destructive actions instead |
| 13 | `.mob-note-cards` vs `.mob-card-list` | Partial | DT's Agenda sub-view (`index.html:553`) already uses `.mob-card-list`; no DT-side change needed regardless of which name wins |

**Effort estimate: medium.** Most items (7) are low-risk token/class-name swaps, but the module also carries three genuinely structural pieces of net-new work — the `.notification-banner` toast build-out plus ~13 `alert()` migrations, replacing 4 raw `window.confirm()` calls with `.modal.modal-sm`, and extracting the brand-new `.data-table-sticky-cols` mixin.

---

## 2. Notes (incl. Team Shared)

**Files audited:** `js/notes.js`, `js/daily-note.js`, `js/mobile-shell.js`, `js/graph-view.js`, and the Notes/Team Shared/Graph View sections of `index.html`.

### Navigation

**Spec:** L2 = solid fill; L3a = same solid-fill language as L2, smaller size.

- Both the top-level module switcher (`index.html:19-26`) and Team Shared sub-tabs (`index.html:378-382`) share `.tab-btn`/`.tab-group`. Active state (`basebi.css:465`) is a translucent tint (`accent-dim`), not a genuinely solid fill. Fix: give L2 a solid active fill (e.g. `background:var(--accent);color:#fff`) and give L3a Team Shared sub-tabs the same solid-fill treatment at a smaller size.

### Section labels

- `.sidebar-label` (Folders/Tags headers, `basebi.css:111`): `10px/600/.8px/var(--text-dim)` vs. target `.section-label` (`11px/600/.6px/var(--text-muted)`) — three values differ. Fix: retarget to spec values.
- `.note-list-title` (`basebi.css:133`) already matches `.section-label` exactly — lowest-effort rename in the whole audit.
- `.linked-label`/`.popup-linked-label` (`basebi.css:203,455`) — neither cleanly matches `.section-label-sub` (weight/letter-spacing off). Fix: consolidate into `.section-label-sub`, correct weight to 700 and letter-spacing to `.7px`.
- `.graph-link-list-title` (`basebi.css:813`) — same off-spec values as `.linked-label`. Fix: merge into `.section-label-sub`.
- `.mob-section-label` (`basebi.css:1189`) uses `em` letter-spacing (`.06em`), violating the px-only rule. Fix: convert to px, merge into a tier.

### Badges / status pills

- Virtually every Notes/Team/Graph badge uses 3–4px radius instead of the unified 10px: `.note-type-badge` (3px), `.detail-tag` (4px), `.author-badge` (4px), `.privacy-badge` (4px), `.tag-chip` (4px), `.chip-sel` (4px), `.linked-chip`/`.popup-linked-chip`/`.inline-link` (4px/3px), `.search-result-type` (3px), `.popup-type-badge` (3px), `.pm-folder`/`.pm-tag` (3px). `.graph-chip` already compliant at 10px. Fix: batch-update ~10 selectors to `border-radius:10px`.
- **Known bug #2 instance:** `.privacy-badge.is-shared{color:#1f8a4c;background:rgba(56,165,106,.18)}` (`basebi.css:160`) hardcodes a one-off green instead of `var(--success)` — used in note detail, popup, and mobile. Fix: replace with `var(--success)` + a success-derived tint.

### Buttons

- **Known bug #7, exact quote match, confirmed still present:** `.popup-code-block` family (`basebi.css:440-446`) hardcodes `#1a1d2e`/`#2a3047`/`#f59e0b`/`#7a8599`/`#e2e8f0`/`#4ade80` instead of the tokens the near-identical `.code-block` (`basebi.css:193-199`) correctly uses. Will not adapt under light theme. Fix: swap to `var(--code-bg)`, `var(--border)`, `var(--sql)`, `var(--text-muted)`, `var(--success)`.
- **Known bug #6:** `.btn-primary:hover{background:#4a7de0}` (`basebi.css:98`) — additionally, the mobile FAB independently duplicates the same hardcoded hex (`.mob-fab:active`, `basebi.css:1171`). Fix: introduce a hover token, apply to both.
- `.fmt-btn` (note-editor toolbar) is explicitly named in the spec — literally the cited example for `.icon-btn-sm` ("e.g. note editor formatting bar"). Current size (26×24/5px radius) is close to target (24×22/5px) — cheap swap; also fold the light-theme `#noteModalOverlay .fmt-btn` override into the token system.
- `.mob-icon-btn` (`basebi.css:1143`) is explicitly retired and already numerically matches `.icon-btn-lg` (34×34/8px) — straight rename, lowest-effort button item.
- `.gear-btn` (Daily Note button, `basebi.css:470-471`) is on the retirement list but uses padding-based sizing, not a fixed 28×28 box — needs restructuring (shared across modules).
- `.tag-act-btn` (tag cloud rename/delete, `basebi.css:127-128`) is a bare ad-hoc icon button — maps to `.icon-btn-sm` (dense sidebar row, two icons side by side).
- `.graph-open-btn` explicitly named in spec as a `.btn-primary` reimplementation to migrate — `basebi.css:816,957`. Fix: replace with `<button class="btn btn-primary">`.

### Toast / notification system

- 3 of the ~40 alert sites live here: `notes.js:813, 833` (save failure), `notes.js:859` (delete permission denied). Route through `.notification-banner` once built.
- Compliant already: the note-title uniqueness error correctly renders inline via `.form-hint`/`#f-title-error`, matching the spec's field-level carve-out — no fix needed there.

### Form inputs

- **Gap, spec names the topbar search box directly:** `#searchInput` (`basebi.css:84-94`) is styled as a plain `.form-input` (1px border, 6px radius), not the new `.form-input-search` tier, while `.search-screen-input` (`basebi.css:390`) already nearly matches that tier (2px border, 10px radius, 15px font) using `--search-border` instead of the spec's named `--accent-dim`. Fix: derive `.form-input-search` from `.search-screen-input`'s recipe (swap `--search-border`→`--accent-dim`), apply to both inputs, retire both bespoke classes.
- No `.form-input-compact` gaps and no `type="date"` inputs exist in this module's scope — known bug #4 doesn't touch Notes.

### Modal / popover / confirm

- **Spec's own motivating example, still unfixed:** note deletion (`notes.js:843-855`, `confirmDeleteNote`) uses a no-backdrop `.confirm-box` while other equally-destructive flows use a full modal. Fix: replace with `.modal.modal-sm` for both desktop and team-detail delete flows.
- `deleteTag()` (`notes.js:644`) and mobile note-delete (`mobile-shell.js:127`) both bypass all custom UI via native `window.confirm()` — not covered by any of the three spec tiers at all. Fix: route through the same `.modal.modal-sm` pattern.
- **Known bug #12, confirmed present:** `notes.js:848-853` manually builds `.confirm-box` via `document.createElement`/`className` — one of the three named duplicated sites. Per the spec's own carve-out this instance is actually destructive, so it should migrate to `.modal.modal-sm` (superseding the shared-helper fix for this specific call site).
- `.dropdown-list` (`basebi.css:240`) and `.inline-link-dd` (`basebi.css:365`) are two more bespoke "no-backdrop, anchored, popover-like" implementations, not named in the spec's retirement list but structurally the same pattern — worth folding into `.popover` even though not explicitly mandated.

### Tables

No gaps found — not applicable. Notes/Team-Shared/Graph View has no `<table>`-based UI.

### Empty states

- `.note-empty` (`basebi.css:147`) used at `notes.js:282,300,426,444` — 4 of the ~21 total call sites live in this module. Rename to `.empty-list`.
- `.mob-empty` (`basebi.css:1160`, `mobile-shell.js:55,190`) is the mobile duplicate the spec says `.empty-list` should absorb.
- `.dropdown-empty` vs. `.inline-link-dd-empty` — the latter (`basebi.css:370`, `notes.js:892`) has no `text-align:center`, confirming the exact left-vs-center inconsistency the spec flags. Fix: consolidate into one, centered.
- Correctly out of scope, no fix needed: `.empty-state` (nothing-selected contexts) already used correctly; `.graph-empty` explicitly called out by spec as not an empty state.

### Card containers

- **Known bug #11, confirmed present:** `.mob-note-card` (`basebi.css:1155`) and `.mob-team-card` (`basebi.css:1289`) are byte-for-byte identical (14px radius, `var(--surface)` bg) except class name — confirmed exactly as claimed. `.mob-note-card` also has no "selected" state modifier at all, an extra inconsistency beyond what's flagged. Fix: consolidate to `.card` (8px/`var(--surface2)`), standardize selected-state to `.is-selected`.
- **Known bug #13, confirmed present, entirely within this module's scope:** `.mob-note-cards` (`basebi.css:1154`, native shell wrapper) vs. `.mob-card-list` (`basebi.css:1275`, used by both `#noteCardsWrap` and `#teamCardsWrap`) — two wrapper classes for the same layout, differing in default `display` state too. Fix: consolidate to one wrapper with a modifier/media-query.
- `.search-result-card` and `.note-popup` are both named by the spec for `.card-floating`, but neither matches: `.search-result-card` (`basebi.css:397`) uses 8px radius and its own `--search-card`/`--search-card-border` token namespace (not `var(--surface)`), with no resting shadow at all. `.note-popup` (`basebi.css:413`) already matches radius (12px) and background (`var(--surface)`) but its shadow is still hardcoded rgba rather than the proposed `--card-shadow` token.

### Known-bugs checklist — Notes/Team-Shared/Graph relevance

| # | Bug | Touches this module? | Status |
|---|-----|----------------------|--------|
| 1 | Hardcoded `#f87171` in `.form-hint` | **Yes** | Still present: `index.html:603` (`#f-title-error`), `index.html:669` (`#f-folder-name-error`) |
| 2 | Four hardcoded "success green" values | **Yes** | Still present: `.privacy-badge.is-shared` (`basebi.css:160`) |
| 3 | `.checklist-status-badge.is-done` mismatch | No | N/A |
| 4 | Date-picker icon fix scoped to one input | No | No `type="date"` inputs in this module |
| 5 | `.monitor-cell-input` amber hardcode | No | Monitor Log is out of this module's file scope |
| 6 | `.btn-primary` hover hardcode | **Yes** | Still present; also duplicated independently at `.mob-fab:active` |
| 7 | `.popup-code-block` hardcode | **Yes** | Still present exactly as described |
| 8 | `.login-log-panel` hardcode | No | Login screen, not Notes |
| 9 | `admin-flag-card` dead class | No | Admin Hub |
| 10 | `.checklist-phase`/`.tp-accordion-section` duplicate | No | Checklist/Test Prep |
| 11 | Mobile card triplication | **Yes (partial)** | `.mob-note-card`/`.mob-team-card` confirmed identical; `.mob-camp-card` is out of scope |
| 12 | `.confirm-box` duplication | **Yes** | Still present at `notes.js:848-853`; should migrate to `.modal.modal-sm` per Modal section |
| 13 | `.mob-note-cards` vs `.mob-card-list` | **Yes** | Confirmed entirely within this module's scope |

**Effort estimate: medium.** Most fixes are mechanical (badge radius, class renames, token swaps), but the module carries several structurally real changes — note-deletion confirm-box → `.modal.modal-sm` (two flows), the search-input consolidation, and the mobile-card / wrapper consolidations — each touching shared rendering logic across native-app and desktop-web code paths.

---

## 3. Checklist

**Files audited:** `js/checklist-templates.js`, `js/checklist-instances.js`, `js/checklist-share.js`, and the Checklist sections of `index.html` (sub-tab views + detail/reviewer views, Template/New-Checklist/Share modals).

### Navigation

- Checklist's own sub-tab bar (`index.html:408-412`) is literally the spec's own named L3a example, and uses `.tab-btn.active{background:var(--accent-dim);color:var(--accent)}` — a tint fill, not a solid fill. Fix: once L2 gets its solid-fill treatment, restyle the L3a tier to a genuinely solid `var(--accent)` background; shared class, Checklist is one of three consumers (also Team subtabs, Monitor Log subtabs).

### Section labels

- `.note-list-title` (used at `index.html:418,427,444`) already matches `.section-label` numerically — pure rename.
- `.checklist-group-label` (`basebi.css:544`, `checklist-share.js:82,84`) and `.checklist-section-title` (`basebi.css:608`, `checklist-instances.js:191,204`) both use `letter-spacing:.03em`, explicitly retired by name. Fix: map both to `.section-label`, convert `.03em` → `.6px`.

### Badges / status pills

- **Known bug #3, confirmed present:** `.checklist-status-badge.is-done{background:var(--danger-dim);color:var(--success)}` (`basebi.css:596`) — background/text token mismatch, rendered at `checklist-instances.js:225`. Fix: change background to a success-derived tint, keep `color:var(--success)`.
- `.ci-new-tag` (`basebi.css:564`, `checklist-share.js:182`) uses `border-radius:4px` instead of the unified 10px. Fix: swap to 10px.
- `.checklist-status-badge` base and `.template-badge-admin` already comply with 10px — no gap.

### Buttons

- **Explicitly named in spec:** `.ci-share-btn` (`basebi.css:556-557`, `checklist-share.js:57`) reimplements button styling standalone instead of composing `.btn-ghost`. Fix: migrate to `.btn.btn-ghost` (or a small size modifier).
- **Known bug #6, module-wide impact:** `.btn-primary:hover{background:#4a7de0}` — every primary CTA in Checklist inherits this ("+ New Template", "+ New Checklist", "Save Template", "Create Checklist", "Use this template", "Mark Checklist Done").
- Inline `style="font-size:11px"` used as an ad-hoc small-button hack (`checklist-templates.js:51-52`) instead of a documented size tier — flag for consistency, not an explicit spec rule.
- `.modal-close` (×, `basebi.css:219`) has no defined box size/radius/hover-fill, used in all 3 Checklist modals. Fix: migrate to `.icon-btn` (shared/app-wide fix).

### Toast / notification system

- ~8 `alert()` sites: `checklist-templates.js:96,103,115,120,129`; `checklist-instances.js:134,136,145`. Route through `.notification-banner`.
- Native `confirm()` sites: `checklist-templates.js:121` (destructive template delete — should become `.modal.modal-sm`); `checklist-instances.js:274` (non-destructive mark-done — lower priority, can stay a lightweight `.popover`-based confirm).

### Form inputs

- `.tpl-item-row .form-input` (`basebi.css:650`, `checklist-templates.js:86-89`) is a scoped descendant-selector override rather than composing `.form-input-compact` — exactly the "dense inline-add row" case the spec calls out. Padding matches target but background (`var(--bg)`) and radius (6px) don't. Fix: swap class to `.form-input-compact`, drop the override.

### Modal / popover / confirm

- **Spec's own named example:** `checklist-templates.js:121` uses native `confirm()` for destructive template delete — "delete checklist template" is literally the spec's example under `.modal.modal-sm`. Fix: replace with a proper `.modal.modal-sm` dialog.
- **Known bug #12, confirmed present:** `checklist-share.js:116-126` (`confirmUnshare`) manually builds `.confirm-box` via `document.createElement`/`className`. This is the non-destructive case, so per spec it correctly *stays* `.confirm-box`-style, but should be extracted into a shared helper alongside the `notes.js`/`monitor-report.js` copies.

### Tables

No gaps found — not applicable; Checklist has no table-based UI.

### Empty states

- 6 `.note-empty` sites all need renaming to `.empty-list`: `checklist-templates.js:40`; `checklist-instances.js:81`; `checklist-share.js:83,85,147,172`. Values already match target, pure rename with no visual regression risk.

### Card containers

- **Spec explicitly names this exact class as a known bug:** `.template-picker-row` (`basebi.css:655`, `checklist-instances.js:101`) has border+radius but no background. Fix: decide whether it becomes `.card` (add `background:var(--surface2)`) or an intentionally borderless box, documented inline.
- `.checklist-template-card` (`basebi.css:517`) and `.checklist-instance-card` (`basebi.css:547`) already numerically match the target `.card` recipe exactly — no visual fix needed, just rename/consolidation onto the shared base class.

### Known-bugs checklist — Checklist relevance

| # | Bug | Touches Checklist? | Status |
|---|---|---|---|
| 1 | Hardcoded `#f87171` in `.form-hint` | No | N/A |
| 2 | Four hardcoded "success green" values | No | Not found in this module |
| 3 | `.checklist-status-badge.is-done` mismatch | **Yes** | Still present — `basebi.css:596` |
| 4 | Date-picker icon fix scoped to one input | No | No date inputs in this module |
| 5 | `.monitor-cell-input` amber hardcode | No | Monitor Log only |
| 6 | `.btn-primary` hover hardcode | **Yes (consumer)** | Still present; affects every primary CTA in Checklist |
| 7 | `.popup-code-block` hardcode | No | N/A |
| 8 | `.login-log-panel` hardcode | No | N/A |
| 9 | `admin-flag-card` dead class | No | Admin Hub borrows Checklist's card styling but doesn't touch Checklist code |
| 10 | `.checklist-phase`/`.tp-accordion-section` duplicate | **Yes (partial)** | `.checklist-phase` is declared and used by Checklist (`checklist-instances.js:194`); no longer 100% byte-identical to `.tp-accordion-section` (which has an extra `flex-shrink:0`), but the core 4 properties remain duplicated |
| 11 | Mobile card triplication | No | No `.mob-checklist-card` equivalent exists |
| 12 | `.confirm-box` duplication | **Yes** | Still present — `checklist-share.js:118-125` |
| 13 | `.mob-note-cards` vs `.mob-card-list` | No | Not used by Checklist |

**Effort estimate: medium.** The bulk of the work (class renames, token swaps for `.btn-primary` hover and `.is-done` badge, `.template-picker-row` background fix) is small and mechanical, but ~9 `alert()`/`confirm()` call sites need migration to the new toast component and one destructive confirm needs conversion to a full `.modal.modal-sm`, requiring new interaction wiring.

---

## 4. Campaign Log

**Files audited:** `js/campaigns.js`, the `#campView` block in `index.html` (lines 255–334), the mobile card markup, and every campaign-prefixed rule in `basebi.css`.

### Section labels

- `.camp-filter-label` (`basebi.css:670`, `index.html:259`) and `.csp-field-label` (`basebi.css:741`, `campaigns.js:245,247,253`) are both explicitly named for retirement, and both already numerically match `.section-label-sub` exactly — the only gap is naming duplication. Fix: pure rename, delete the two redundant CSS rules — smallest possible diff in this module.

### Tables

- `table.camp-table` (`basebi.css:684-695`) already implements every characteristic the spec's `.data-table` describes verbatim (sticky header, sort arrows, row hover, active-row accent, 860px min-width) — it *is* the literal source the spec's `.data-table` is modeled on. Fix: rename-only refactor (`table.camp-table` → `.data-table`), including the `document.querySelectorAll` selectors in `campaigns.js:81,220,223,374` and the markup at `index.html:300`. No CSS value changes needed.

### Card containers

- `.mob-camp-card` (`basebi.css:1277`) uses 14px radius / `var(--surface)` background vs. target `.card` (8px/`var(--surface2)`); its selected-state class (`camp-row-active`, `campaigns.js:137,144`) is one of the inconsistent conventions the spec explicitly calls out to unify (known bug #11). Fix: compose `.card`, rename active modifier to the agreed `.is-selected` convention (coordinate with the desktop `<tr class="camp-row-active">` at `campaigns.js:116` too — decide whether that should also be renamed).

### Badges / status pills

- `.cb` base (`basebi.css:706`) uses `border-radius:3px` vs. the unified 10px convention.
- `.cb-event`'s teal (`rgba(52,211,153,.1)`/`#34d399`, `basebi.css:712`) is hardcoded inline — this is the exact class the spec calls out by name as the anti-pattern example ("Any new categorical color... must be added to the `:root` token list"). `.cb-adhoc`'s lavender (`#c4b5fd`, `basebi.css:708`) is likewise hardcoded and reused elsewhere in the module. Fix: bump radius to 10px; add `--teal`/`--lavender` tokens to `:root` and reference them.

### Form inputs

- `.camp-filter-input` (`basebi.css:671`), `.camp-add-input` (`basebi.css:716`), `.csp-add-extra-input` (`basebi.css:753`) all named for retirement into `.form-input-compact` — all three currently use `background:var(--bg)` or `var(--surface)` instead of `var(--surface2)`; `.camp-filter-input`'s radius/padding also differ (5px/`4px 8px` vs. target 4px/`5px 7px`). Fix: swap backgrounds, align radius/padding, or apply `.form-input-compact` directly at each call site.
- **Known bug #4, confirmed present:** `#ca-date` (`campaigns.js:100`, `class="camp-add-input"`, `type="date"`) is not covered by the dark-mode calendar-icon fix. Fix: extend the app-wide selector (fixes Campaign Log automatically).

### Buttons

- **Explicitly named in spec:** `.csp-edit-btn`/`.csp-del-btn` (`basebi.css:759-762`, `index.html:332-333`) hand-roll radius/padding/color instead of composing `.btn-ghost`/`.btn-danger`.
- Additional ad-hoc icon buttons not explicitly named but matching the "bare `background:none;border:none`" pattern: `.csp-close-btn`, `.camp-add-cancel`, `.csp-extra-del` (→ `.icon-btn`/`.icon-btn-sm`), plus `.camp-clear-btn` and `.csp-add-extra-btn` (standalone ghost reimplementations), and `.camp-add-save` (standalone primary-fill reimplementation, should compose `.btn-primary`). Largest-effort button item — requires re-checking padding/sizing in dense table-row/side-panel contexts.

### Empty states

- **Spec-named bug, confirmed present:** `.csp-empty` (`basebi.css:744`, `campaigns.js:250`) still has `font-style:italic`. Fix: drop italic, rename to `.empty-list`.
- **Additional functional gap found (not named in spec but real):** `renderCampTable()` has no zero-results handling at all — if the filtered list is empty, both the desktop `tbody` and mobile `cardsWrap` render blank with zero user-facing feedback. Fix: add an actual `.empty-list` branch — this is new code, not just a rename, the higher-effort half of this category.

### Modal / popover / confirm

- **Gap:** `confirmDeleteCamp()` (`campaigns.js:336-344`) uses the native browser `confirm()` dialog — doesn't even use the app's `.confirm-box` fallback, skipping any in-app UI entirely for its only destructive action. Fix: build a `.modal.modal-sm` destructive-confirm dialog. Largest structural change in this module — new markup, new show/hide wiring.

### Known-bugs checklist — Campaign Log relevance

| # | Bug | Present? |
|---|---|---|
| 1 | Hardcoded `#f87171` in `.form-hint` | No |
| 2 | Four hardcoded "success green" values | Partial/minor — `.cb-active` numerically matches `--success` but isn't token-referenced |
| 3 | `.checklist-status-badge.is-done` mismatch | No |
| 4 | Date-picker icon fix scoped to one input | **Yes** — `#ca-date` unfixed |
| 5 | `.monitor-cell-input` amber hardcode | No |
| 6 | `.btn-primary` hover hardcode | N/A today (Campaign Log doesn't use `.btn-primary`); becomes relevant once `.camp-add-save` is migrated |
| 7 | `.popup-code-block` hardcode | No |
| 8 | `.login-log-panel` hardcode | No |
| 9 | `admin-flag-card` dead class | No |
| 10 | `.checklist-phase`/`.tp-accordion-section` duplicate | No |
| 11 | Mobile card triplication | **Yes** — `.mob-camp-card` confirmed present with `camp-row-active` exactly as spec names it |
| 12 | `.confirm-box` duplication (3 named files) | Not directly — Campaign Log uses native `confirm()` instead (arguably worse) |
| 13 | `.mob-note-cards` vs `.mob-card-list` | **Yes** — Campaign Log's wrapper uses `.mob-card-list` (`index.html:317`) |

**Effort estimate: medium.** Most category-level fixes are mechanical class renames/value swaps with no behavior change, but building a real `.modal.modal-sm` destructive-confirm flow to replace native `confirm()`, and adding a genuinely-missing zero-results empty state to both the table and card renderers, push this past "small."

---

## 5. Monitor Log

**Files audited:** `js/monitor-report.js`, `index.html` lines 459–485, and corresponding rules in `basebi.css`.

### Section labels

- `.note-list-title` (`index.html:465`) already byte-identical to `.section-label` — quick rename once the class is retired app-wide.

### Badges / status pills

- `.monitor-readonly-badge` (`basebi.css:855`) already uses `border-radius:10px` and token-based colors — no gap.

### Buttons

- `.btn-primary:hover{background:#4a7de0}` (known bug #6) affects Monitor Log's "+ New from template" button — shared/global fix, no local change needed.
- `.monitor-delete-btn` (`basebi.css:831`) is a bare `background:none;border:none` ad-hoc icon button — exactly the pattern the spec retires, explicitly named as a "delete-row" use case for `.icon-btn`. Fix: migrate to `.icon-btn` with a danger-color modifier; note `.monitor-delete-btn-placeholder` (currently 18×18) must be resized to match the new 28×28 box to preserve column alignment.

### Form inputs

- `.monitor-cell-input` (`basebi.css:848`) is explicitly named for retirement into `.form-input-compact` — uses `background:var(--surface)` (the exact inconsistent variant the spec calls out) and `padding:5px 8px` instead of `5px 7px`.
- **Known bug #5, confirmed present:** `.monitor-val-wrap.monitor-cell-edited` hardcodes `#BA7517` in two places (`basebi.css:851,852`) instead of `var(--amber)`. Fix: quick token swap, no structural change — cheapest fix in this module.

### Modal / popover / confirm

- **Gap:** `confirmDeleteMonitorReport` (`monitor-report.js:339-351`) builds a `.confirm-box` for report deletion — an irreversible, destructive action, but uses the no-backdrop pattern the spec explicitly retires for destructive confirms. Fix: migrate to `.modal.modal-sm` with full backdrop — structural change (different DOM mount point), not a class swap.
- **Known bug #12, confirmed present:** `monitor-report.js:343` is one of the three named duplicated `.confirm-box`-creation sites. Per spec's own note, since this call site is destructive it should go straight to `.modal.modal-sm` rather than the shared non-destructive-confirm helper — superseding the dedup-helper fix for this site.

### Tables

- **Spec explicitly names both implementations for consolidation:** `.monitor-log-list-table` (`basebi.css:825-827`) and `.monitor-report-table` (`basebi.css:843-844`) each hand-roll their own `table-layout:fixed;width:100%;min-width:0` override. Fix: introduce `.data-table`/`.data-table-fixed` and apply both, keeping only the module-specific column-width rules local. Depends on the cross-module `.camp-table` → `.data-table` rename landing first.
- Correctly out of scope, confirmed: the export-only inline-styled table in `buildMonitorReportCopyHtml` (`monitor-report.js:279-326`) is copy-paste HTML for external use — per spec, not touched.

### Empty states

- Two `.note-empty` sites (`monitor-report.js:118,189`) need renaming to `.empty-list`. The `:189` site also carries an inline `style="font-size:11px"` override layered on top — consider whether this should become an `.empty-list-sm`-style modifier instead.

### Card containers

No gaps found — not applicable; Monitor Log has no card-family containers (list/detail are tables/plain divs).

### Navigation, Toast/notification system

- **Navigation:** no Monitor-Log-specific deviation found within audited files; reached via shared L3a sub-tab infra. No gaps found.
- **Toast/notification system:** no `alert()` calls exist anywhere in `monitor-report.js` — all error paths already use inline UI (an injected `.confirm-error` paragraph), consistent with the spec's field-level-error carve-out. No gaps found; this module is actually ahead of the migration curve here.

### Known-bugs checklist — Monitor Log relevance

| # | Bug | Touches Monitor Log? | Status |
|---|-----|----------------------|--------|
| 1 | Hardcoded `#f87171` in `.form-hint` | No | N/A |
| 2 | Four hardcoded "success green" values | No | `.monitor-readonly-badge` is neutral, not success |
| 3 | `.checklist-status-badge.is-done` mismatch | No | N/A |
| 4 | Date-picker icon fix scoped to one input | No | No date inputs here |
| 5 | `.monitor-cell-input` amber hardcode | **Yes** | Still present — `basebi.css:851,852` |
| 6 | `.btn-primary` hover hardcode | Indirect | Still present, fix is global |
| 7 | `.popup-code-block` hardcode | No | N/A |
| 8 | `.login-log-panel` hardcode | No | N/A |
| 9 | `admin-flag-card` dead class | No | N/A |
| 10 | `.checklist-phase`/`.tp-accordion-section` duplicate | No | N/A |
| 11 | Mobile card triplication | No | N/A |
| 12 | `.confirm-box` duplication | **Yes** | Still present — `monitor-report.js:343` |
| 13 | `.mob-note-cards` vs `.mob-card-list` | No | N/A |

**Effort estimate: small-to-medium.** Most changes are localized token/class swaps confined to `monitor-report.js` and a handful of CSS rules; the only genuinely structural item is migrating the destructive delete-report confirm from `.confirm-box` to `.modal.modal-sm` (two call sites, one file) — no schema, data-layer, or cross-cutting logic changes needed.

---

## 6. Admin Hub

**Files audited:** `js/admin-hub.js` (full file, 129 lines), Admin Hub markup in `index.html` (lines 487–493), and all `.admin-flag-*` CSS in `basebi.css` (lines 517–540).

### Section labels

- `.note-list-title` (`index.html:490`) already numerically matches `.section-label` — cheapest fix in this module, pure class swap.

### Badges / status pills

**This is literally the spec's called-out example of the bug.**

- `.admin-flag-status-beta{background:#f59e0b33;color:#f59e0b}` (`basebi.css:534`) hardcodes the exact hex the spec names as the anti-pattern example. Fix: `color-mix(in srgb, var(--amber) 20%, transparent)` + `color:var(--amber)`.
- `.admin-flag-status-on{background:#22c55e33;color:#22c55e}` (`basebi.css:535`) hardcodes a green not equal to `var(--success)`. Fix: `color-mix(in srgb, var(--success) 20%, transparent)` + `color:var(--success)`.
- Radius already compliant (`border-radius:10px`, `basebi.css:532`); `.admin-flag-status-off` already token-based — no gap on those.

### Buttons

- `js/admin-hub.js:60` uses `class="btn btn-ghost" style="font-size:11px"` — an inline override rather than a size-modifier class. Low priority / cosmetic, not called out in the spec's known-bugs list.

### Toast / notification system

- 3 alert sites: `admin-hub.js:101, 114, 121` (all error-path only, no success-path feedback at all today). Fix: route through `.notification-banner.is-error`; consider adding `.is-success` for parity.

### Form inputs

No gaps found — `admin-hub.js:55,85` correctly use canonical `.form-input`; no date inputs in this module.

### Empty states

- `admin-hub.js:44` ("No feature flags found") and `admin-hub.js:83` ("No one has early access yet", with an inline `style="padding:0"` hack) — both explicitly named by the spec (Admin Hub is one of the six modules `.empty-list` absorbs). Fix: rename both; the compact tester-panel site should use an `.empty-list-sm`-style modifier instead of the inline padding override, once available.

### Card containers

- **Known bug #9, confirmed still present, verbatim:** `admin-hub.js:47` appends `admin-flag-card` to `.checklist-template-card`, and grep confirms **no `.admin-flag-card{` rule exists anywhere** in `basebi.css` — a dead class. Admin Hub's cards get their entire visual identity from `.checklist-template-card`, borrowed wholesale exactly as the spec describes. Fix: either delete the dead class, or give feature-flag cards real visual differentiation (e.g. a status-colored left accent stripe). Bonus: the underlying `.checklist-template-card` recipe (8px/`var(--surface2)`/1px border, no shadow) already matches the spec's target `.card` values exactly, so once Card containers migration lands, Admin Hub should compose `.card` directly.
- **Additional, previously-uncatalogued instance of the danger-color hardcode pattern:** `.admin-flag-tester-remove:hover{color:#f87171}` (`basebi.css:540`) — same category of bug as known bug #1, though not one of its literally-cited sites. Fix: `color:var(--danger)`.

### Navigation, Modal/popover/confirm, Tables — not applicable

- Admin Hub is entered via a `.gear-item` settings-menu row, not one of the three nav tiers — out of scope.
- No modals/popovers/confirms anywhere in this module.
- Renders a card grid, not a table.

### Known-bugs checklist — Admin Hub relevance

| # | Bug | Touches Admin Hub? | Status |
|---|-----|---|---|
| 1 | Hardcoded `#f87171` in `.form-hint` | Related instance found | `.admin-flag-tester-remove:hover` hardcodes the same red, not one of the cited sites but same bug family |
| 2 | Four hardcoded "success green" values | No | N/A |
| 3 | `.checklist-status-badge.is-done` mismatch | No | N/A |
| 4 | Date-picker icon fix scoped to one input | No | No date inputs |
| 5 | `.monitor-cell-input` amber hardcode | No | N/A |
| 6 | `.btn-primary` hover hardcode | No | Admin Hub doesn't use `.btn-primary` |
| 7 | `.popup-code-block` hardcode | No | N/A |
| 8 | `.login-log-panel` hardcode | No | N/A |
| **9** | **`admin-flag-card` dead class** | **Yes** | **Confirmed still present, verbatim** — `admin-hub.js:47`, no matching CSS rule |
| 10 | `.checklist-phase`/`.tp-accordion-section` duplicate | No | N/A |
| 11 | Mobile card triplication | No | N/A |
| 12 | `.confirm-box` duplication | No | Admin Hub has no confirm dialogs |
| 13 | `.mob-note-cards` vs `.mob-card-list` | No | N/A |

**Effort estimate: small.** Only 129 lines of JS and ~14 lines of dedicated CSS; every finding is a token/class-name swap (2 hardcoded badge colors, 1 hardcoded danger-hover color, 1 section-label rename, 2 empty-list renames, delete-or-restyle the dead `admin-flag-card` class, route 3 alerts through the toast component) with no structural rework, no data-layer changes, and no modal/table/nav migration needed.

---

## 7. Test Prep Hub

**Files audited:** `js/test-prep.js` (full file, 475 lines), Test Prep Hub markup in `index.html` (accordion shell, exam edit modal, add-task/add-week prompt modal), and all `.tp-*`/`.checklist-*` rule blocks in `basebi.css`.

### Section labels

- `.tp-header-stat-label` (`basebi.css:1065`) is on the explicit retirement list — 10px, no explicit `font-weight` (defaults 400), `em` letter-spacing. Fix: migrate to `.section-label-sub` (9px/700/`.7px`/`var(--text-dim)`, color already matches).

### Badges / status pills

- `SKILL_PALETTE` (`test-prep.js:13`, 8 hardcoded hex values used for skill pills/day-bar segments/legend swatches) duplicates existing tokens as raw hex: `#4ade80` (== `--success`) and `#f87171` (== `--danger`, also the exact hardcode flagged elsewhere as a light-theme bug). Fix: move into `:root` as named custom properties, reference `--success`/`--danger` for the overlapping slots.
- `.tp-skill-pill` composes `.tag-chip` (`border-radius:4px`), not the unified 10px badge convention — app-level fix (`.tag-chip` is shared), TP inherits it.

### Buttons

- `.tp-header-edit-btn` (`basebi.css:1061`, pencil "Edit exam info") is a standalone ad-hoc icon button — matches `.icon-btn`'s use case exactly but hand-rolled at a different radius (4px), no border, no fixed dimensions.
- `.tp-task-del` (`basebi.css:1113`, × delete-task) — dense per-row icon action, best fits `.icon-btn-sm`.
- Already compliant: "+ Log" and "+ Add week" buttons correctly compose `.btn`/`.btn-primary`/`.btn-ghost` — only inherit the shared hover-hardcode bug, no TP-specific fix needed.

### Toast / notification system

- 8 `alert()` sites: `test-prep.js:154, 229, 238, 313, 332, 339, 398, 410`. Route through `.notification-banner`; the "Pick a skill first" guard (line 229) is closer to field-level validation per the spec's carve-out and may warrant inline treatment instead of a toast.

### Modal / popover / confirm

- `test-prep.js:305` (remove week) and `test-prep.js:338` (remove task) both use native `window.confirm()` for destructive, data-loss actions — a step behind even the spec's called-out `.confirm-box` anti-pattern, since it isn't themed or dark-mode aware. Fix: replace both with `.modal.modal-sm` — TP already has an in-module precedent (`tpPromptModalOverlay` replaced `window.prompt()` for the same reason).
- Already compliant: `tpEditModalOverlay` and `tpPromptModalOverlay` already correctly use `.modal.modal-sm`.

### Form inputs

- **Known bug #4, confirmed present:** `tpEditExamDate` (`index.html:695`, plain `.form-input[type="date"]`) does not carry `.task-popover-input`, so its calendar-picker icon is unreadable in dark mode. App-level fix, TP is a confirmed victim.
- Already compliant: `.tp-minutes-input` and `tpPromptInput` correctly use canonical `.form-input`.

### Empty states

- `test-prep.js:215` ("No time logged yet") — one of the ~21 `.note-empty` sites explicitly named for migration to `.empty-list`. Pure rename.

### Card containers

- **Spec explicitly names this component as a `.card` target:** `.tp-header` (`basebi.css:1059`) already matches the `.card` recipe values exactly (8px/`var(--surface2)`/1px border, no shadow) — pure naming/consolidation fix, no value change.
- **Unnamed third instance of a spec-flagged bug:** `.tp-seven-day` (`basebi.css:1097`) has border+radius but no background — the same pattern the spec explicitly calls out for `.dt-legend-row`/`.template-picker-row`, found here during this audit as a previously-uncatalogued third instance. Fix: decide whether it becomes `.card` (add background) or an intentionally borderless box, documented inline.

### Known bugs — Test Prep relevance, including full verification of item 10

| # | Bug | Present in Test Prep? |
|---|-----|---|
| 1 | Hardcoded `#f87171` in `.form-hint` | No |
| 2 | Four hardcoded "success green" values | Partial — `SKILL_PALETTE` hardcodes `#4ade80` duplicating `--success` |
| 3 | `.checklist-status-badge.is-done` mismatch | No — `checklist-status-badge` never used in `test-prep.js` |
| 4 | Date-picker icon fix scoped to one input | **Yes** — `tpEditExamDate` affected and unfixed |
| 5 | `.monitor-cell-input` amber hardcode | No |
| 6 | `.btn-primary` hover hardcode | Indirect — TP's primary buttons inherit the shared bug |
| 7 | `.popup-code-block` hardcode | No |
| 8 | `.login-log-panel` hardcode | No |
| 9 | `admin-flag-card` dead class | No |
| **10** | **`.checklist-phase`/`.tp-accordion-section` duplicate** | **Yes, confirmed present, not yet fixed.** `.checklist-phase` (`basebi.css:601`) and `.tp-accordion-section` (`basebi.css:1082`) share 4 of 5 declarations byte-for-byte (`border`, `border-radius`, `margin-bottom`, `overflow`); `.tp-accordion-section` has one extra (`flex-shrink:0`) for a documented cross-section flex-clipping fix. Both confirmed actively used in `test-prep.js` (`.checklist-phase` at lines 279, 286, 396, 408 for per-week accordions; `.tp-accordion-section` at line 437 for the outer Overview/Time Log/Checklist sections). Fix: merge into one shared `.accordion-card` class, fold `flex-shrink:0` in universally or keep as a modifier. |
| 11 | Mobile card triplication | No |
| 12 | `.confirm-box` duplication | Not directly — TP uses raw `window.confirm()` instead, arguably a worse variant of the same underlying problem; sweep into the same fix |
| 13 | `.mob-note-cards` vs `.mob-card-list` | No |

### Categories checked with no gaps found

- **Navigation** — TP doesn't implement any of the three nav tiers itself; its only navigational element is the shared top-level module tab.
- **Tables** — `.tp-recent-table` is explicitly named by the spec as intentionally exempt from full `.data-table` treatment (read-only reference data) — confirmed compliant as-is.

**Effort estimate: medium.** Most items are quick, low-risk class renames/token swaps (empty-list rename, section-label-sub swap, card composition, tag-chip radius, SKILL_PALETTE tokenization), but migrating 8 `alert()` calls to the new toast component, converting 2 native `confirm()` calls to `.modal.modal-sm`, and merging `.checklist-phase`/`.tp-accordion-section` require real structural JS work with user-facing behavior change and testing.

---

## Cross-module observations

- **No module has adopted any of the spec's new shared classes yet** — every module's Phase 4 PR depends on the relevant shared class(es) landing first (e.g. `.data-table` before Monitor Log's table consolidation; `.card` before any card-family fix; `.notification-banner` before any `alert()` migration). Sequencing these foundational additions (likely as their own small "infrastructure" PR before the seven module PRs) would avoid seven copies of the same boilerplate.
- **`window.confirm()` for destructive actions is more widespread than the known-bugs list captures.** The known-bugs list names `.confirm-box` duplication in three files (`notes.js`, `monitor-report.js`, `checklist-share.js`), but this analysis found four additional modules (Delivery Tracker, Campaign Log, Checklist's template-delete, Test Prep) using raw, unstyled `window.confirm()` for destructive actions — arguably a step behind even the `.confirm-box` anti-pattern the spec already flags. Worth widening the known-bugs list or tracking this as its own cross-cutting item in Phase 4 planning.
- **Two more unnamed "border+radius, no background" card instances were found** beyond the two the spec names (`.dt-legend-row`, `.template-picker-row`): `.tp-seven-day` (Test Prep) is a third confirmed instance. Worth a single sweep across all card-family CSS for this specific bug pattern rather than fixing them one at a time per module.
- **The `.btn-primary:hover{background:#4a7de0}` hardcode (known bug #6) is inherited by all seven modules** since every module consumes `.btn-primary`. It only needs fixing once, in the shared base rule — flagged per-module above for completeness, but should not be duplicated into seven separate PR diffs.

---

*This is a gap analysis only — no functional code changes were made. Fixes described above are scoped for Phase 4 (module-by-module fix PRs), which follow this document separately.*
