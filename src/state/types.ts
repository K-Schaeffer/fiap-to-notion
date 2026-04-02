import { ContentVideo } from '../content-video/types';

export interface StateClass {
  title: string;
  contentUrl: string | null;
  pdfUrl: string | null;
  progress: number | null;
  notionPageId: string | null;
  videosFetched: boolean;
  videos: ContentVideo[];
}

export interface StateSubject {
  title: string;
  classes: StateClass[];
}

export interface StatePhase {
  title: string;
  subjects: StateSubject[];
}

export interface ScraperOutput {
  phases: StatePhase[];
  lastUpdated: string;
}
