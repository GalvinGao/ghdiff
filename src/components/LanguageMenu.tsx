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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
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
        <LanguageChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function languageName(locale: string) {
  const name =
    new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

function LanguageChoices() {
  return (
    <DropdownMenuRadioGroup
      value={getLocale()}
      onValueChange={(locale) => {
        if (isLocale(locale)) void setLocale(locale);
      }}
    >
      {locales.map((locale) => (
        <DropdownMenuRadioItem key={locale} value={locale}>
          <span lang={locale} dir={textDirection(locale)}>
            {languageName(locale)}
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function LanguageSubmenu() {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{m.locale_language()}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <LanguageChoices />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
