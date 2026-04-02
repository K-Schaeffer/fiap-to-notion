import { Page } from 'puppeteer';

/**
 * Throws if the current page is a CloudFront block page.
 * CloudFront serves blocks as rendered HTML with "error" in the title,
 * so we check content rather than HTTP status which may not propagate reliably.
 */
export async function assertNotBlocked(page: Page): Promise<void> {
  const isBlocked = await page.evaluate(() => document.title.toLowerCase().includes('error'));
  if (isBlocked) {
    throw new Error(
      `CloudFront blocked the request for ${page.url()} — stop and retry later.`,
    );
  }
}
