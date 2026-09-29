import { IconTrash } from '@pierre/icons';
import { useEffect, useMemo, useState } from 'react';

import { LensBadge } from '@/components/lenses/LensFrame';
import { Button } from '@/components/ui/Button';
import { CheckBox } from '@/components/ui/CheckBox';
import { Dialog, dialogPrimaryAction } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Segmented, SegmentedItem } from '@/components/ui/Segmented';
import { LENSES } from '@/lib/lenses/lenses';
import {
  detectLocaleSources,
  type LocaleSource,
  type LocalizationSettings,
} from '@/lib/lenses/localization/config';
import {
  LOCALE_TOKEN,
  matchLocalePath,
} from '@/lib/lenses/localization/localePaths';
import {
  PLACEHOLDER_SYNTAXES,
  type PlaceholderSyntax,
} from '@/lib/lenses/localization/placeholders';
import { m } from '@/paraglide/messages.js';

// Where one repository keeps its translations, and how they are written.
//
// The dialog edits a draft and saves it whole, because a pattern half typed is
// a pattern that claims nothing, and a panel that vanished on every keystroke
// would be no way to judge the pattern being typed. Each catalogue says how
// many files of the diff on screen it matches, which is the answer to "is this
// right" without leaving the dialog.

interface SourceDraft {
  pattern: string;
  placeholders: PlaceholderSyntax;
  baseLocale: string;
  generatedLocales: string;
}

function toDraft(source: LocaleSource): SourceDraft {
  return {
    pattern: source.pattern,
    placeholders: source.placeholders,
    baseLocale: source.baseLocale ?? '',
    generatedLocales: source.generatedLocales.join(', '),
  };
}

function fromDraft(draft: SourceDraft): LocaleSource | undefined {
  const pattern = draft.pattern.trim();
  if (!pattern.includes(LOCALE_TOKEN)) return undefined;
  const baseLocale = draft.baseLocale.trim();
  return {
    pattern,
    format: 'flat-json',
    placeholders: draft.placeholders,
    ...(baseLocale === '' ? {} : { baseLocale }),
    generatedLocales: draft.generatedLocales
      .split(',')
      .map((locale) => locale.trim())
      .filter((locale) => locale.length > 0),
  };
}

const EMPTY_DRAFT: SourceDraft = {
  pattern: '',
  placeholders: 'braces',
  baseLocale: 'en',
  generatedLocales: '',
};

export function LocalizationSettingsDialog({
  onClose,
  onSave,
  open,
  paths,
  repoLabel,
  settings,
}: {
  open: boolean;
  /** The repository these settings are for, as the question names it. */
  repoLabel: string;
  onClose(): void;
  onSave(next: LocalizationSettings): void;
  /** Every path of the diff on screen, for the match counts. */
  paths: readonly string[];
  settings: LocalizationSettings;
}) {
  const detected = useMemo(() => detectLocaleSources(paths), [paths]);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [mode, setMode] = useState<'detect' | 'custom'>(
    settings.sources == null ? 'detect' : 'custom'
  );
  const [drafts, setDrafts] = useState<SourceDraft[]>([]);

  // Each opening starts from what is saved, so Cancel means what it says.
  useEffect(() => {
    if (!open) return;
    setEnabled(settings.enabled);
    setMode(settings.sources == null ? 'detect' : 'custom');
    setDrafts((settings.sources ?? detected).map(toDraft));
  }, [detected, open, settings]);

  const update = (index: number, patch: Partial<SourceDraft>) =>
    setDrafts((current) =>
      current.map((draft, at) =>
        at === index ? { ...draft, ...patch } : draft
      )
    );

  const save = () => {
    const next: LocalizationSettings = { ...settings, enabled };
    if (mode === 'detect') delete next.sources;
    else {
      next.sources = drafts.map(fromDraft).filter((source) => source != null);
    }
    onSave(next);
    onClose();
  };

  return (
    <Dialog
      eyebrow={<LensBadge />}
      open={open}
      title={LENSES.localization.label}
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        <button
          type="button"
          aria-pressed={enabled}
          className="hover:bg-surface -mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2 rounded-md px-1.5 py-1 text-left"
          onClick={() => setEnabled((on) => !on)}
        >
          <span className="mt-0.5">
            <CheckBox checked={enabled} />
          </span>
          <span>
            <span className="text-ink block">
              {m.localization_settings_dialog_show_translations_as_a_table()}
            </span>
            <span className="text-ink-muted block text-xs">
              {m.localization_settings_dialog_only_for_this_repository_saved_in_this_browser()}
            </span>
          </span>
        </button>

        {enabled && (
          <>
            <div className="space-y-1.5">
              <p className="text-ink text-sm">
                {m.lens_files_question({ repo: repoLabel })}
              </p>
              <Segmented
                aria-label={m.localization_settings_dialog_which_files_are_translations()}
                value={mode}
                onValueChange={(value) => setMode(value as 'detect' | 'custom')}
              >
                <SegmentedItem value="detect">
                  {m.localization_settings_dialog_detect_automatically()}
                </SegmentedItem>
                <SegmentedItem value="custom">
                  {m.localization_settings_dialog_choose_paths()}
                </SegmentedItem>
              </Segmented>
            </div>

            {mode === 'detect' ? (
              <DetectedSummary detected={detected} paths={paths} />
            ) : (
              <div className="space-y-3">
                <p className="text-ink-muted text-xs">
                  {m.lens_path_help({ token: LOCALE_TOKEN })}
                </p>
                {drafts.map((draft, index) => (
                  <SourceEditor
                    key={index}
                    draft={draft}
                    paths={paths}
                    onChange={(patch) => update(index, patch)}
                    onRemove={() =>
                      setDrafts((current) =>
                        current.filter((_, at) => at !== index)
                      )
                    }
                  />
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDrafts((current) => [...current, EMPTY_DRAFT])
                  }
                >
                  {m.localization_settings_dialog_add_another_folder()}
                </Button>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="quiet" onClick={onClose}>
            {m.confirm_inline_cancel()}
          </Button>
          <Button
            size="sm"
            variant="solid"
            onClick={save}
            {...dialogPrimaryAction}
          >
            {m.localization_settings_dialog_save()}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DetectedSummary({
  detected,
  paths,
}: {
  detected: readonly LocaleSource[];
  paths: readonly string[];
}) {
  return (
    <div className="space-y-2 text-xs">
      <p className="text-ink-muted">{m.lens_detect_help()}</p>
      {detected.length === 0 ? (
        <p className="text-ink-muted">
          {m.localization_settings_dialog_none_in_this_diff()}
        </p>
      ) : (
        <>
          <p className="text-ink-faint">
            {m.localization_settings_dialog_in_this_diff()}
          </p>
          <ul className="space-y-1.5">
            {detected.map((source) => (
              <li key={source.pattern}>
                <code dir="ltr" className="text-ink font-mono">
                  {source.pattern}
                </code>
                <span className="text-ink-muted block">
                  {m.common_file_count({
                    count: matchCount(source.pattern, paths),
                  })}
                  {source.baseLocale != null &&
                    ` ${m.lens_compare_base({ locale: source.baseLocale })}`}
                  {source.generatedLocales.length > 0 &&
                    ` ${m.lens_skips({ locales: source.generatedLocales.join(', ') })}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function matchCount(pattern: string, paths: readonly string[]): number {
  return paths.filter((path) => matchLocalePath(path, pattern) != null).length;
}

function SourceEditor({
  draft,
  onChange,
  onRemove,
  paths,
}: {
  draft: SourceDraft;
  onChange(patch: Partial<SourceDraft>): void;
  onRemove(): void;
  paths: readonly string[];
}) {
  const valid = draft.pattern.includes(LOCALE_TOKEN);
  const matches = valid ? matchCount(draft.pattern.trim(), paths) : 0;
  return (
    <fieldset className="border-line space-y-2 rounded-lg border p-2.5">
      <div className="flex items-center gap-1.5">
        <Input
          dir="ltr"
          aria-label={m.localization_settings_dialog_path_to_a_translation_file()}
          className="font-mono text-xs"
          placeholder={'apps/web/messages/{locale}.json'}
          value={draft.pattern}
          onChange={(event) => onChange({ pattern: event.target.value })}
        />
        <Button
          aria-label={m.localization_settings_dialog_remove_this_path()}
          size="icon-sm"
          title={m.localization_settings_dialog_remove_this_path()}
          variant="quiet"
          onClick={onRemove}
        >
          <IconTrash size={13} />
        </Button>
      </div>
      <p className={valid ? 'text-ink-muted text-xs' : 'text-removed text-xs'}>
        {valid
          ? m.lens_path_matches({ count: matches })
          : m.lens_add_token({ token: LOCALE_TOKEN })}
      </p>
      <p className="text-ink-muted text-xs">
        {m.localization_settings_dialog_how_placeholders_look()}
      </p>
      <Segmented
        aria-label={m.localization_settings_dialog_how_placeholders_look()}
        value={draft.placeholders}
        onValueChange={(value) =>
          onChange({ placeholders: value as PlaceholderSyntax })
        }
      >
        {PLACEHOLDER_SYNTAXES.map((syntax) => (
          <SegmentedItem key={syntax.id} title={syntax.label} value={syntax.id}>
            <span className="font-mono">{syntax.example}</span>
          </SegmentedItem>
        ))}
      </Segmented>
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
        <label className="text-ink-muted text-xs">
          {m.lens_compare_against()}
          <Input
            dir="ltr"
            className="mt-0.5 font-mono text-xs"
            placeholder={'en'}
            value={draft.baseLocale}
            onChange={(event) => onChange({ baseLocale: event.target.value })}
          />
        </label>
        <label className="text-ink-muted text-xs">
          {m.lens_skip_languages()}
          <Input
            dir="ltr"
            className="mt-0.5 font-mono text-xs"
            placeholder={'key, pseudo'}
            value={draft.generatedLocales}
            onChange={(event) =>
              onChange({ generatedLocales: event.target.value })
            }
          />
        </label>
      </div>
      <p className="text-ink-faint text-xs">
        {m.localization_settings_dialog_every_other_language_is_checked_against_the_one_in()}
      </p>
    </fieldset>
  );
}
