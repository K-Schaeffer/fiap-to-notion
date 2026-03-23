export interface ClassItem {
  title: string;
  contentUrl: string | null;
  pdfUrl: string | null;
  progress: number | null;
}

export interface Subject {
  title: string;
  classes: ClassItem[];
}
