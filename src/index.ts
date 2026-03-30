import 'dotenv/config';
import puppeteer from 'puppeteer';
import { Client } from '@notionhq/client';
import { loginToFIAP, ensureAccessToCoursePage } from './auth';
import { getPhaseList, getActivePhase } from './phases';
import { getSubjectList } from './subjects';
import { getPhaseCollections, matchClassesToNotion } from './notion';

async function main() {
  if (!process.env.FIAP_USERNAME || !process.env.FIAP_PASSWORD) {
    throw new Error('Please provide FIAP_USERNAME and FIAP_PASSWORD in .env file');
  }
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_PHASES_DB_ID) {
    throw new Error('Please provide NOTION_TOKEN and NOTION_PHASES_DB_ID in .env file');
  }

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await loginToFIAP(page, {
    username: process.env.FIAP_USERNAME,
    password: process.env.FIAP_PASSWORD,
  });

  await ensureAccessToCoursePage(page);

  const phases = await getPhaseList(page);
  console.log('Phases:', phases);

  const activePhase = getActivePhase(phases);
  console.log('Active phase:', activePhase);

  const subjects = await getSubjectList(page, activePhase);
  console.log('Subjects in active phase:', JSON.stringify(subjects, null, 2));

  await browser.close();

  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const collections = await getPhaseCollections(notion, activePhase);
  console.log(`Found Conteúdo DB: ${collections.conteudoDbId}`);

  const { classMap, unmatched } = await matchClassesToNotion(notion, collections, subjects, activePhase.title);
  console.log(`Matched ${classMap.size} classes to Notion pages`);
  if (unmatched.length) {
    console.warn(`Unmatched classes (${unmatched.length}):`, unmatched);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
