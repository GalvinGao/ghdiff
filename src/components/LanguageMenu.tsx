import { GlobeIcon } from '@primer/octicons-react';

import { m } from '../paraglide/messages.js';
import {
  getLocale,
  isLocale,
  locales,
  setLocale,
} from '../paraglide/runtime.js';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { textDirection } from '@/lib/locale';

export function LanguageMenu() {
  if (locales.length < 2) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="chrome"
          aria-label={m.locale_language()}
          title={m.locale_language()}
        >
          <GlobeIcon size={15} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={getLocale()}
          onValueChange={(locale) => {
            if (isLocale(locale)) void setLocale(locale);
          }}
        >
          {locales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              <span lang={locale} dir={textDirection(locale)}>
                {new Intl.DisplayNames([locale], { type: 'language' }).of(
                  locale
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
