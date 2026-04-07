export interface PhaseCollections {
  fasePageId: string;
  conteudoDataSourceId: string;
}

/** Maps a class title (original casing from the scraper) to its Notion Conteúdo page ID */
export type ClassNotionMap = Map<string, string>;

export interface NotionMatchResult {
  classMap: ClassNotionMap;
  /** Class titles from the scraper that had no matching Notion page */
  unmatched: string[];
}
