export interface PhaseCollections {
  fasePageId: string;
  conteudoDbId: string;
}

/** Maps a class title (lowercased) to its Notion Conteúdo page ID */
export type ClassNotionMap = Map<string, string>;

export interface NotionMatchResult {
  classMap: ClassNotionMap;
  /** Class titles from the scraper that had no matching Notion page */
  unmatched: string[];
}
