import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

import { loginToFIAP, ensureAccessToCoursePage } from './auth';
import { getPhaseList } from './phases';

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

  const phases = await getPhaseList(page);

  console.log(phases);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
