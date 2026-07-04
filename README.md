# base·bi

A self-hosted knowledge management and note-taking app — built with vanilla JS and Supabase. No build step, no framework overhead.

🔗 **Live app:** [basebi.net](https://basebi.net) · [basebi.pages.dev](https://basebi.pages.dev) (alternate)

---

## Features

- **Notes** — Split-pane editor with Plain and Code note types, syntax highlighting for SQL
- **Daily Notes** — Quick-append journal entries with automatic timestamps (`Ctrl+Alt+D`)
- **Organization** — Folders, tags, and full-text search with an inverted index
- **Wiki-linking** — Connect notes with `[[Title]]` syntax and view backlinks
- **Graph Mode** — Interactive, pan/zoom graph of note relationships, clustered by folder
- **Checklists** — Reusable, multi-section checklist templates with progress tracking 
- **Team Sharing** — View-only shared workspace for team notes, with author attribution in search
- **Auth** — Supabase Auth login gate

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS
- **Backend:** [Supabase](https://supabase.com) — PostgreSQL, Row-Level Security enforced on all tables
- **Hosting:** GitHub Pages (primary) + Cloudflare Pages (fallback)
- **Version control:** Git + GitHub, branch protection on `main` (PR required)

---

## Project Structure

```
basebi/
├── index.html          # Main application (notes, campaign log, checklist, graph mode, admin)
├── basebi.css          # Stylesheet (dark mono theme)
├── basebi.html         # Legacy redirect stub — kept for backward-compatible links
└── ...
```
---

## License

*(private / internal use — add explicit license text if this ever needs to be shared externally)*
