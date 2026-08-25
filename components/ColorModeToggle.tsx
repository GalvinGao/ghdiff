'use client';

import { Button } from '@/components/ui/Button';
import type { ColorModeState } from '@/hooks/useColorMode';

const ORDER = ['system', 'light', 'dark'] as const;
const LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' } as const;

export function ColorModeToggle({ colorMode }: { colorMode: ColorModeState }) {
  const next = ORDER[(ORDER.indexOf(colorMode.mode) + 1) % ORDER.length];
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`Color mode: ${LABEL[colorMode.mode]}. Switch to ${LABEL[next]}.`}
      onClick={() => colorMode.setMode(next)}
    >
      {LABEL[colorMode.mode]}
    </Button>
  );
}
