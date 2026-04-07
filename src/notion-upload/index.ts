import fs from 'fs';
import path from 'path';
import { Client, isNotionClientError } from '@notionhq/client';
import {
  BlockObjectResponse,
  BlockObjectRequest,
  Heading1BlockObjectResponse,
  BlockObjectRequestWithoutChildren,
} from '@notionhq/client/build/src/api-endpoints';
import { getVideoOutputPath } from '../download';
import { StateSubject } from '../state/types';
import { UploadClassDoneResult } from './types';

/** Files ≤ 20 MiB use single-part upload; larger files use multi-part. */
const SINGLE_PART_MAX_BYTES = 20 * 1024 * 1024;

/** Each chunk in a multi-part upload is at most 20 MiB. */
const CHUNK_SIZE = 20 * 1024 * 1024;

/** HTTP status codes that are safe to retry (transient server/gateway errors). */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Retries an async operation up to 3 times with exponential backoff (2s, 4s, 8s).
 * Retries on transient Notion errors: gateway timeouts (504/502/503), rate limits (429),
 * and SDK-level request timeouts. Throws immediately on all other errors.
 */
async function withRetry<T>(fn: () => Promise<T>, onRetry?: (msg: string) => void): Promise<T> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTransient =
        isNotionClientError(err) &&
        (err.code === 'notionhq_client_request_timeout' ||
          ('status' in err && RETRYABLE_STATUSES.has(err.status as number)));

      if (!isTransient || attempt === MAX_RETRIES) throw err;

      const delayMs = 2000 * Math.pow(2, attempt);
      const msg = `⚠️  Notion transient error (${(err as Error).message}), retrying in ${delayMs / 1000}s... (${attempt + 1}/${MAX_RETRIES})`;
      onRetry ? onRetry(msg) : console.warn(`  ${msg}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable — loop always throws or returns, but satisfies TypeScript.
  throw new Error('withRetry: exhausted retries');
}

/**
 * Uploads an MP4 file to Notion's file storage.
 * Returns the file upload ID for use in video blocks.
 * Uses single-part for files ≤ 20 MiB, multi-part for larger files.
 */
async function uploadVideoFile(notion: Client, filePath: string): Promise<string> {
  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;

  if (fileSize <= SINGLE_PART_MAX_BYTES) {
    const { id } = await notion.fileUploads.create({ mode: 'single_part' });
    const data = new Blob([fs.readFileSync(filePath)], { type: 'video/mp4' });
    await notion.fileUploads.send({ file_upload_id: id, file: { filename: fileName, data } });
    return id;
  }

  // Multi-part: split into 20 MiB chunks, send sequentially, then complete
  const numberOfParts = Math.ceil(fileSize / CHUNK_SIZE);
  const { id } = await notion.fileUploads.create({
    mode: 'multi_part',
    filename: fileName,
    content_type: 'video/mp4',
    number_of_parts: numberOfParts,
  });

  const fd = fs.openSync(filePath, 'r');
  try {
    for (let partNumber = 1; partNumber <= numberOfParts; partNumber++) {
      const offset = (partNumber - 1) * CHUNK_SIZE;
      const length = Math.min(CHUNK_SIZE, fileSize - offset);
      const chunk = Buffer.allocUnsafe(length);
      fs.readSync(fd, chunk, 0, length, offset);

      await notion.fileUploads.send({
        file_upload_id: id,
        file: { filename: fileName, data: new Blob([chunk], { type: 'video/mp4' }) },
        part_number: String(partNumber),
      });
    }
  } finally {
    fs.closeSync(fd);
  }

  await notion.fileUploads.complete({ file_upload_id: id });
  return id;
}

/**
 * Searches the top-level blocks of a Notion page for a toggleable heading_1
 * titled "Playlist". Returns its block ID if found, null otherwise.
 */
async function findPlaylistToggle(notion: Client, notionPageId: string): Promise<string | null> {
  let cursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: notionPageId,
      start_cursor: cursor,
    });

    for (const block of response.results as BlockObjectResponse[]) {
      if (block.type !== 'heading_1') continue;
      // TypeScript narrows to Heading1BlockObjectResponse here
      const h1 = (block as Heading1BlockObjectResponse).heading_1;
      if (!h1.is_toggleable) continue;
      const text = h1.rich_text.map((t) => t.plain_text).join('');
      if (text === 'Playlist') return block.id;
    }

    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return null;
}

/**
 * Adds video blocks to a Notion class page inside a "Playlist" toggle heading.
 *
 * - If the toggle already exists (re-upload scenario): appends new video blocks
 *   inside it instead of creating a duplicate.
 * - If the toggle does not exist: creates it as the first block on the page.
 * - Never deletes or modifies existing page content.
 */
async function addVideosToPage(
  notion: Client,
  notionPageId: string,
  videoBlocks: BlockObjectRequestWithoutChildren[],
): Promise<void> {
  const existingToggleId = await findPlaylistToggle(notion, notionPageId);

  if (existingToggleId) {
    // Toggle already exists — append new videos inside it.
    // Video blocks satisfy the runtime contract; SDK union type has a tab-type quirk that
    // makes BlockObjectRequestWithoutChildren technically incompatible with BlockObjectRequest.
    await notion.blocks.children.append({
      block_id: existingToggleId,
      children: videoBlocks as unknown as BlockObjectRequest[],
    });
    return;
  }

  // Create a new toggleable heading_1 "Playlist" at the top of the page,
  // with all video blocks nested inside it as children.
  await notion.blocks.children.append({
    block_id: notionPageId,
    children: [
      {
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: 'Playlist' } }],
          is_toggleable: true,
          // Same cast reason as above — video has no children, satisfies the runtime contract
          children: videoBlocks as unknown as BlockObjectRequestWithoutChildren[],
        },
      },
    ] as unknown as BlockObjectRequest[],
    position: { type: 'start' },
  });
}

/**
 * Uploads all converted, unuploaded videos for a phase to their Notion class pages.
 *
 * Classes run in parallel, bounded by NOTION_UPLOAD_CONCURRENCY (default: 3).
 * Within each class, all video uploads also run in parallel via Promise.all.
 * A class is only committed to state (onClassDone) after its videos are both uploaded
 * AND embedded — so a crash mid-class leaves it retryable on the next run.
 * Orphaned uploads from a failed class expire on Notion's side automatically.
 */
export async function uploadPhaseVideos(
  notion: Client,
  phaseTitle: string,
  subjects: StateSubject[],
  options?: {
    onClassDone?: (result: UploadClassDoneResult) => void;
    onVideoUploaded?: (videoTitle: string) => void;
    onRetry?: (msg: string) => void;
  },
): Promise<number> {
  const { onClassDone, onVideoUploaded, onRetry } = options ?? {};

  // Default 3 matches Notion's ~3 req/s rate limit. Each class makes at least 2 API
  // calls (blocks.children.list + blocks.children.append), so 3 concurrent classes
  // stays within budget. Set NOTION_UPLOAD_CONCURRENCY=0 to remove the limit.
  const concurrency = process.env.NOTION_UPLOAD_CONCURRENCY
    ? parseInt(process.env.NOTION_UPLOAD_CONCURRENCY, 10)
    : 3;

  const tasks = subjects.flatMap((subject) =>
    subject.classes
      .filter((cls) => cls.notionPageId && cls.videos.some((v) => v.converted && !v.uploaded))
      .map((cls) => async () => {
        const videos = cls.videos
          .filter((v) => v.converted && !v.uploaded)
          .map((v) => ({
            videoTitle: v.title,
            mp4Path: getVideoOutputPath(phaseTitle, subject.title, cls.title, v.title),
          }))
          .filter(({ videoTitle, mp4Path }) => {
            if (fs.existsSync(mp4Path)) return true;
            console.warn(`  ⚠️  MP4 not found, skipping: ${videoTitle}`);
            return false;
          });

        if (videos.length === 0) return 0;

        const uploadResults = await Promise.all(
          videos.map(async ({ videoTitle, mp4Path }) => {
            const fileUploadId = await withRetry(() => uploadVideoFile(notion, mp4Path), onRetry);
            onVideoUploaded?.(videoTitle);
            return { videoTitle, fileUploadId };
          }),
        );

        const videoBlocks: BlockObjectRequestWithoutChildren[] = uploadResults.map(
          ({ fileUploadId }) => ({
            type: 'video',
            video: { type: 'file_upload', file_upload: { id: fileUploadId } },
          }),
        );

        await withRetry(() => addVideosToPage(notion, cls.notionPageId!, videoBlocks), onRetry);
        onClassDone?.({
          classTitle: cls.title,
          videoTitles: uploadResults.map((r) => r.videoTitle),
        });
        return uploadResults.length;
      }),
  );

  let totalUploaded = 0;

  if (concurrency > 0) {
    for (let i = 0; i < tasks.length; i += concurrency) {
      const counts = await Promise.all(tasks.slice(i, i + concurrency).map((task) => task()));
      totalUploaded += counts.reduce((sum, n) => sum + n, 0);
    }
  } else {
    const counts = await Promise.all(tasks.map((task) => task()));
    totalUploaded = counts.reduce((sum, n) => sum + n, 0);
  }

  return totalUploaded;
}
