import 'dotenv/config';
import ora from 'ora';
import puppeteer from 'puppeteer';
import { Client } from '@notionhq/client';
import { loginToFIAP, ensureAccessToCoursePage } from './auth';
import { getPhaseList, getPhaseDisplayTitle } from './phases';
import { getSubjectList } from './subjects';
import { getPhaseCollections, matchClassesToNotion } from './notion';
import { selectPhase, selectPhaseAction } from './cli';
import { getAllVideos } from './content-video';
import { hasLocalData, readOutput, writeOutput, upsertPhase, setPhaseVideos } from './state';

async function main() {
  if (!process.env.FIAP_USERNAME || !process.env.FIAP_PASSWORD) {
    throw new Error('Please provide FIAP_USERNAME and FIAP_PASSWORD in .env file');
  }
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_PHASES_DB_ID) {
    throw new Error('Please provide NOTION_TOKEN and NOTION_PHASES_DB_ID in .env file');
  }

  const browser = await puppeteer.launch({ headless: false });

  try {
    let spinner = ora('[scraper] Logging in to FIAP...').start();
    const page = await browser.newPage();
    await loginToFIAP(page, {
      username: process.env.FIAP_USERNAME,
      password: process.env.FIAP_PASSWORD,
    });
    spinner.succeed('[scraper] Logged in');

    spinner = ora('[scraper] Loading course page...').start();
    await ensureAccessToCoursePage(page);
    spinner.succeed('[scraper] Course page ready');

    spinner = ora('[scraper] Fetching phase list...').start();
    const phases = await getPhaseList(page);
    spinner.succeed(`[scraper] Found ${phases.length} phases`);

    if (hasLocalData()) {
      const { lastUpdated } = readOutput();
      console.log(`\nℹ️  Local scraping data found (last synced: ${new Date(lastUpdated).toLocaleString()})`);
    }

    const notion = new Client({ auth: process.env.NOTION_TOKEN });

    while (true) {
      console.log();
      const output = readOutput();
      const syncedPhaseTitles = new Set(output.phases.map((p) => p.title));
      const phaseVideoStatus = new Map(
        output.phases.map((p) => {
          const allClasses = p.subjects.flatMap((s) => s.classes).filter((c) => c.contentUrl);
          const fetchedCount = allClasses.filter((c) => c.videosFetched).length;
          const mark = fetchedCount === 0 ? ' ' : fetchedCount === allClasses.length ? '✓' : '~';
          return [p.title, mark as '✓' | '~' | ' '];
        }),
      );
      const selection = await selectPhase(phases, syncedPhaseTitles, phaseVideoStatus);

      if (selection.type === 'exit') break;

      const { phase: selectedPhase } = selection;
      const displayTitle = getPhaseDisplayTitle(selectedPhase);
      const isSynced = syncedPhaseTitles.has(selectedPhase.title);
      // '✓' phases are disabled in the selector so only '~' or ' ' reach here
      const videoStatus = (phaseVideoStatus.get(selectedPhase.title) ?? ' ') as '~' | ' ';

      let action = await selectPhaseAction(isSynced, videoStatus);
      if (action === 'go-back') continue;
      if (action === 'exit') break;

      console.log();

      if (action === 'sync') {
        spinner = ora(`[scraper] Scraping subjects for ${displayTitle}...`).start();
        const subjects = await getSubjectList(page, selectedPhase);
        const classCount = subjects.reduce((sum, s) => sum + s.classes.length, 0);
        spinner.succeed(`[scraper] Found ${subjects.length} subjects, ${classCount} classes`);

        spinner = ora('[notion] Matching classes...').start();
        const collections = await getPhaseCollections(notion, selectedPhase);
        const { classMap, unmatched } = await matchClassesToNotion(notion, collections, subjects);
        spinner.succeed(`[notion] Matched ${classMap.size}/${classCount} classes`);

        if (unmatched.length) {
          console.warn(`⚠️  [notion] Unmatched (${unmatched.length}):`, unmatched);
        }

        writeOutput(upsertPhase(readOutput(), selectedPhase, subjects, classMap));
        spinner.succeed(`[scraper] Saved phase data to output/output.json`);
      }

      if (action === 'get-videos') {
        // Re-read from output, skipping classes already fully fetched
        const phaseData = readOutput().phases.find((p) => p.title === selectedPhase.title)!;
        const subjects = phaseData.subjects.map((s) => ({
          title: s.title,
          classes: s.classes
            .filter((c) => !c.videosFetched)
            .map((c) => ({
              title: c.title,
              contentUrl: c.contentUrl,
              pdfUrl: c.pdfUrl,
              progress: c.progress,
            })),
        }));

        const classesWithUrlCount = subjects
          .flatMap((s) => s.classes)
          .filter((c) => c.contentUrl !== null).length;
        let fetchedCount = 0;
        spinner = ora(`[scraper] Fetching videos... (0/${classesWithUrlCount} classes)`).start();
        let classVideos;
        try {
          classVideos = await getAllVideos(page, subjects, {
            onClassDone: ({ classTitle, videos }) => {
              spinner.text = `[scraper] Fetching videos... (${++fetchedCount}/${classesWithUrlCount} classes)`;
              // Write incrementally after each class so progress is never lost
              writeOutput(setPhaseVideos(readOutput(), selectedPhase.title, [{ classTitle, videos }]));
            },
          });
        } catch (err) {
          spinner.fail(`[scraper] Fetching videos interrupted (${fetchedCount}/${classesWithUrlCount} classes)`);
          throw err;
        }

        const totalVideos = classVideos.reduce((sum, c) => sum + c.videos.length, 0);
        if (totalVideos === 0) {
          spinner.warn('\n⚠️  [scraper] No videos found');
        } else {
          spinner.succeed(`[scraper] Found ${totalVideos} videos across ${classVideos.length} classes, saved to output/output.json`);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
