import 'dotenv/config';
import ora from 'ora';
import puppeteer, { Browser } from 'puppeteer';
import { Client } from '@notionhq/client';
import { loginToFIAP, ensureAccessToCoursePage } from './auth';
import { getPhaseList, getPhaseDisplayTitle } from './phases';
import { getSubjectList } from './subjects';
import { getPhaseCollections, matchClassesToNotion } from './notion';
import {
  selectMode,
  selectPhase,
  selectPhaseAction,
  selectConverterPhase,
  selectConverterAction,
} from './cli';
import { getAllVideos } from './content-video';
import {
  hasLocalData,
  readOutput,
  writeOutput,
  upsertPhase,
  setPhaseVideos,
  setVideoConverted,
} from './state';
import { StatePhase } from './state/types';
import { assertFfmpegAvailable, convertPhaseVideos } from './download';

function validateScraperEnv(): void {
  if (!process.env.FIAP_USERNAME || !process.env.FIAP_PASSWORD) {
    throw new Error('Please provide FIAP_USERNAME and FIAP_PASSWORD in .env file');
  }
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_PHASES_DB_ID) {
    throw new Error('Please provide NOTION_TOKEN and NOTION_PHASES_DB_ID in .env file');
  }
}

async function runScraper(): Promise<void> {
  validateScraperEnv();

  const browser: Browser = await puppeteer.launch({ headless: true });

  try {
    let spinner = ora('[scraper] Logging in to FIAP...').start();
    const page = await browser.newPage();
    await loginToFIAP(page, {
      username: process.env.FIAP_USERNAME!,
      password: process.env.FIAP_PASSWORD!,
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
      console.log(
        `\nℹ️  Local scraping data found (last synced: ${new Date(lastUpdated).toLocaleString()})`,
      );
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
      const isSynced = syncedPhaseTitles.has(displayTitle);
      const videoStatus = (phaseVideoStatus.get(displayTitle) ?? ' ') as '~' | ' ';

      const action = await selectPhaseAction(isSynced, videoStatus);
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
        spinner.succeed(`[scraper] Saved phase data to data/output.json`);
      }

      if (action === 'get-videos') {
        const phaseData = readOutput().phases.find((p) => p.title === displayTitle)!;
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
        let currentOutput = readOutput();
        spinner = ora(`[scraper] Fetching videos... (0/${classesWithUrlCount} classes)`).start();
        let classVideos;
        try {
          classVideos = await getAllVideos(page, subjects, {
            onClassDone: ({ classTitle, videos }) => {
              spinner.text = `[scraper] Fetching videos... (${++fetchedCount}/${classesWithUrlCount} classes)`;
              currentOutput = setPhaseVideos(currentOutput, displayTitle, [{ classTitle, videos }]);
              writeOutput(currentOutput);
            },
          });
        } catch (err) {
          spinner.fail(
            `[scraper] Fetching videos interrupted (${fetchedCount}/${classesWithUrlCount} classes)`,
          );
          throw err;
        }

        const totalVideos = classVideos.reduce((sum, c) => sum + c.videos.length, 0);
        if (totalVideos === 0) {
          spinner.warn('\n⚠️  [scraper] No videos found');
        } else {
          spinner.succeed(
            `[scraper] Found ${totalVideos} videos across ${classVideos.length} classes, saved to data/output.json`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
}

function getConversionStatus(phases: StatePhase[]): Map<string, '✓' | '~' | ' '> {
  return new Map(
    phases.map((p) => {
      const allVideos = p.subjects.flatMap((s) => s.classes.flatMap((c) => c.videos));
      if (allVideos.length === 0) return [p.title, ' ' as const];
      const convertedCount = allVideos.filter((v) => v.converted).length;
      const mark = convertedCount === 0 ? ' ' : convertedCount === allVideos.length ? '✓' : '~';
      return [p.title, mark as '✓' | '~' | ' '];
    }),
  );
}

async function runConverter(): Promise<void> {
  assertFfmpegAvailable();

  while (true) {
    console.log();
    const output = readOutput();

    // Only show phases that have videos fetched
    const eligiblePhases = output.phases.filter((p) =>
      p.subjects.some((s) => s.classes.some((c) => c.videosFetched && c.videos.length > 0)),
    );

    if (eligiblePhases.length === 0) {
      console.log('⚠️  No phases with fetched videos. Run the Scraper first to fetch video URLs.');
      return;
    }

    const conversionStatus = getConversionStatus(eligiblePhases);
    const selection = await selectConverterPhase(eligiblePhases, conversionStatus);

    if (selection.type === 'exit') break;

    const { phase: selectedPhase } = selection;
    const status = (conversionStatus.get(selectedPhase.title) ?? ' ') as '~' | ' ';

    const action = await selectConverterAction(status);
    if (action === 'go-back') continue;
    if (action === 'exit') break;

    console.log();

    const allVideos = selectedPhase.subjects.flatMap((s) => s.classes.flatMap((c) => c.videos));
    const totalVideos = allVideos.length;
    let convertedCount = allVideos.filter((v) => v.converted).length;

    let currentOutput = readOutput();
    const spinner = ora(`[converter] (${convertedCount}/${totalVideos}) Starting...`).start();

    try {
      await convertPhaseVideos(selectedPhase.title, selectedPhase.subjects, {
        onProgress: ({ videoTitle, time }) => {
          spinner.text = `[converter] (${convertedCount}/${totalVideos}) ${videoTitle} — ${time}`;
        },
        onVideoDone: ({ classTitle, videoTitle }) => {
          convertedCount++;
          // Log completed video above the spinner
          spinner.clear();
          console.log(`  ✓ ${videoTitle}`);
          spinner.text = `[converter] (${convertedCount}/${totalVideos}) Downloading...`;
          spinner.render();

          currentOutput = setVideoConverted(
            currentOutput,
            selectedPhase.title,
            classTitle,
            videoTitle,
          );
          writeOutput(currentOutput);
        },
      });
    } catch (err) {
      spinner.fail(`[converter] Conversion interrupted (${convertedCount}/${totalVideos})`);
      throw err;
    }

    spinner.succeed(`[converter] All videos converted (${convertedCount}/${totalVideos})`);
  }
}

async function main() {
  while (true) {
    console.log();
    const mode = await selectMode(hasLocalData());

    if (mode === 'exit') break;
    if (mode === 'scraper') await runScraper();
    if (mode === 'converter') await runConverter();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
