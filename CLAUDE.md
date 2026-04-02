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
7. `content-video/` — For each unfetched class, open a new tab, navigate to `contentUrl`, scrape `pos_videos_container` inside `#iframecontent`, extract all playlist videos (title, duration, HLS URL derived from thumbnail CDN hash), write to state, close tab

**Module layout**:
- `src/auth/` — Login and course page access verification
- `src/phases/` — Scrape phase list; `getPhaseDisplayTitle()` builds the human-readable label from `Phase.topic`
- `src/subjects/` — Complex DOM evaluation to build `Subject → ClassItem[]` hierarchy
- `src/notion/` — Resolve Notion collection IDs and match scraped classes to Conteúdo entries
- `src/cli/` — Interactive phase selector using `@inquirer/prompts`
- `src/content-video/` — Sequential video scraper; `getAllVideos()` opens one tab per class, closes after scraping, calls `onClassDone` callback for incremental persistence
- `src/state/` — Read/write `output/output.json`; `upsertPhase()` merges scraped data preserving existing videos; `setPhaseVideos()` marks classes as fetched
- `src/constants/` — FIAP URLs (single source of truth)
- `src/utils.ts` — `assertNotBlocked(page)`: detects CloudFront WAF block pages by checking `document.title` for "error"; called after every `page.goto()`

**Key types** (in each module's `types.ts`):
- `Phase`: title, topic (from "Welcome to \<topic\>" marker), isActive, index, courseId
- `Subject`: title, classes (ClassItem[])
- `ClassItem`: title, contentUrl, pdfUrl, progress
- `ContentVideo`: title, duration, hlsUrl
- `ClassVideos`: classTitle, videos (ContentVideo[])
- `StateClass`: extends ClassItem with notionPageId, videosFetched (bool), videos (ContentVideo[])
- `ScraperOutput`: phases (StatePhase[]), lastUpdated (ISO timestamp)

**DOM scraping pattern**: `phases/` uses `page.$$eval()` for batch extraction; `subjects/` uses a single `page.evaluate()` call running client-side JS against the full document.

## State Persistence

All scraping output is persisted to `output/output.json` (gitignored). This file is the single source of truth for sync and video fetch status across runs.

**`videosFetched` flag**: set to `true` on a class only after `scrapeClassVideos()` completes successfully. A partial fetch (e.g. interrupted mid-run) leaves unfetched classes with `videosFetched: false`, so re-running resumes from where it stopped. Never pre-set this flag — it must only be written after confirmed completion.

**Incremental writes**: `onClassDone` callback in `getAllVideos()` writes each class to disk immediately after scraping it, so a crash never loses completed work.

**Resync safety**: `upsertPhase()` looks up each class by subject title + class title and preserves its `videos` and `videosFetched`. A resync only overwrites scraped metadata (contentUrl, pdfUrl, progress, notionPageId). Renamed classes are treated as new (videos reset).

## CLI Status Indicators

The phase selector shows `[S][V]` prefixes:
- `S` — synced (subjects/classes scraped and matched to Notion)
- `V` — videos: `✓` all fetched · `~` partially fetched · ` ` none fetched

Action menu CTA adapts based on video status: `"Get Videos"` / `"Continue fetching videos"` / `"Re-fetch Videos"`.

## CloudFront Rate Limiting

FIAP video content is served via CloudFront with a WAF rule that blocks rapid parallel requests. Opening multiple tabs simultaneously (even with staggered delays) triggers 403 blocks mid-run.

**Strategy**: always fetch videos sequentially, one class at a time, each in its own tab that is closed immediately after. Do not parallelize or batch class content page requests. The main page (course listing) is never navigated during video fetching — only new tabs are used.

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

## FIAP Class Content Page Structure

Each `ClassItem.contentUrl` points to `https://on.fiap.com.br/mod/conteudoshtml/view.php?id=...`.
The video content is inside an iframe (`#iframecontent`) which loads a separate HTML page.

**Accessing the iframe**: `document.querySelector('#iframecontent').contentDocument` (same-origin, accessible directly).

Inside the iframe, the `.pos_videos_container` div holds the entire video player UI:

```
.pos_videos_container
  .pos_videos_header          ← "Vídeo X de Y" (e.g. "Vídeo 01 de 04")
  .pos_videos_features
    pos-highlighted-video.feature_highlighted
      .pos_highlighted_video
        iframe[src]           ← embed URL for the *currently selected* video only:
                                  https://on.fiap.com.br/local/streaming/embed.php?video={videoHash}
    pos-playlist.feature_playlist
      .pos_playlist_container
        .pos-playlist-items
          .pos-playlist-item[.selected]   ← one per video; .selected = currently playing
            .pos-playlist-image-thumbnail (img[src])  ← thumbnail URL (see HLS derivation below)
            .pos-playlist-number-thumbnail            ← "01", "02", …
            .pos-playlist-item-title                  ← video title
            .pos-playlist-duration                    ← "MM:SS"
            .pos-playlist-progress-bar                ← progress status text
```

**HLS URL derivation** (no need to navigate to embed pages):

The thumbnail URL and HLS master playlist share the same CDN hash:
- Thumbnail: `https://d1l755to62lquf.cloudfront.net/{hash}/Thumbnails/file.0000001.jpg`
- HLS:       `https://d1l755to62lquf.cloudfront.net/{hash}/HLS/file.m3u8`

Extract the hash from any playlist item's thumbnail `src` and substitute the path suffix to get the HLS URL. This works for all videos in the playlist without clicking or navigating.

**Embed page** (`embed.php?video={videoHash}`): Video.js player initialized via `[data-setup]` attribute:
```json
{ "sources": { "type": "application/x-mpegURL", "src": "https://.../{hash}/HLS/file.m3u8" }, ... }
```
The embed page is only needed if the thumbnail-based derivation ever fails.

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
- Imports use relative paths (e.g., `import { FIAP_URLS } from '../constants'`) — bare imports like `'constants'` collide with `@types/node` built-ins
- Prettier enforced: single quotes, semicolons, trailing commas, 100-char print width
- `ora` is pinned to **v5** — v6+ dropped CommonJS support and will break this project (`"module": "commonjs"` in `tsconfig.json`)
