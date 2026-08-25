import { IconColorAuto, IconColorDark, IconColorLight } from '@pierre/icons';

import { Button } from '@/components/ui/Button';
import type { ColorModeState } from '@/hooks/useColorMode';

const ORDER = ['system', 'light', 'dark'] as const;
const LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' } as const;
const ICON = {
  system: IconColorAuto,
  light: IconColorLight,
  dark: IconColorDark,
} as const;

export function ColorModeToggle({
  className,
  colorMode,
}: {
  className?: string;
  colorMode: ColorModeState;
}) {
  const next = ORDER[(ORDER.indexOf(colorMode.mode) + 1) % ORDER.length];
  const Icon = ICON[colorMode.mode];
  return (
    <Button
      aria-label={`Color mode: ${LABEL[colorMode.mode]}. Switch to ${LABEL[next]}.`}
      className={className}
      size="icon"
      title={`Color mode: ${LABEL[colorMode.mode]}`}
      variant="chrome"
      onClick={() => colorMode.setMode(next)}
    >
      <Icon size={15} />
    </Button>
  );
}
