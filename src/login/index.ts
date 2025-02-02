import { Page } from 'puppeteer';
import { FIAP_URLS } from '../constants';

interface LoginCredentials {
  username: string;
  password: string;
}

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
