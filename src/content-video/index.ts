import { Page } from 'puppeteer';
import { Subject } from '../subjects/types';
import { assertNotBlocked } from '../utils';
import { ContentVideo } from './types';

/**
 * Derives the HLS master playlist URL from a playlist item's thumbnail URL.
 * Both share the same CDN hash: .cloudfront.net/{hash}/Thumbnails/... → .cloudfront.net/{hash}/HLS/file.m3u8
 */
function hlsUrlFromThumbnail(thumbnailUrl: string): string {
  return thumbnailUrl.replace(/\/Thumbnails\/.*$/, '/HLS/file.m3u8');
}

/**
 * Scrapes all playlist videos from a class content page.
 * Does not navigate away after — caller is responsible for page state.
 */
async function scrapeClassVideos(page: Page, contentUrl: string): Promise<ContentVideo[]> {
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — generous for slow CDN, but catches crashed/hung pages

  await page.goto(contentUrl, { waitUntil: 'networkidle0', timeout: TIMEOUT_MS });

  await assertNotBlocked(page);

  // The iframe loads asynchronously — wait until .pos_videos_container is present inside it
  await page.waitForFunction(() => {
    const iframe = document.querySelector('#iframecontent') as HTMLIFrameElement | null;
    return !!iframe?.contentDocument?.querySelector('.pos_videos_container');
  }, { timeout: TIMEOUT_MS });

  const rawVideos = await page.evaluate(() => {
    const iframe = document.querySelector('#iframecontent') as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    if (!doc) return [];

    return Array.from(doc.querySelectorAll('.pos-playlist-item')).map((item) => ({
      title: item.querySelector('.pos-playlist-item-title')?.textContent?.trim() ?? '',
      duration: item.querySelector('.pos-playlist-duration')?.textContent?.trim() ?? '',
      // .src gives the absolute URL; used to derive the HLS URL via the shared CDN hash
      thumbnailUrl: (item.querySelector('.pos-playlist-image-thumbnail') as HTMLImageElement | null)?.src ?? '',
    }));
  });

  return rawVideos
    .filter((v) => v.thumbnailUrl)
    .map((v) => ({
      title: v.title,
      duration: v.duration,
      hlsUrl: hlsUrlFromThumbnail(v.thumbnailUrl),
    }));
}

export interface ClassVideos {
  classTitle: string;
  videos: ContentVideo[];
}

/**
 * Sequentially scrapes videos for every class in the given subjects.
 * Each class is opened in a new tab and closed when done, keeping the
 * original page (course listing) intact throughout.
 * Classes without a contentUrl are skipped.
 * Calls onClassDone after each class completes so the caller can persist progress immediately.
 */
export async function getAllVideos(
  page: Page,
  subjects: Subject[],
  options?: { onClassDone?: (result: ClassVideos) => void },
): Promise<ClassVideos[]> {
  const onClassDone = options?.onClassDone;
  const results: ClassVideos[] = [];
  const browser = page.browser();

  for (const subject of subjects) {
    for (const classItem of subject.classes) {
      if (!classItem.contentUrl) continue;
      const tab = await browser.newPage();
      try {
        const videos = await scrapeClassVideos(tab, classItem.contentUrl);
        const result: ClassVideos = { classTitle: classItem.title, videos };
        results.push(result);
        onClassDone?.(result);
      } finally {
        await tab.close();
      }
    }
  }

  return results;
}
