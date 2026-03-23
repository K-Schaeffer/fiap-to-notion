import { Page } from 'puppeteer';
import { Phase } from '../phases/types';
import { Subject } from './types';

export async function getSubjectList(page: Page, activePhase: Phase): Promise<Subject[]> {
  const subjects = await page.evaluate((courseId: string) => {
    const phaseH4 = document.querySelector(`.conteudo-digital-disciplina-fase[data-fase="${courseId}"]`);
    if (!phaseH4) return [];

    const phaseContent = phaseH4.closest('.conteudo-digital-disciplina-content');
    if (!phaseContent) return [];

    // Find the next sibling .conteudo-digital-list (nextElementSibling skips comment nodes)
    let listElement = phaseContent.nextElementSibling;
    while (listElement && !listElement.classList.contains('conteudo-digital-list')) {
      listElement = listElement.nextElementSibling;
    }

    if (!listElement) return [];

    const items = listElement.querySelectorAll('.conteudo-digital-item');
    return Array.from(items)
      .filter((item) => !item.classList.contains('is-marcador'))
      .map((item) => {
        const titleEl = item.querySelector('.conteudo-digital-txt-name');
        const title = titleEl?.textContent?.trim() ?? '';

        const digitalLink = item.querySelector('.t-conteudo-digital') as HTMLAnchorElement | null;
        const pdfLink = item.querySelector('.t-conteudo-pdf') as HTMLAnchorElement | null;
        const activityLink = item.querySelector('.t-conteudo-atividades') as HTMLAnchorElement | null;

        const progressEl = item.querySelector('.progresso-conteudo');
        const progress = progressEl
          ? parseInt(progressEl.getAttribute('data-porcentagem') ?? '0', 10)
          : null;

        const tagEl = item.querySelector('.tag');
        const tag = tagEl?.textContent?.trim() ?? null;

        return {
          title,
          contentUrl: digitalLink?.getAttribute('href') ?? null,
          pdfUrl: pdfLink?.getAttribute('href') ?? null,
          activityUrl: activityLink?.getAttribute('href') ?? null,
          progress,
          tag,
          isClosed: item.classList.contains('is-closed'),
        };
      });
  }, activePhase.courseId);

  if (!subjects || !subjects.length) {
    throw new Error(`No subjects found for phase: ${activePhase.title}`);
  }

  return subjects;
}
