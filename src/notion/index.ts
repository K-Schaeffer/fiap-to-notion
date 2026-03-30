import { Client, isFullPage } from '@notionhq/client';
import {
  BlockObjectResponse,
  ChildDatabaseBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { Phase } from '../phases/types';
import { Subject } from '../subjects/types';
import { ClassNotionMap, NotionMatchResult, PhaseCollections } from './types';

/**
 * Resolves a database page ID to its underlying data source (collection) ID.
 * In SDK v5.15.0, dataSources.query requires the collection ID, not the page ID.
 * databases.retrieve bridges the two via its data_sources[] field.
 */
async function resolveDataSourceId(notion: Client, databasePageId: string): Promise<string> {
  const db = await (notion.databases.retrieve as Function)({ database_id: databasePageId });
  const dataSource = (db.data_sources as Array<{ id: string }>)?.[0];
  if (!dataSource?.id) {
    throw new Error(`Could not resolve data source ID for database page: ${databasePageId}`);
  }
  return dataSource.id;
}

/**
 * Finds the Notion Fase page matching the active phase title, then discovers
 * the Conteúdo inline database and resolves its data source ID.
 *
 * Requires NOTION_PHASES_DB_ID env var pointing to the top-level Fases database page ID.
 */
export async function getPhaseCollections(
  notion: Client,
  activePhase: Phase,
): Promise<PhaseCollections> {
  const phasesDbPageId = process.env.NOTION_PHASES_DB_ID!;
  const phasesDataSourceId = await resolveDataSourceId(notion, phasesDbPageId);

  // FIAP titles are "Fase 5 - Qualidade e Deploy Ágil"; Notion pages are titled "Fase 5".
  // Extract the "Fase N" prefix for the lookup.
  const notionPhaseTitle = activePhase.title.split(' - ')[0].trim();

  const response = await notion.dataSources.query({
    data_source_id: phasesDataSourceId,
    filter: { property: 'Name', title: { equals: notionPhaseTitle } },
  });

  if (!response.results.length) {
    throw new Error(
      `No Notion page found for phase "${notionPhaseTitle}" (scraped title: "${activePhase.title}"). Create it from the Notion template first.`,
    );
  }

  const fasePageId = response.results[0].id;

  // Inline databases appear as child_database blocks on the Fase page
  const blocks = await notion.blocks.children.list({ block_id: fasePageId });
  const conteudoBlock = (blocks.results as BlockObjectResponse[]).find(
    (block): block is ChildDatabaseBlockObjectResponse =>
      block.type === 'child_database' && block.child_database.title === 'Conteúdo',
  );

  if (!conteudoBlock) {
    throw new Error(
      `Could not find "Conteúdo" database on Notion page for phase "${activePhase.title}".`,
    );
  }

  // Resolve the inline database's block ID to its data source ID
  const conteudoDataSourceId = await resolveDataSourceId(notion, conteudoBlock.id);

  return { fasePageId, conteudoDbId: conteudoDataSourceId };
}

/**
 * Queries all Conteúdo entries in Notion and matches them against the scraped
 * subjects/classes by title (case-insensitive). Returns a map of class title
 * → Notion page ID for matched entries, and a list of unmatched class titles.
 *
 * Read-only — makes no changes to Notion.
 */
export async function matchClassesToNotion(
  notion: Client,
  collections: PhaseCollections,
  subjects: Subject[],
  phaseTitle: string,
): Promise<NotionMatchResult> {
  // Fetch all Conteúdo entries, paginating if needed
  const notionTitleMap: Map<string, string> = new Map();
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: collections.conteudoDbId,
      start_cursor: cursor,
    });

    for (const page of response.results) {
      if (!isFullPage(page)) continue;
      const nameProp = page.properties['Name'];
      if (nameProp?.type !== 'title') continue;
      const title = nameProp.title
        .map((t: { plain_text: string }) => t.plain_text)
        .join('')
        .trim()
        .replace(/\s+/g, ' '); // normalize whitespace
      if (title) notionTitleMap.set(title.toLowerCase(), page.id);
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  const classMap: ClassNotionMap = new Map();
  const unmatched: string[] = [];

  for (const subject of subjects) {
    for (const classItem of subject.classes) {
      const normalizedTitle = classItem.title.replace(/\s+/g, ' ');
      const notionPageId = notionTitleMap.get(normalizedTitle.toLowerCase());
      if (notionPageId) {
        classMap.set(classItem.title, notionPageId);
      } else {
        console.warn(
          `[notion] No match for class: "${classItem.title}" (subject: "${subject.title}", phase: "${phaseTitle}")`,
        );
        unmatched.push(classItem.title);
      }
    }
  }

  return { classMap, unmatched };
}
