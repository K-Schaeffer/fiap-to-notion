export interface Phase {
  title: string;
  /** Phase topic extracted from the "Welcome to <topic>" marker — more descriptive than the FIAP default title */
  topic: string | null;
  isActive: boolean;
  index: number;
  courseId: string;
}
