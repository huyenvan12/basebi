# base·bi

An internal BI / productivity tool for the Loyalty Team — built with vanilla JS (native ES modules) and Supabase. No build step, no framework overhead.

🔗 **Live app:** [basebi.net](https://basebi.net) · [basebi.pages.dev](https://basebi.pages.dev) (alternate / workplace-accessible fallback)

---

## Features

- **Notes** — Split-pane editor with Plain and Code note types, syntax highlighting for SQL
- **Daily Notes** — Quick-append journal entries with automatic timestamps (`Ctrl+Alt+D`)
- **Organization** — Folders, tags, and full-text search with an inverted index
- **Wiki-linking** — Connect notes with `[[Title]]` syntax and view backlinks
- **Graph Mode** — Interactive, pan/zoom graph of note relationships, clustered by folder
- **Campaign Log** — Tracking and logging for CRM/marketing campaigns
- **Checklists** — Reusable, multi-section templates, personal checklist runs, and sharing across the team
- **Monitor Log** — Report tracking with edited-value indicators, US-style number formatting, and template cloning
- **Delivery Tracker** — Delivery status tracking
- **Admin Hub** — Feature flag management and team member administration
- **Team Sharing** — Shared workspace for team notes/checklists, with author attribution in search
- **Auth** — Supabase Auth login gate, with row-level security scoping data by owner

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — native ES modules, no bundler
- **Backend:** [Supabase](https://supabase.com) — PostgreSQL 17, Row-Level Security enforced on all tables (region: `ap-southeast-1`)
- **Hosting:** GitHub Pages (primary) + Cloudflare Pages (fallback, static file serving)
- **Mobile:** Mobile web is the primary mobile access path for the team; a Capacitor Android wrapper exists mainly for local device testing
- **Version control:** Git + GitHub, branch protection on `main` (PR required)

---

## Project Structure

```
basebi/
├── index.html                   # Thin app shell
├── basebi.css                   # Stylesheet (dark mono theme)
├── basebi.html                  # Legacy redirect stub — kept for backward-compatible links
├── js/
│   ├── main.js                  # Entry point / app bootstrap
│   ├── constants.js             # Shared constants
│   ├── supabase-client.js       # Supabase client setup
│   ├── state.js                 # App state management
│   ├── ui-helpers.js            # Shared UI utilities
│   ├── folders.js                # Folder management
│   ├── notes.js                  # Notes CRUD, wiki-linking
│   ├── daily-note.js             # Daily note quick-append
│   ├── campaigns.js              # Campaign Log
│   ├── checklist-templates.js    # Checklist template CRUD
│   ├── checklist-instances.js    # Personal checklist runs
│   ├── checklist-share.js        # Checklist sharing
│   ├── monitor-report.js         # Monitor Log
│   └── graph-view.js             # Graph mode rendering
└── ...
```

---

## License

*(private / internal use — add explicit license text if this ever needs to be shared externally)*
