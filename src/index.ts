import 'dotenv/config';
import ora from 'ora';
import puppeteer from 'puppeteer';
import { Client } from '@notionhq/client';
import { loginToFIAP, ensureAccessToCoursePage } from './auth';
import { getPhaseList, getPhaseDisplayTitle } from './phases';
import { getSubjectList } from './subjects';
import { getPhaseCollections, matchClassesToNotion } from './notion';
import { selectPhase } from './cli';

async function main() {
  if (!process.env.FIAP_USERNAME || !process.env.FIAP_PASSWORD) {
    throw new Error('Please provide FIAP_USERNAME and FIAP_PASSWORD in .env file');
  }
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_PHASES_DB_ID) {
    throw new Error('Please provide NOTION_TOKEN and NOTION_PHASES_DB_ID in .env file');
  }

  const browser = await puppeteer.launch({ headless: true });

  try {
    let spinner = ora('[scraper] Logging in to FIAP...').start();
    const page = await browser.newPage();
    await loginToFIAP(page, {
      username: process.env.FIAP_USERNAME,
      password: process.env.FIAP_PASSWORD,
    });
    spinner.succeed('[scraper] Logged in');

    spinner = ora('[scraper] Loading course page...').start();
    await ensureAccessToCoursePage(page);
    spinner.succeed('[scraper] Course page ready');

    spinner = ora('[scraper] Fetching phase list...').start();
    const phases = await getPhaseList(page);
    spinner.succeed(`[scraper] Found ${phases.length} phases`);

    const notion = new Client({ auth: process.env.NOTION_TOKEN });

    while (true) {
      console.log();
      const selectedPhase = await selectPhase(phases);
      if (!selectedPhase) break;

      const displayTitle = getPhaseDisplayTitle(selectedPhase);

      spinner = ora(`[scraper] Scraping subjects for ${displayTitle}...`).start();
      const subjects = await getSubjectList(page, selectedPhase);
      const classCount = subjects.reduce((sum, s) => sum + s.classes.length, 0);
      spinner.succeed(`[scraper] Found ${subjects.length} subjects, ${classCount} classes`);

      spinner = ora('[notion] Matching classes...').start();
      const collections = await getPhaseCollections(notion, selectedPhase);
      const { classMap, unmatched } = await matchClassesToNotion(notion, collections, subjects);
      spinner.succeed(`[notion] Matched ${classMap.size}/${classCount} classes`);

      if (unmatched.length) {
        console.warn(`⚠️  [notion] Unmatched (${unmatched.length}):`, unmatched);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
