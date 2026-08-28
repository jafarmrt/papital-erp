export interface AIUpdateLog {
  version: string;
  date: string;
  title: string;
  summary: string;
  changes: string[];
  fixes?: string[];
  author?: string;
}
