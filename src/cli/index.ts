import { select, Separator } from '@inquirer/prompts';
import { Phase } from '../phases/types';
import { getPhaseDisplayTitle } from '../phases';

export type PhaseAction = 'sync' | 'get-videos' | 'go-back' | 'exit';

export type PhaseSelectionResult =
  | { type: 'phase'; phase: Phase }
  | { type: 'exit' };

/**
 * Prompts the user to choose an action after a phase is selected.
 * Labels adapt based on whether the phase is synced and whether it has videos.
 */
const VIDEO_ACTION_LABEL: Record<'~' | ' ', string> = {
  '~': 'Continue fetching videos',
  ' ': 'Get Videos',
};

export async function selectPhaseAction(isSynced: boolean, videoStatus: '~' | ' '): Promise<PhaseAction> {
  return select<PhaseAction>({
    message: 'What would you like to do?',
    choices: [
      ...(!isSynced ? [{ name: 'Sync', value: 'sync' as PhaseAction }] : []),
      ...(isSynced ? [{ name: VIDEO_ACTION_LABEL[videoStatus], value: 'get-videos' as PhaseAction }] : []),
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
        const synced = syncedPhaseTitles.has(phase.title);
        const videoMark = phaseVideoStatus.get(phase.title) ?? ' ';
        const label = getPhaseDisplayTitle(phase);
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
