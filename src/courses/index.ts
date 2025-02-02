import { Page } from 'puppeteer';
import { FIAP_URLS } from '../constants';

export async function ensureAccessToCoursePage(page: Page) {
  await page.goto(FIAP_URLS.COURSE, { waitUntil: 'networkidle0' });

  const courseTitleSelector = '.conteudo-digital-disciplina-unidade';
  const courseTitle = await page.$(courseTitleSelector);

  if (!courseTitle) {
    throw new Error('Failed to access course page');
  }

  console.log('Successfully accessing the courses page');
}
