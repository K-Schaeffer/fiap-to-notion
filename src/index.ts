import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

import { loginToFIAP } from './login';
import { ensureAccessToCoursePage } from './courses';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({ headless: false }); // Change to true to run in headless mode
  const page = await browser.newPage();

  if (!process.env.FIAP_USERNAME || !process.env.FIAP_PASSWORD) {
    throw new Error('Please provide FIAP_USERNAME and FIAP_PASSWORD in .env file');
  }

  await loginToFIAP(page, {
    username: process.env.FIAP_USERNAME,
    password: process.env.FIAP_PASSWORD,
  });

  await ensureAccessToCoursePage(page);

  await page.screenshot({
    path: path.join(process.cwd(), 'downloads/coursesPage.png'),
  });

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
