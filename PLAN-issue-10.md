# Implementation Plan: Upload Videos to Notion as Embedded Content (#10)

## Goal

After videos are converted to MP4 (via the existing Converter flow), upload each MP4 file to the corresponding Notion class page and embed it inside a **toggle heading 1** titled "Playlist", placed as the **first block** in the page body. Existing page body content must be preserved — never overwritten.

---

## Current State of the Codebase

### What exists today

| Capability | Status | Location |
|---|---|---|
| Scrape HLS video URLs from FIAP | ✅ Done | `src/content-video/` |
| Match classes → Notion page IDs | ✅ Done | `src/notion/` |
| Download HLS → MP4 via ffmpeg | ✅ Done | `src/download/` |
| State tracking (`videosFetched`, `converted`) | ✅ Done | `src/state/` |
| **Write blocks/content to Notion pages** | ❌ Not implemented | — |
| **Upload files to Notion** | ❌ Not implemented | — |

### Key data available at upload time

For each class with converted videos, we already have in state (`data/output.json`):

- `notionPageId` — the Notion page ID for the class (from `matchClassesToNotion`)
- `videos[]` — array of `ContentVideo { title, duration, hlsUrl, converted: boolean }`
- The MP4 file path is deterministic via `getVideoOutputPath(phaseTitle, subjectTitle, classTitle, videoTitle)` in `src/download/index.ts:31`

---

## Architecture Decision: How Notion Handles Video Embeds

### Option A: External file block (link-based) ❌

Notion's `video` block type supports `external.url` — a publicly accessible URL. This would require hosting the MP4 files somewhere (S3, CloudFront, etc.). **Rejected** — adds infrastructure complexity and ongoing hosting costs.

### Option B: Notion-hosted file upload via API ✅ (Selected)

The Notion API does **not** support direct file uploads in block creation. However, as of SDK v5.x, there is a workaround:

1. **Use `notion.blocks.children.append()`** to add `video` blocks with type `file` — but this only works for files already hosted on Notion's CDN.
2. **Alternative**: Use `embed` block type with `url` pointing to the local file — this does **not** work for local files.

**Actual viable approach**: The Notion API (as of 2024-2025) does **not** support uploading arbitrary binary files (MP4) via the API for embedding. The supported path is:

- **`video` block with `external` type**: requires a publicly accessible URL.
- **`file` block with Notion-hosted file**: only for files uploaded through the Notion UI.

### Recommended Strategy: Temporary Public URL via Notion File Upload API

Check if `@notionhq/client` v5.15.0 supports the newer **File Upload API** (`notion.files.upload()`). If available:

1. Upload MP4 → get Notion-hosted file URL
2. Create `video` block referencing the uploaded file

If the File Upload API is **not** available in v5.15.0, the fallback options are:

- **Fallback A**: Upload to a temporary file host (e.g., transfer.sh, or a user-configured S3 bucket) and use `external` URL blocks. Adds env config complexity.
- **Fallback B**: Skip API upload entirely; instead, output a structured summary so the user can manually drag-drop files in Notion. Minimal value.
- **Fallback C**: Use the undocumented internal Notion API for file uploads (fragile, not recommended).

> **Action item (Step 0)**: Before implementation, verify what the Notion SDK v5.15.0 supports for file uploads. Check the SDK source/types for `files.upload()`, `blocks.children.append()` with file-type video blocks, or any `POST /v1/files` endpoint. This determines the entire upload path.

---

## Implementation Plan

### Step 0: Spike — Verify Notion File Upload Capability

**Files**: None (research only)

- [ ] Check `@notionhq/client@5.15.0` types for `notion.files` namespace
- [ ] Test creating a `video` block via `blocks.children.append()` with both `external` and `file` types
- [ ] If SDK lacks file upload, check the [Notion API changelog](https://developers.notion.com/changelog) for the File Upload API and whether it can be called via raw HTTP
- [ ] Document findings — this gates the rest of the plan

**Expected outcome**: Confirm one of:
1. SDK supports `files.upload()` → proceed with direct upload
2. SDK doesn't, but raw API does → add a helper using `fetch()` to call the endpoint
3. Neither works → pivot to external URL approach (user provides S3/hosting config)

---

### Step 1: Add `uploaded` tracking to state

**Files**: `src/content-video/types.ts`, `src/state/types.ts`

Add an `uploaded` boolean flag to `ContentVideo`:

```typescript
// src/content-video/types.ts
export interface ContentVideo {
  title: string;
  duration: string;
  hlsUrl: string;
  converted: boolean;
  uploaded: boolean;  // NEW — true after successfully embedded in Notion
}
```

Update all places that create `ContentVideo` objects to initialize `uploaded: false`:
- `src/content-video/index.ts` — in `scrapeClassVideos()` where videos are mapped (~line 55)

Update `upsertPhase()` in `src/state/index.ts` to preserve `uploaded` alongside `converted` when merging existing classes.

**State migration**: Existing `data/output.json` files won't have `uploaded`. Handle gracefully:
- In `readOutput()` or at the consumer level, default missing `uploaded` to `false`
- No explicit migration needed — TypeScript's optional chaining + defaults handle this

---

### Step 2: Create `src/notion-upload/` module

**New files**:
- `src/notion-upload/index.ts` — core upload logic
- `src/notion-upload/types.ts` — types for upload results/callbacks

#### 2a. File upload helper

```typescript
// src/notion-upload/index.ts

/**
 * Uploads an MP4 file to Notion's file storage.
 * Returns the Notion-hosted file URL/ID for use in video blocks.
 */
async function uploadVideoFile(
  notion: Client,
  filePath: string,
  fileName: string,
): Promise<string> {
  // Implementation depends on Step 0 findings
  // Option 1: notion.files.upload({ file: fs.createReadStream(filePath), ... })
  // Option 2: Raw fetch to POST /v1/files with multipart/form-data
}
```

#### 2b. Page content prepend logic (CRITICAL — must not lose existing content)

This is the most sensitive part. The algorithm:

1. **Read existing children**: `notion.blocks.children.list({ block_id: notionPageId })` — paginate to get ALL existing blocks
2. **Check if "Playlist" toggle H1 already exists**: Look for a `heading_1` block with `is_toggleable: true` and text "Playlist" among the top-level blocks
3. **If "Playlist" toggle exists**: 
   - List its children (`blocks.children.list({ block_id: playlistBlockId })`)
   - Only append NEW video embeds (compare against existing ones to avoid duplicates)
4. **If "Playlist" toggle does NOT exist**:
   - Create the toggle H1 + video embeds as a single `blocks.children.append()` call
   - **Prepend strategy**: The Notion API `blocks.children.append()` only appends (adds to the end). To prepend (insert at the beginning), use the `after` parameter with a careful approach:
     - The API supports `after: <block_id>` to insert after a specific block
     - **To insert at the very beginning**, there is no `before` parameter. Workaround:
       - **Option A**: Append the toggle, then move existing content after it. But Notion API doesn't support reordering blocks.
       - **Option B (Recommended)**: Use `blocks.children.append()` with `after` parameter — as of API version 2022-06-28+, you can pass `after: ""` or use the page ID itself. **Verify this in testing.**
       - **Option C (Reliable fallback)**: Accept that the toggle goes at the end. Then, to move it to the top, delete all existing blocks and re-create them in the correct order (toggle first, then originals). **RISKY** — if the process crashes mid-recreation, content is lost.
       - **Option D (Safest fallback)**: Append at the end instead of prepending. Less ideal UX but zero risk of content loss.

> **Recommendation**: Try Option B first (API `after` parameter). If the API doesn't support inserting before the first block, fall back to Option D (append at end) and document the limitation. **Never delete existing blocks to reorder.**

#### 2c. Block structure for video embeds

Based on the screenshots, each class page should have:

```
▶ Playlist                          ← toggle heading_1
  ├── video1.mp4 embedded           ← video block (type: file or external)
  ├── video2.mp4 embedded           ← video block
  └── video3.mp4 embedded           ← video block
```

Notion API block structure:

```typescript
const toggleBlock = {
  object: 'block',
  type: 'heading_1',
  heading_1: {
    rich_text: [{ type: 'text', text: { content: 'Playlist' } }],
    is_toggleable: true,
    children: videoBlocks,  // Nested children inside the toggle
  },
};

// Each video block (if using external URL):
const videoBlock = {
  object: 'block',
  type: 'video',
  video: {
    type: 'external',  // or 'file' if using Notion-hosted
    external: { url: '<mp4_url>' },
  },
};

// If using Notion-hosted file upload:
const videoBlock = {
  object: 'block',
  type: 'video',
  video: {
    type: 'file',
    file: { url: '<notion_cdn_url>', expiry_time: '<iso_timestamp>' },
  },
};
```

**Important**: Toggle headings support `children` in the `append` call, so the entire structure (toggle + nested videos) can be created in a single API call.

#### 2d. Main upload orchestrator

```typescript
export async function uploadPhaseVideos(
  notion: Client,
  phaseTitle: string,
  subjects: StateSubject[],
  options?: {
    onClassDone?: (result: { classTitle: string; uploadedCount: number }) => void;
  },
): Promise<number> {
  let totalUploaded = 0;

  for (const subject of subjects) {
    for (const cls of subject.classes) {
      if (!cls.notionPageId) continue;

      const unconvertedVideos = cls.videos.filter((v) => v.converted && !v.uploaded);
      if (unconvertedVideos.length === 0) continue;

      // 1. Upload each MP4 file to Notion (or get external URL)
      const videoBlockData = [];
      for (const video of unconvertedVideos) {
        const mp4Path = getVideoOutputPath(phaseTitle, subject.title, cls.title, video.title);
        // Upload and collect block data...
        videoBlockData.push(/* ... */);
      }

      // 2. Prepend/append toggle with video blocks to the page
      await prependPlaylistToggle(notion, cls.notionPageId, videoBlockData);

      totalUploaded += unconvertedVideos.length;
      options?.onClassDone?.({ classTitle: cls.title, uploadedCount: unconvertedVideos.length });
    }
  }

  return totalUploaded;
}
```

---

### Step 3: Add `setVideoUploaded()` to state module

**File**: `src/state/index.ts`

```typescript
export function setVideoUploaded(
  output: ScraperOutput,
  phaseTitle: string,
  classTitle: string,
  videoTitle: string,
): ScraperOutput {
  // Same pattern as setVideoConverted, but sets uploaded: true
}
```

This follows the exact same immutable update pattern as `setVideoConverted()` (line 82).

---

### Step 4: Add "Uploader" mode to CLI

**Files**: `src/cli/index.ts`, `src/index.ts`

#### 4a. CLI additions

Add to `AppMode`:
```typescript
export type AppMode = 'scraper' | 'converter' | 'uploader' | 'exit';
```

New functions:
- `selectUploaderPhase()` — similar to `selectConverterPhase()`, shows `[U]` upload status
- `selectUploaderAction()` — "Upload Videos to Notion" / "Continue uploading"

Update `selectMode()` to include "Notion Uploader" option (disabled if no converted videos exist).

#### 4b. Main loop — `runUploader()`

**File**: `src/index.ts`

```typescript
async function runUploader(): Promise<void> {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  while (true) {
    const output = readOutput();
    const eligiblePhases = output.phases.filter((p) =>
      p.subjects.some((s) => s.classes.some((c) =>
        c.notionPageId && c.videos.some((v) => v.converted && !v.uploaded)
      ))
    );

    if (eligiblePhases.length === 0) {
      console.log('⚠️  No phases with converted videos ready for upload.');
      return;
    }

    // Phase selection + action prompt (same pattern as converter)
    // ...

    const spinner = ora('[uploader] Uploading videos to Notion...').start();
    let currentOutput = readOutput();

    await uploadPhaseVideos(notion, selectedPhase.title, selectedPhase.subjects, {
      onClassDone: ({ classTitle, uploadedCount }) => {
        // Mark videos as uploaded in state
        // Write state immediately (incremental persistence)
        spinner.text = `[uploader] Uploaded ${classTitle} (${uploadedCount} videos)`;
      },
    });

    spinner.succeed('[uploader] All videos uploaded');
  }
}
```

Add to `main()`:
```typescript
if (mode === 'uploader') await runUploader();
```

#### 4c. CLI status indicators update

Update `selectPhase()` to show upload status `[U]` alongside existing `[S][V]`:
```
[S][V][U]  S = Synced · V = Videos · U = Uploaded (✓ all · ~ partial)
```

---

### Step 5: Update CLAUDE.md

**File**: `CLAUDE.md`

- Add `src/notion-upload/` module description
- Document the `uploaded` flag semantics
- Add the Notion block structure for video embeds
- Update the execution flow to include the Uploader step

---

## File Change Summary

| File | Change Type | Description |
|---|---|---|
| `src/content-video/types.ts` | Modify | Add `uploaded: boolean` to `ContentVideo` |
| `src/content-video/index.ts` | Modify | Initialize `uploaded: false` in scrapeClassVideos |
| `src/state/index.ts` | Modify | Add `setVideoUploaded()`, preserve `uploaded` in `upsertPhase` |
| `src/notion-upload/index.ts` | **New** | Upload orchestrator, file upload helper, prepend logic |
| `src/notion-upload/types.ts` | **New** | Upload result/callback types |
| `src/notion/index.ts` | Modify (maybe) | Export shared helpers if needed by notion-upload |
| `src/cli/index.ts` | Modify | Add uploader mode, phase selector, action prompts |
| `src/index.ts` | Modify | Add `runUploader()`, wire into main loop |
| `CLAUDE.md` | Modify | Document new module and flow |

---

## Critical Constraints & Edge Cases

### 1. No content loss (HIGHEST PRIORITY)

- **Never delete existing blocks** from a Notion page
- The "Playlist" toggle must be **added** to the page, not replace content
- If the "Playlist" toggle already exists (re-upload scenario), append new videos inside it — don't recreate it
- Always check for existing toggle before creating a new one

### 2. Idempotency

- The `uploaded` flag prevents re-uploading videos that were already embedded
- If a partial upload is interrupted, re-running should resume from where it left off (same pattern as `videosFetched` and `converted`)
- The `onClassDone` callback writes state immediately after each class (crash safety)

### 3. Rate limiting

- Notion API has rate limits (~3 requests/second)
- Upload sequentially, one class at a time (same pattern as video scraping)
- Add small delays between API calls if needed (e.g., 350ms between `blocks.children.append` calls)

### 4. File size limits

- Notion API may have file size limits for uploads (typically 5MB for free, higher for paid)
- MP4 lecture videos can be large (100MB+). If the File Upload API has limits:
  - Log a warning for files exceeding the limit
  - Skip those files and mark them with an error state
  - Consider adding a `NOTION_FILE_SIZE_LIMIT_MB` env var

### 5. Missing `notionPageId`

- Some classes may not have a matched Notion page (unmatched during sync)
- Skip these classes with a warning — don't fail the entire upload

### 6. Missing MP4 file

- A video marked `converted: true` might have its MP4 file manually deleted
- Check `fs.existsSync()` before attempting upload
- Log warning and skip if file is missing

---

## Sequence Diagram

```
User selects "Notion Uploader" mode
  │
  ├─ Select phase (only phases with converted + unuploaded videos)
  │
  ├─ For each class with notionPageId:
  │    │
  │    ├─ Filter videos: converted=true AND uploaded=false
  │    │
  │    ├─ For each video:
  │    │    ├─ Resolve MP4 path via getVideoOutputPath()
  │    │    ├─ Upload MP4 to Notion (or get external URL)
  │    │    └─ Collect video block data
  │    │
  │    ├─ Check if "Playlist" toggle H1 exists on page
  │    │    ├─ YES → Append new video blocks inside existing toggle
  │    │    └─ NO  → Prepend new toggle H1 with video blocks as children
  │    │
  │    ├─ Mark videos as uploaded=true in state
  │    ├─ Write state to disk (incremental)
  │    └─ Log progress
  │
  └─ Done
```

---

## Open Questions (to resolve during implementation)

1. **Does the Notion SDK v5.15.0 support file uploads?** This is the single biggest unknown. Step 0 must be done first.
2. **Can `blocks.children.append()` insert at position 0 (before existing blocks)?** If not, the toggle goes at the end.
3. **Is there a file size limit for Notion file uploads via API?** Affects whether large lecture videos can be uploaded.
4. **Should we support re-uploading (overwriting) previously uploaded videos?** Current plan is skip-if-uploaded; user would need to manually delete the Playlist toggle and reset `uploaded` flags to re-upload.
