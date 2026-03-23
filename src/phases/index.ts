import { Page } from 'puppeteer';
import { Phase } from './types';

export async function getPhaseList(page: Page): Promise<Phase[]> {
  const phaseListSelector = '.conteudo-digital-disciplina-content';
  const phaseList = await page.$$eval(phaseListSelector, (elements: Element[]) => {
    let activeIndex = -1;

    // Dynamically detect the active phase by checking for active CSS class or aria attribute
    elements.forEach((element: Element, index: number) => {
      const titleElement = element.querySelector('.conteudo-digital-disciplina-fase');
      if (!titleElement?.textContent?.trim().includes('Fase')) {
        return; // Skip non-phase elements (e.g. the global course title at index 0)
      }

      if (
        element.classList.contains('active') ||
        element.classList.contains('open') ||
        element.classList.contains('expanded') ||
        element.querySelector('[aria-expanded="true"]') !== null ||
        element.querySelector('.active') !== null
      ) {
        if (activeIndex === -1) {
          activeIndex = index;
        }
      }
    });

    // Fall back to the first phase element if no active class was detected
    if (activeIndex === -1) {
      const firstPhaseIndex = elements.findIndex((el: Element) =>
        el.querySelector('.conteudo-digital-disciplina-fase')?.textContent?.trim().includes('Fase'),
      );
      activeIndex = firstPhaseIndex !== -1 ? firstPhaseIndex : 1;
    }

    return elements
      .map((element: Element, index: number) => {
        const titleElement = element.querySelector('.conteudo-digital-disciplina-fase');
        const title = titleElement?.textContent?.trim();

        if (!title?.includes('Fase')) {
          return undefined;
        }

        return { title, isActive: index === activeIndex, index };
      })
      .filter(
        (phase): phase is { title: string; isActive: boolean; index: number } => phase !== undefined,
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
