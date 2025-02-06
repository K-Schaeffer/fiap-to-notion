import { Page } from 'puppeteer';
import { FIAP_URLS } from '../constants';
import { LoginCredentials } from './types';

export async function loginToFIAP(page: Page, { username, password }: LoginCredentials) {
  await page.goto(FIAP_URLS.LOGIN);

  await page.waitForSelector('#login');

  await page.type('#username', username);
  await page.type('#password', password);

  await Promise.all([
    page.click('#loginbtn'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ])
    .then(() => {
      console.log('Successfully logged in');
    })
    .catch((e) => {
      console.error('Failed to login:', e);
    });
}

export async function ensureAccessToCoursePage(page: Page) {
  await page.goto(FIAP_URLS.COURSE, { waitUntil: 'networkidle0' });

  const courseTitleSelector = '.conteudo-digital-disciplina-unidade';
  const courseTitle = await page.$(courseTitleSelector);

  if (!courseTitle) {
    throw new Error('Failed to access course page');
  }

  console.log('Successfully accessing the course page');
}
