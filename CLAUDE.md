# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs TypeScript directly)
npm run dev

# Build TypeScript to dist/
npm run build

# Build then run compiled output
npm run build:start

# Format code
npm run format
```

No test runner is configured yet. Node.js >= 24.x and npm >= 11.x required.

## Architecture

This is a TypeScript + Puppeteer web scraper that authenticates on the FIAP course platform, extracts course structure, matches classes to Notion, and (next) uploads HLS videos.

**Execution flow** (`src/index.ts`):
1. Launch Puppeteer browser
2. `auth/` — Log in with credentials from `.env`, navigate to course page
3. `phases/` — Scrape all available phases
4. `cli/` — Interactive prompt: user selects a phase; loops until exit
5. `subjects/` — Scrape subjects and classes for the selected phase
6. `notion/` — Resolve Conteúdo DB collection ID, match `ClassItem.title` → Notion page ID
7. (Next) Extract HLS video URLs from each class's `contentUrl`, upload to Notion

**Module layout**:
- `src/auth/` — Login and course page access verification
- `src/phases/` — Scrape phase list; `getPhaseDisplayTitle()` builds the human-readable label from `Phase.topic`
- `src/subjects/` — Complex DOM evaluation to build `Subject → ClassItem[]` hierarchy
- `src/notion/` — Resolve Notion collection IDs and match scraped classes to Conteúdo entries
- `src/cli/` — Interactive phase selector using `@inquirer/prompts`
- `src/constants/` — FIAP URLs (single source of truth)

**Key types** (in each module's `types.ts`):
- `Phase`: title, topic (from "Welcome to \<topic\>" marker), isActive, index, courseId
- `Subject`: title, classes (ClassItem[])
- `ClassItem`: title, contentUrl, pdfUrl, progress

**DOM scraping pattern**: `phases/` uses `page.$$eval()` for batch extraction; `subjects/` uses a single `page.evaluate()` call running client-side JS against the full document.

## Environment

Copy `.env.example` to `.env`:
```
FIAP_USERNAME=...
FIAP_PASSWORD=...
NOTION_TOKEN=...           # Notion integration token
NOTION_PHASES_DB_ID=...    # Page ID of the top-level Fases database (not the collection ID — resolved internally)
```

All four vars are validated at startup — the scraper will fail fast if any are missing.

## FIAP Course Page Structure

The course page DOM hierarchy relevant to scraping:
- `.conteudo-digital-disciplina-content` — one per phase
  - `.conteudo-digital-disciplina-fase[data-fase="<courseId>"]` — phase header; holds title and ID
- `.conteudo-digital-list` — sibling of the above; contains all subjects and classes for that phase
  - `.conteudo-digital-item.is-marcador` — subject header row
  - `.conteudo-digital-item` (without `is-marcador`) — class row under the preceding subject
    - `.conteudo-digital-txt-name` — title
    - `.t-conteudo-digital` — link to the video/content page (`contentUrl`)
    - `.t-conteudo-pdf` — link to the PDF (`pdfUrl`)
    - `.t-conteudo-atividades` — marks activity items (assignments/quizzes) — **skipped**
    - `.progresso-conteudo[data-porcentagem]` — completion percentage

Phase active detection: completed courses have no reliable CSS/ARIA active marker — `isActive` is best-effort and only used to pre-select the default in the CLI prompt. Phase selection is always user-driven.

Items skipped during subject scraping (section headers, not real content):
- `is-marcador` items starting with `"Welcome"` or `"Atividade:"`
- Regular items titled `"Conteúdos externos"`

## Notion Workspace Structure

```
Fases DB (NOTION_PHASES_DB_ID)          ← top-level, one row per phase
  └── Fase N                            ← matched by "Fase N" prefix (FIAP full titles include a subtitle after " - ")
        ├── Disciplinas DB (inline)     ← not used yet
        └── Conteúdo DB (inline)        ← one row per class, matched by ClassItem.title
              schema: Name (title), Disciplina (relation), Status, Docs (file), Período (date)
```

**Notion SDK v5.15.0 quirk**: `databases.query` was removed. Use `dataSources.query({ data_source_id })` where `data_source_id` is the **collection ID**, not the database page ID. Bridge via `databases.retrieve(pageId).data_sources[0].id` — see `resolveDataSourceId()` in `src/notion/index.ts`.

Inline databases (Disciplinas, Conteúdo) have unique IDs per Fase page and are discovered at runtime by listing child blocks (`blocks.children.list`) and filtering for `child_database` blocks by title.

## Code Conventions

- Strict TypeScript (`tsconfig.json` has `strict: true`)
- Imports resolve from `src/` as base URL (e.g., `import { FIAP_URLS } from 'constants'`)
- Prettier enforced: single quotes, semicolons, trailing commas, 100-char print width
- `ora` is pinned to **v5** — v6+ dropped CommonJS support and will break this project (`"module": "commonjs"` in `tsconfig.json`)
