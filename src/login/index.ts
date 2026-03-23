import { Page } from 'puppeteer';
import { FIAP_URLS } from '../constants';

interface LoginCredentials {
  username: string;
  password: string;
}

export async function loginToFIAP(page: Page, { username, password }: LoginCredentials) {
  await page.goto(FIAP_URLS.LOGIN);

  await page.waitForSelector('#loginbtn-plataforma');

  await page.type('#username-plataforma', username);
  await page.type('#password-plataforma', password);

  await Promise.all([
    page.click('#loginbtn-plataforma'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ])
    .then(() => {
      console.log('Successfully logged in');
    })
    .catch((e) => {
      console.error('Failed to login:', e);
    });
}
