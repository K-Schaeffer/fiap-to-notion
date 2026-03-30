import { select, Separator } from '@inquirer/prompts';
import { Phase } from '../phases/types';
import { getPhaseDisplayTitle } from '../phases';

/** Returns the selected Phase, or null if the user chose to exit. */
export async function selectPhase(phases: Phase[]): Promise<Phase | null> {
  const defaultPhase = phases.find((p) => p.isActive) ?? phases[0];

  return select<Phase | null>({
    message: 'Select a phase to sync:',
    choices: [
      ...phases.map((phase) => {
        const label = getPhaseDisplayTitle(phase);
        return {
          name: phase.isActive ? `${label} (active)` : label,
          value: phase as Phase | null,
        };
      }),
      new Separator(),
      { name: 'Exit', value: null },
    ],
    default: defaultPhase,
  });
}
