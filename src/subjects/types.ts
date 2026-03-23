export interface Subject {
  title: string;
  contentUrl: string | null;
  pdfUrl: string | null;
  activityUrl: string | null;
  progress: number | null;
  tag: string | null;
  isClosed: boolean;
}
