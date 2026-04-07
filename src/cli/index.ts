import { select, Separator } from '@inquirer/prompts';
import { Phase } from '../phases/types';
import { getPhaseDisplayTitle } from '../phases';
import { StatePhase } from '../state/types';

export type AppMode = 'scraper' | 'converter' | 'uploader' | 'exit';

export type PhaseAction = 'sync' | 'get-videos' | 'go-back' | 'exit';

export type PhaseSelectionResult = { type: 'phase'; phase: Phase } | { type: 'exit' };

/**
 * Prompts the user to choose an action after a phase is selected.
 * Labels adapt based on whether the phase is synced and whether it has videos.
 */
const VIDEO_ACTION_LABEL: Record<'~' | ' ', string> = {
  '~': 'Continue fetching videos',
  ' ': 'Get Videos',
};

export async function selectPhaseAction(
  isSynced: boolean,
  videoStatus: '~' | ' ',
): Promise<PhaseAction> {
  return select<PhaseAction>({
    message: 'What would you like to do?',
    choices: [
      ...(!isSynced ? [{ name: 'Sync', value: 'sync' as PhaseAction }] : []),
      ...(isSynced
        ? [{ name: VIDEO_ACTION_LABEL[videoStatus], value: 'get-videos' as PhaseAction }]
        : []),
      { name: 'Go back', value: 'go-back' },
      new Separator(),
      { name: 'Exit', value: 'exit' },
    ],
  });
}

/**
 * Prompts the user to select a phase.
 * [✓][ ] = synced but no videos, [✓][✓] = done (disabled), [ ][ ] = not synced.
 */
export async function selectPhase(
  phases: Phase[],
  syncedPhaseTitles: Set<string>,
  phaseVideoStatus: Map<string, '✓' | '~' | ' '>,
): Promise<PhaseSelectionResult> {
  const defaultPhase = phases.find((p) => p.isActive) ?? phases[0];

  type Choice = Phase | 'exit';

  console.log('  [S][V]  S = Synced · V = Videos (✓ all · ~ partial)');
  const result = await select<Choice>({
    message: 'Select a phase:',
    choices: [
      ...phases.map((phase) => {
        const label = getPhaseDisplayTitle(phase);
        const synced = syncedPhaseTitles.has(label);
        const videoMark = phaseVideoStatus.get(label) ?? ' ';
        const suffix = phase.isActive ? ' (active)' : '';
        const done = synced && videoMark === '✓';
        return {
          name: `[${synced ? '✓' : ' '}][${videoMark}] ${label}${suffix}`,
          value: phase as Choice,
          disabled: done,
        };
      }),
      new Separator(),
      { name: 'Exit', value: 'exit' as Choice },
    ],
    default: defaultPhase,
  });

  if (result === 'exit') return { type: 'exit' };
  return { type: 'phase', phase: result };
}

// --- Top-level mode selector ---

export async function selectMode(
  hasScrapedData: boolean,
  hasConvertedVideos: boolean,
): Promise<AppMode> {
  return select<AppMode>({
    message: 'What would you like to do?',
    choices: [
      { name: 'Scraper', value: 'scraper' },
      { name: 'Video Converter', value: 'converter', disabled: !hasScrapedData },
      { name: 'Notion Uploader', value: 'uploader', disabled: !hasConvertedVideos },
      new Separator(),
      { name: 'Exit', value: 'exit' },
    ],
  });
}

// --- Converter CLI ---

export type ConverterPhaseResult = { type: 'phase'; phase: StatePhase } | { type: 'exit' };

export type ConverterAction = 'convert-videos' | 'go-back' | 'exit';

/**
 * Prompts the user to select a phase for video conversion.
 * Only phases with fetched videos appear. Fully converted phases are disabled.
 */
export async function selectConverterPhase(
  phases: StatePhase[],
  conversionStatus: Map<string, '✓' | '~' | ' '>,
): Promise<ConverterPhaseResult> {
  type Choice = StatePhase | 'exit';

  console.log('  [C]  C = Converted (✓ all · ~ partial)');
  const result = await select<Choice>({
    message: 'Select a phase to convert:',
    choices: [
      ...phases.map((phase) => {
        const mark = conversionStatus.get(phase.title) ?? ' ';
        const done = mark === '✓';
        return {
          name: `[${mark}] ${phase.title}`,
          value: phase as Choice,
          disabled: done,
        };
      }),
      new Separator(),
      { name: 'Exit', value: 'exit' as Choice },
    ],
  });

  if (result === 'exit') return { type: 'exit' };
  return { type: 'phase', phase: result };
}

const CONVERT_ACTION_LABEL: Record<'~' | ' ', string> = {
  '~': 'Continue converting videos',
  ' ': 'Convert Videos',
};

export async function selectConverterAction(conversionStatus: '~' | ' '): Promise<ConverterAction> {
  return select<ConverterAction>({
    message: 'What would you like to do?',
    choices: [
      { name: CONVERT_ACTION_LABEL[conversionStatus], value: 'convert-videos' },
      { name: 'Go back', value: 'go-back' },
      new Separator(),
      { name: 'Exit', value: 'exit' },
    ],
  });
}

// --- Uploader CLI ---

export type UploaderPhaseResult = { type: 'phase'; phase: StatePhase } | { type: 'exit' };

export type UploaderAction = 'upload-videos' | 'go-back' | 'exit';

/**
 * Prompts the user to select a phase for Notion upload.
 * Only phases with converted + unuploaded videos appear.
 * Fully uploaded phases are disabled.
 */
export async function selectUploaderPhase(
  phases: StatePhase[],
  uploadStatus: Map<string, '✓' | '~' | ' '>,
): Promise<UploaderPhaseResult> {
  type Choice = StatePhase | 'exit';

  console.log('  [U]  U = Uploaded (✓ all · ~ partial)');
  const result = await select<Choice>({
    message: 'Select a phase to upload:',
    choices: [
      ...phases.map((phase) => {
        const mark = uploadStatus.get(phase.title) ?? ' ';
        const done = mark === '✓';
        return {
          name: `[${mark}] ${phase.title}`,
          value: phase as Choice,
          disabled: done,
        };
      }),
      new Separator(),
      { name: 'Exit', value: 'exit' as Choice },
    ],
  });

  if (result === 'exit') return { type: 'exit' };
  return { type: 'phase', phase: result };
}

const UPLOAD_ACTION_LABEL: Record<'~' | ' ', string> = {
  '~': 'Continue uploading videos',
  ' ': 'Upload Videos to Notion',
};

export async function selectUploaderAction(uploadStatus: '~' | ' '): Promise<UploaderAction> {
  return select<UploaderAction>({
    message: 'What would you like to do?',
    choices: [
      { name: UPLOAD_ACTION_LABEL[uploadStatus], value: 'upload-videos' },
      { name: 'Go back', value: 'go-back' },
      new Separator(),
      { name: 'Exit', value: 'exit' },
    ],
  });
}
