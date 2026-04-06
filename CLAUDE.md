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

This is a TypeScript CLI tool for the FIAP course platform. It has two modes: a **Scraper** (Puppeteer) that authenticates, extracts course structure, matches classes to Notion, and scrapes HLS video URLs; and a **Video Converter** (ffmpeg) that downloads those HLS streams and remuxes them to MP4.

**Top-level flow** (`src/index.ts`):

1. `selectMode()` — user picks Scraper, Video Converter, or Exit. Converter is disabled when no scraped data exists.
2. **Scraper** (`runScraper()`): validates env vars → launches Puppeteer → auth → phase list → `while(true)` loop (select phase → sync or get-videos)
3. **Converter** (`runConverter()`): validates ffmpeg on PATH → reads `data/output.json` → `while(true)` loop (select phase → convert videos). Fully offline — no browser, no Notion.

**Module layout**:

- `src/auth/` — Login and course page access verification
- `src/phases/` — Scrape phase list; `getPhaseDisplayTitle()` builds the human-readable label from `Phase.topic`
- `src/subjects/` — Complex DOM evaluation to build `Subject → ClassItem[]` hierarchy
- `src/notion/` — Resolve Notion collection IDs and match scraped classes to Conteúdo entries
- `src/cli/` — Top-level mode selector, scraper phase/action selectors, converter phase/action selectors; all using `@inquirer/prompts`
- `src/content-video/` — Sequential video URL scraper; `getAllVideos()` opens one tab per class, closes after scraping, calls `onClassDone` callback for incremental persistence
- `src/download/` — Video converter; `convertPhaseVideos()` downloads all unconverted videos in parallel via ffmpeg (`-c copy` remux to MP4), calls `onVideoDone`/`onProgress` callbacks
- `src/state/` — Read/write `data/output.json`; `upsertPhase()` merges scraped data preserving existing videos and conversion status; `setPhaseVideos()` marks classes as fetched; `setVideoConverted()` marks individual videos as converted
- `src/constants/` — FIAP URLs (single source of truth)
- `src/utils.ts` — `assertNotBlocked(page)`: detects CloudFront WAF block pages by checking `document.title` for "error"; called after every `page.goto()`

**Key types** (in each module's `types.ts`):

- `Phase`: title, topic (from "Welcome to \<topic\>" marker), isActive, index, courseId
- `Subject`: title, classes (ClassItem[])
- `ClassItem`: title, contentUrl, pdfUrl, progress
- `ContentVideo`: title, duration, hlsUrl, converted (bool)
- `ClassVideos`: classTitle, videos (ContentVideo[])
- `StateClass`: extends ClassItem with notionPageId, videosFetched (bool), videos (ContentVideo[])
- `StatePhase`: title (display title from `getPhaseDisplayTitle()`), subjects (StateSubject[])
- `ScraperOutput`: phases (StatePhase[]), lastUpdated (ISO timestamp)

**DOM scraping pattern**: `phases/` uses `page.$$eval()` for batch extraction; `subjects/` uses a single `page.evaluate()` call running client-side JS against the full document.

## State Persistence

All scraping output is persisted to `data/output.json` (gitignored via `data/`). This file is the single source of truth for sync, video fetch, and conversion status across runs.

**`StatePhase.title`**: stores the display title from `getPhaseDisplayTitle()` (e.g. "Fase 1 - Desenvolvimento avançado"), not the raw FIAP DOM title. All lookups in state — `upsertPhase`, `setPhaseVideos`, `setVideoConverted` — match by this display title.

**`videosFetched` flag**: set to `true` on a class only after `scrapeClassVideos()` completes successfully. A partial fetch (e.g. interrupted mid-run) leaves unfetched classes with `videosFetched: false`, so re-running resumes from where it stopped. Never pre-set this flag — it must only be written after confirmed completion.

**`converted` flag**: set to `true` on each `ContentVideo` after successful ffmpeg conversion. Same resume pattern — unconverted videos are retried on next run. Written per-video via `setVideoConverted()`.

**Incremental writes**: both scraper (`onClassDone`) and converter (`onVideoDone`) write to disk immediately after each unit completes, so a crash never loses completed work.

**Resync safety**: `upsertPhase()` looks up each class by subject title + class title and preserves its `videos` and `videosFetched`. A resync only overwrites scraped metadata (contentUrl, pdfUrl, progress, notionPageId). Renamed classes are treated as new (videos reset).

## Video Conversion

Converted videos are stored at `data/videos/<phase>/<subject>/<class>/<video>.mp4` (gitignored). Titles are sanitized for filesystem safety (unsafe chars replaced with `_`).

**ffmpeg**: requires system ffmpeg on PATH. Static npm binaries (`ffmpeg-static`, `@ffmpeg-installer/ffmpeg`) crash on TLS when fetching HLS from CloudFront — do not use them. Validated at converter startup via `assertFfmpegAvailable()`.

**Download strategy**: all unconverted videos in a phase download in parallel via `Promise.all`, each spawning its own ffmpeg process. Uses `-c copy` (remux, no re-encoding) and `-movflags +faststart`. Parallelism is safe here — ffmpeg fetches `.ts` segments directly from the CDN, not through the WAF-protected course pages. Concurrency can be limited via the `FFMPEG_CONCURRENCY` env var (e.g. `FFMPEG_CONCURRENCY=5`); when unset, all videos download at once.

**Progress display**: single ora spinner shows overall count and current video progress (`time=HH:MM:SS`). Completed videos log a `✓` line above the spinner.

## CLI Structure

**Top-level**: `selectMode()` — Scraper / Video Converter (disabled if no `data/output.json`) / Exit.

**Scraper phase selector** shows `[S][V]` prefixes:

- `S` — synced (subjects/classes scraped and matched to Notion)
- `V` — videos: `✓` all fetched · `~` partially fetched · ` ` none fetched

Action menu CTA adapts based on video status: `"Get Videos"` / `"Continue fetching videos"`.

**Converter phase selector** shows `[C]` prefix:

- `C` — converted: `✓` all · `~` partial · ` ` none

Only phases with fetched videos appear. Fully converted phases are disabled.

## CloudFront Rate Limiting

FIAP video content pages are served via CloudFront with a WAF rule that blocks rapid parallel requests. Opening multiple browser tabs simultaneously (even with staggered delays) triggers 403 blocks mid-run.

**Scraper strategy**: always fetch video URLs sequentially, one class at a time, each in its own tab that is closed immediately after. Do not parallelize or batch class content page requests. The main page (course listing) is never navigated during video fetching — only new tabs are used.

**Converter strategy**: video downloads (ffmpeg fetching HLS segments from CDN) are NOT subject to the WAF and run in parallel safely.

## Environment

Copy `.env.example` to `.env`:

```
FIAP_USERNAME=...
FIAP_PASSWORD=...
NOTION_TOKEN=...           # Notion integration token
NOTION_PHASES_DB_ID=...    # Page ID of the top-level Fases database (not the collection ID — resolved internally)
FFMPEG_CONCURRENCY=...     # Optional — max parallel ffmpeg processes (default: unlimited)
```

Scraper vars are validated when entering **Scraper mode** only — not at global startup. The Video Converter mode is fully offline and only needs `data/output.json` + system ffmpeg.

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
- HLS: `https://d1l755to62lquf.cloudfront.net/{hash}/HLS/file.m3u8`

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
