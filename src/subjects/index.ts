import { Page } from 'puppeteer';
import { Phase } from '../phases/types';
import { Subject } from './types';

export async function getSubjectList(page: Page, activePhase: Phase): Promise<Subject[]> {
  const phaseContainerSelector = `.conteudo-digital-disciplina-content`;

  const subjects = await page.$$eval(
    phaseContainerSelector,
    (elements: Element[], phaseIndex: number) => {
      const phaseElement = elements[phaseIndex];
      if (!phaseElement) return [];

      const subjectElements = phaseElement.querySelectorAll('.conteudo-digital-disciplina-aula');

      return Array.from(subjectElements).map((el: Element) => {
        const titleElement = el.querySelector('.conteudo-digital-disciplina-aula-titulo');
        const descriptionElement = el.querySelector('.conteudo-digital-disciplina-aula-descricao');
        const linkElement = el.querySelector('a');

        return {
          title: titleElement?.textContent?.trim() ?? el.textContent?.trim() ?? '',
          description: descriptionElement?.textContent?.trim() ?? null,
          contentUrl: linkElement?.getAttribute('href') ?? null,
        };
      });
    },
    activePhase.index,
  );

  if (!subjects || !subjects.length) {
    throw new Error(`No subjects found for phase: ${activePhase.title}`);
  }

  return subjects;
}
