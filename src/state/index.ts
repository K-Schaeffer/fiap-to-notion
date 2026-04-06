import fs from 'fs';
import path from 'path';
import { Phase } from '../phases/types';
import { getPhaseDisplayTitle } from '../phases';
import { Subject } from '../subjects/types';
import { ClassNotionMap } from '../notion/types';
import { ContentVideo } from '../content-video/types';
import { ScraperOutput, StatePhase } from './types';

const OUTPUT_DIR = path.join(process.cwd(), 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'output.json');

const EMPTY_OUTPUT: ScraperOutput = { phases: [], lastUpdated: '' };

export function hasLocalData(): boolean {
  return fs.existsSync(OUTPUT_FILE);
}

export function readOutput(): ScraperOutput {
  if (!hasLocalData()) return { ...EMPTY_OUTPUT };
  return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8')) as ScraperOutput;
}

export function writeOutput(output: ScraperOutput): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify({ ...output, lastUpdated: new Date().toISOString() }, null, 2),
  );
}

export function clearOutput(): void {
  if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);
}

/**
 * Merges a freshly scraped phase (subjects + classes + Notion IDs) into the
 * output, preserving any existing videos already saved for each class.
 */
export function upsertPhase(
  output: ScraperOutput,
  phase: Phase,
  subjects: Subject[],
  classMap: ClassNotionMap,
): ScraperOutput {
  const displayTitle = getPhaseDisplayTitle(phase);
  const existingPhase = output.phases.find((p) => p.title === displayTitle);

  const updatedPhase: StatePhase = {
    title: displayTitle,
    subjects: subjects.map((subject) => ({
      title: subject.title,
      classes: subject.classes.map((classItem) => {
        // Preserve existing videos if this class was already scraped
        const existingClass = existingPhase?.subjects
          .find((s) => s.title === subject.title)
          ?.classes.find((c) => c.title === classItem.title);

        return {
          title: classItem.title,
          contentUrl: classItem.contentUrl,
          pdfUrl: classItem.pdfUrl,
          progress: classItem.progress,
          notionPageId: classMap.get(classItem.title) ?? null,
          videosFetched: existingClass?.videosFetched ?? false,
          videos: existingClass?.videos ?? [],
        };
      }),
    })),
  };

  const phases = existingPhase
    ? output.phases.map((p) => (p.title === displayTitle ? updatedPhase : p))
    : [...output.phases, updatedPhase];

  return { ...output, phases };
}

/**
 * Marks a specific video as converted within a phase.
 */
export function setVideoConverted(
  output: ScraperOutput,
  phaseTitle: string,
  classTitle: string,
  videoTitle: string,
): ScraperOutput {
  return {
    ...output,
    phases: output.phases.map((phase) => {
      if (phase.title !== phaseTitle) return phase;
      return {
        ...phase,
        subjects: phase.subjects.map((subject) => ({
          ...subject,
          classes: subject.classes.map((cls) => {
            if (cls.title !== classTitle) return cls;
            return {
              ...cls,
              videos: cls.videos.map((v) =>
                v.title === videoTitle ? { ...v, converted: true } : v,
              ),
            };
          }),
        })),
      };
    }),
  };
}

/**
 * Writes the fetched videos into their corresponding classes for a given phase.
 */
export function setPhaseVideos(
  output: ScraperOutput,
  phaseTitle: string,
  classVideos: { classTitle: string; videos: ContentVideo[] }[],
): ScraperOutput {
  const videosByClass = new Map(classVideos.map(({ classTitle, videos }) => [classTitle, videos]));

  return {
    ...output,
    phases: output.phases.map((phase) => {
      if (phase.title !== phaseTitle) return phase;
      return {
        ...phase,
        subjects: phase.subjects.map((subject) => ({
          ...subject,
          classes: subject.classes.map((cls) => {
            const videos = videosByClass.get(cls.title);
            return videos !== undefined ? { ...cls, videos, videosFetched: true } : cls;
          }),
        })),
      };
    }),
  };
}
