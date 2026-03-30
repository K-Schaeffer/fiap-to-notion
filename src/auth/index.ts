import { Page } from 'puppeteer';
import { FIAP_URLS } from '../constants';
import { LoginCredentials } from './types';

export async function loginToFIAP(page: Page, { username, password }: LoginCredentials) {
  await page.goto(FIAP_URLS.LOGIN);

  await page.waitForSelector('#loginbtn-plataforma');

  await page.type('#username-plataforma', username);
  await page.type('#password-plataforma', password);

  await Promise.all([
    page.click('#loginbtn-plataforma'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
}

export async function ensureAccessToCoursePage(page: Page) {
  await page.goto(FIAP_URLS.COURSE, { waitUntil: 'networkidle0' });

  const courseTitleSelector = '.conteudo-digital-disciplina-unidade';
  const courseTitle = await page.$(courseTitleSelector);

  if (!courseTitle) {
    throw new Error('Failed to access course page');
  }

}
