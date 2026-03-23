import { Page } from 'puppeteer';
import { Phase } from '../phases/types';
import { Subject, ClassItem } from './types';

export async function getSubjectList(page: Page, activePhase: Phase): Promise<Subject[]> {
  const subjects = await page.evaluate((courseId: string) => {
    type SubjectRaw = { title: string; classes: ClassItem[] };
    type ClassItem = {
      title: string;
      contentUrl: string | null;
      pdfUrl: string | null;
      progress: number | null;
    };

    const phaseH4 = document.querySelector(
      `.conteudo-digital-disciplina-fase[data-fase="${courseId}"]`,
    );
    if (!phaseH4) return [];

    const phaseContent = phaseH4.closest('.conteudo-digital-disciplina-content');
    if (!phaseContent) return [];

    let listElement = phaseContent.nextElementSibling;
    while (listElement && !listElement.classList.contains('conteudo-digital-list')) {
      listElement = listElement.nextElementSibling;
    }
    if (!listElement) return [];

    const items = Array.from(listElement.querySelectorAll('.conteudo-digital-item'));

    const result: SubjectRaw[] = [];
    let current: SubjectRaw | null = null;

    for (const item of items) {
      const isMarker = item.classList.contains('is-marcador');
      const titleEl = item.querySelector('.conteudo-digital-txt-name');
      const title = titleEl?.textContent?.trim() ?? '';

      if (isMarker) {
        // Skip "Welcome to X" and "Atividade:" section markers
        if (title.startsWith('Welcome') || title.startsWith('Atividade:')) {
          current = null;
          continue;
        }
        current = { title, classes: [] };
        result.push(current);
      } else if (current) {
        // Skip activity items (assignments, quizzes)
        if (item.querySelector('.t-conteudo-atividades')) continue;
        if (!title) continue;

        const digitalLink = item.querySelector('.t-conteudo-digital') as HTMLAnchorElement | null;
        const pdfLink = item.querySelector('.t-conteudo-pdf') as HTMLAnchorElement | null;

        const progressEl = item.querySelector('.progresso-conteudo');
        const progress = progressEl
          ? parseInt(progressEl.getAttribute('data-porcentagem') ?? '0', 10)
          : null;

        current.classes.push({
          title,
          contentUrl: digitalLink?.getAttribute('href') ?? null,
          pdfUrl: pdfLink?.getAttribute('href') ?? null,
          progress,
        });
      }
    }

    return result;
  }, activePhase.courseId);

  if (!subjects || !subjects.length) {
    throw new Error(`No subjects found for phase: ${activePhase.title}`);
  }

  return subjects;
}
