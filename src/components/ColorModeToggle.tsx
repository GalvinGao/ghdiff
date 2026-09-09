import { IconColorAuto, IconColorDark, IconColorLight } from '@pierre/icons';

import { m } from '../paraglide/messages.js';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/DropdownMenu';
import type { ColorModeState } from '@/hooks/useColorMode';
import { wipeOriginFromClick } from '@/lib/colorSchemeWipe';

const ORDER = ['system', 'light', 'dark'] as const;
const LABEL = {
  get system() {
    return m.color_mode_toggle_auto();
  },
  get light() {
    return m.color_mode_toggle_light();
  },
  get dark() {
    return m.color_mode_toggle_dark();
  },
} as const;
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
      aria-label={m.color_mode_toggle_color_mode_switch_to({
        value: LABEL[colorMode.mode],
        value2: LABEL[next],
      })}
      className={className}
      size="icon"
      title={m.color_mode_toggle_color_mode({ value: LABEL[colorMode.mode] })}
      variant="chrome"
      // The press is where the new scheme comes in from, so the coordinates
      // travel with the mode — see src/lib/colorSchemeWipe.ts.
      onClick={(event) => colorMode.setMode(next, wipeOriginFromClick(event))}
    >
      <Icon size={15} />
    </Button>
  );
}

export function ColorModeMenuItems({
  colorMode,
}: {
  colorMode: ColorModeState;
}) {
  return (
    <>
      <DropdownMenuLabel>
        {m.color_mode_toggle_color_mode({ value: LABEL[colorMode.mode] })}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={colorMode.mode}>
        {ORDER.map((mode) => {
          const Icon = ICON[mode];
          return (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              onClick={(event) =>
                colorMode.setMode(mode, wipeOriginFromClick(event))
              }
            >
              <Icon size={15} />
              {LABEL[mode]}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </>
  );
}
