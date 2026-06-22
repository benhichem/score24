# score24

## Project Overview
**score24** is a **Bun**‑based starter project intended to become a small web application with a React frontend. Currently the repository contains only a placeholder Puppeteer script (`index.ts`) that navigates to the project's own GitHub page. The required front‑end files (`index.html`, `frontend.tsx`) and the `src/` directory are not yet present, so the app cannot be served as a web UI. However, the scaffold follows the conventions outlined in `CLAUDE.md`, allowing you to extend it into a full Bun‑served React app.

## Directory Structure (current)
```
score24/
├── index.ts          # Puppeteer utility script (placeholder)
├── CLAUDE.md         # Development instructions and architecture notes
├── README.md         # This file
└── .claude/          # Claude Code configuration (memory, settings, etc.)
```

*Expected (missing) files:*
- `index.html` – HTML entry point that loads the React bundle.
- `frontend.tsx` – React component rendered on the page (`React.createRoot`).
- `src/` – folder for future TypeScript source files (components, utils, etc.).
- `index.css` – optional stylesheet imported by `frontend.tsx`.

## How to Run the Existing Script
1. **Install dependencies**
   ```bash
   bun install
   ```

2. **Execute the Puppeteer script**
   ```bash
   bun run index.ts
   ```
   You should see output indicating navigation to `https://github.com/benhichem/score24`.

## Planned Architecture (per CLAUDE.md)
- **Runtime** – Bun v1.x (`bun`, `bun test`, `bun build`).
- **Server entry point** – `index.ts` will eventually use `Bun.serve()` to:
  - Serve static assets (`index.html`, bundled JS/CSS).
  - Provide API routes (e.g., `/api/users/:id` returning JSON).
  - Optionally enable WebSocket support via a `websocket` key.
- **Frontend** – `frontend.tsx` will be a React 18 component rendered with `createRoot`; it can import CSS directly (`import './index.css'`).
- **Static assets** – Any `.html`, `.tsx`, `.jsx`, `.js`, or `.css` referenced from the HTML will be bundled automatically by Bun.
- **Project layout** – As shown above, with `src/` holding application code.

## Next Steps
1. **Create the front‑end scaffold**
   - Add `index.html` with a `<div id="root"></div>` and a `<script type="module" src="./frontend.tsx"></script>` tag.
   - Add `frontend.tsx` containing a simple React component (e.g., a heading).
   - Optionally add `index.css` for basic styling.
2. **Move or replace the Puppeteer logic**
   - If you need scraping, consider extracting it into a utility module or an API route (`/api/scrape`) rather than keeping it in `index.ts`.
   - Otherwise, replace `index.ts` with a proper `Bun.serve()` implementation that serves the static files and defines any needed API endpoints.
3. **Add source code**
   - Populate `src/` with components, hooks, utilities written in TypeScript (`.ts` or `.tsx`).
   - Import them into `frontend.tsx`.
4. **Test and build**
   - Run the dev server: `bun --hot ./index.ts`
   - Run tests: `bun test`
   - Build static assets for production: `bun build index.html` (and similar for TSX/CSS).
5. **Lint/format** – Add a linter (e.g., ESLint) via `bunx` as shown in `CLAUDE.md`.

## Development Commands Recap
| Purpose                                 | Command                                 |
| --------------------------------------- | --------------------------------------- |
| Install dependencies                    | `bun install`                           |
| Run the current Puppeteer script        | `bun run index.ts`                      |
| Start hot‑reloading dev server (once implemented) | `bun --hot ./index.ts`                |
| Execute test suite                      | `bun test`                              |
| Build a static asset (HTML, TSX, CSS)   | `bun build index.html` / `frontend.tsx` / `index.css` |
| Lint (example)                          | `bunx eslint . --ext .ts,.tsx`          |

---
*This README was generated to reflect the current state of the repository and to guide further development. Refer to `CLAUDE.md` for detailed architectural notes.*
