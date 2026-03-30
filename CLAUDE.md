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

This is a TypeScript + Puppeteer web scraper that authenticates on the FIAP course platform, extracts course structure, and (eventually) downloads/uploads materials to Notion.

**Execution flow** (`src/index.ts`):
1. Launch Puppeteer browser
2. `auth/` — Log in with credentials from `.env`, navigate to course page
3. `phases/` — Scrape available phases, identify the active one
4. `subjects/` — Scrape subjects and their classes within the active phase
5. (Planned) Download PDFs and videos, upload to Notion

**Module layout**:
- `src/auth/` — Login and course page access verification
- `src/phases/` — Extract phase list and active phase from DOM
- `src/subjects/` — Complex DOM evaluation to build `Subject → ClassItem[]` hierarchy
- `src/constants/` — FIAP URLs (single source of truth)

**Key types** (in each module's `types.ts`):
- `Phase`: title, isActive, index, courseId
- `Subject`: title, classes (ClassItem[])
- `ClassItem`: title, contentUrl, pdfUrl, progress

**DOM scraping pattern**: `phases/` uses `page.$$(selector)` + `element.evaluate()` for per-element extraction; `subjects/` uses a single `page.evaluate()` call running client-side JS against the full document.

## Environment

Copy `.env.example` to `.env` and fill in FIAP credentials:
```
FIAP_USERNAME=...
FIAP_PASSWORD=...
```

Credentials are validated at runtime — the scraper will fail fast if they are missing.

## Code Conventions

- Strict TypeScript (`tsconfig.json` has `strict: true`)
- Imports resolve from `src/` as base URL (e.g., `import { FIAP_URLS } from 'constants'`)
- Prettier enforced: single quotes, semicolons, trailing commas, 100-char print width
