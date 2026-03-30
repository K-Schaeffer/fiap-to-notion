import { Page } from 'puppeteer';
import { Phase } from './types';

export async function getPhaseList(page: Page): Promise<Phase[]> {
  const phaseListSelector = '.conteudo-digital-disciplina-content';
  const phaseList = await page.$$eval(phaseListSelector, (elements: Element[]) => {
    return elements
      .map((element: Element, index: number) => {
        const titleElement = element.querySelector('.conteudo-digital-disciplina-fase');
        const title = titleElement?.textContent?.trim();
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

        return { title, isActive, index, courseId };
      })
      .filter(
        (phase): phase is { title: string; isActive: boolean; index: number; courseId: string } =>
          phase !== undefined,
      );
  });

  if (!phaseList || !phaseList.length) {
    throw new Error('No Phases found!');
  }

  return phaseList;
}

export function getActivePhase(phases: Phase[]): Phase {
  const activePhase = phases.find((phase) => phase.isActive);
  if (!activePhase) {
    throw new Error('No active phase found!');
  }
  return activePhase;
}
