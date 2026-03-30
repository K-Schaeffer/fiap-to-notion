import { Page } from 'puppeteer';
import { Phase } from './types';

export function getPhaseDisplayTitle(phase: Phase): string {
  const phaseNumber = phase.title.split(' - ')[0].trim();
  return phase.topic ? `${phaseNumber} - ${phase.topic}` : phase.title;
}

export async function getPhaseList(page: Page): Promise<Phase[]> {
  const phaseListSelector = '.conteudo-digital-disciplina-content';
  const phaseList = await page.$$eval(phaseListSelector, (elements: Element[]) => {
    return elements
      .map((element: Element, index: number) => {
        const titleElement = element.querySelector('.conteudo-digital-disciplina-fase');
        const title = titleElement?.textContent?.trim().replace(/\s+/g, ' ');
        const courseId = titleElement?.getAttribute('data-fase');

        if (!title?.includes('Fase') || !courseId) {
          return undefined;
        }

        const isActiveFromClass =
          element.classList.contains('active') || element.classList.contains('open');
        const isActiveFromAria =
          titleElement?.getAttribute('aria-expanded') === 'true' ||
          element.getAttribute('aria-expanded') === 'true';
        const isActive = isActiveFromClass || isActiveFromAria;

        // Traverse to the sibling .conteudo-digital-list to find the "Welcome to <topic>" marker
        let listEl = element.nextElementSibling;
        while (listEl && !listEl.classList.contains('conteudo-digital-list')) {
          listEl = listEl.nextElementSibling;
        }
        const welcomeText = listEl
          ?.querySelector('.conteudo-digital-item.is-marcador .conteudo-digital-txt-name')
          ?.textContent?.trim();
        const topic = welcomeText?.startsWith('Welcome to ')
          ? welcomeText.slice('Welcome to '.length).trim()
          : null;

        return { title, topic, isActive, index, courseId };
      })
      .filter((phase): phase is NonNullable<typeof phase> => phase !== undefined);
  });

  if (!phaseList || !phaseList.length) {
    throw new Error('No Phases found!');
  }

  return phaseList;
}
