import puppeteer from 'puppeteer';
import path from 'path';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto('https://example.com');
  await page.screenshot({
    path: path.join(process.cwd(), 'downloads/example.png') 
  });

  await browser.close();
})();
