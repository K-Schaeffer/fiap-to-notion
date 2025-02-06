import { Page } from 'puppeteer';
import { Phase } from './types';

export async function getPhaseList(page: Page): Promise<Phase[]> {
  const phaseListSelector = '.conteudo-digital-disciplina-content';
  const phaseList = await page.$$eval(phaseListSelector, (elements) =>
    elements
      .map((element, index) => {
        const titleElement = element.querySelector('.conteudo-digital-disciplina-fase');
        const title = titleElement?.textContent?.trim();
        const isActive = index === 1; // The first phase is always the active one. (0 index is actually the global course title and not a phase)

        if (!title?.includes('Fase')) {
          return;
        }

        return { title, isActive };
      })
      .filter((Phase): Phase is Phase => Phase !== undefined),
  );

  if (!phaseList || !phaseList.length) {
    throw new Error('No Phases found!');
  }

  return phaseList;
}
