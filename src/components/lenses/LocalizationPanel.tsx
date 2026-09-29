import type { AnnotationSide } from '@pierre/diffs';
import { IconArrowDownRight, IconGlobe } from '@pierre/icons';

import { LensFrame } from '@/components/lenses/LensFrame';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu';
import { cn } from '@/lib/cn';
import { LENSES } from '@/lib/lenses/lenses';
import type { LocalizationSettings } from '@/lib/lenses/localization/config';
import {
  isProblem,
  type LocaleValue,
  type LocalizationGroup,
  type LocalizationIssue,
  type LocalizationKey,
  type LocalizationKeyKind,
  type LocalizationModel,
} from '@/lib/lenses/localization/model';
import {
  type PlaceholderSyntax,
  tokenizeMessage,
} from '@/lib/lenses/localization/placeholders';
import {
  isLocaleShown,
  localeChoices,
  readableLocales,
  showAllLocales,
  shownLocales,
  toggleShownLocale,
} from '@/lib/lenses/localization/shownLocales';

// The catalogue files of a diff, read as one table instead of one file apiece.
//
// It sits above the first file in the diff's own scroll, so it moves with the
// diff and needs no pane of its own. Every row can still reach its line in the
// patch, because a comment on GitHub can only be written against a diff line,
// and a table that could not get there would be a place to read and never a
// place to review.

export interface LocalizationPanelProps {
  model: LocalizationModel;
  settings: LocalizationSettings;
  /** True while the claimed files are drawn in the diff as files. */
  rawShown: boolean;
  onSettingsChange(next: LocalizationSettings): void;
  onRawShownChange(shown: boolean): void;
  onJumpToLine(itemId: string, side: AnnotationSide, lineNumber: number): void;
  onOpenSettings(): void;
  /** Turns the lens off for this repository. */
  onTurnOff(): void;
}

export function LocalizationPanel({
  model,
  onJumpToLine,
  onOpenSettings,
  onRawShownChange,
  onSettingsChange,
  onTurnOff,
  rawShown,
  settings,
}: LocalizationPanelProps) {
  if (model.groups.length === 0) return null;

  if (rawShown) {
    return (
      <section
        aria-label={LENSES.localization.label}
        className="border-line bg-surface flex items-center gap-2 border-b px-3 py-1.5 text-xs"
      >
        <IconGlobe aria-hidden="true" className="text-ink-faint" size={13} />
        <span className="text-ink-muted min-w-0 flex-1 truncate">
          {model.claimedItemIds.size} translation{' '}
          {model.claimedItemIds.size === 1 ? 'file is' : 'files are'} shown as
          files below.
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onRawShownChange(false)}
        >
          Show as table
        </Button>
      </section>
    );
  }

  const choices = localeChoices(model.groups);
  const chosenAll = settings.shownLocales == null;
  const menu = (
    <>
      <DropdownMenuLabel>Languages</DropdownMenuLabel>
      {choices.readable.map((locale) => {
        const base = choices.bases.has(locale);
        return (
          <DropdownMenuCheckboxItem
            key={locale}
            checked={isLocaleShown(locale, choices, settings)}
            disabled={base}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() =>
              onSettingsChange(toggleShownLocale(settings, choices, locale))
            }
          >
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-xs">{locale}</span>
              {base && <span className="text-ink-faint text-xs">base</span>}
            </span>
          </DropdownMenuCheckboxItem>
        );
      })}
      {!chosenAll && (
        <DropdownMenuItem
          className="text-ink-muted"
          onSelect={(event) => {
            event.preventDefault();
            onSettingsChange(showAllLocales(settings));
          }}
        >
          Show all languages
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onOpenSettings}>
        Paths and format…
      </DropdownMenuItem>
    </>
  );

  return (
    <LensFrame
      menu={menu}
      settingsLabel={`${LENSES.localization.label} settings`}
      onTurnOff={onTurnOff}
    >
      {model.groups.map((group) => (
        <LocalizationGroupSection
          key={group.source.pattern}
          group={group}
          settings={settings}
          onJumpToLine={onJumpToLine}
        />
      ))}
    </LensFrame>
  );
}

/** The DOM id a tree jump scrolls to, for the group holding a file. */
export function localizationGroupId(pattern: string): string {
  return `ghdiff-l10n-${pattern.replace(/[^\w-]+/g, '-')}`;
}

function LocalizationGroupSection({
  group,
  onJumpToLine,
  settings,
}: {
  group: LocalizationGroup;
  settings: LocalizationSettings;
  onJumpToLine: LocalizationPanelProps['onJumpToLine'];
}) {
  const readable = readableLocales(group);
  const shown = shownLocales(group, settings);
  const base = group.source.baseLocale;
  const problems = group.keys.reduce(
    (count, key) => count + key.issues.filter(isProblem).length,
    0
  );
  const fileCount = group.locales.length;

  return (
    <section
      id={localizationGroupId(group.source.pattern)}
      aria-label={`${LENSES.localization.label}, ${group.label}`}
      className="border-line [&+&]:border-t"
    >
      <header className="flex h-10 items-center gap-2 px-3">
        <IconGlobe aria-hidden="true" className="text-ink-muted" size={14} />
        <h2 className="text-ink shrink-0 text-sm font-medium">
          {LENSES.localization.label}
        </h2>
        <span
          className="text-ink-muted min-w-0 truncate font-mono text-xs"
          title={group.source.pattern}
        >
          {group.label}
        </span>
        <span className="text-ink-faint shrink-0 text-xs tabular-nums">
          {group.keys.length} {group.keys.length === 1 ? 'key' : 'keys'} ·{' '}
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
        {/* Only a problem is worth a word here. A catalogue that checks out
            says nothing, because a line that says so on every clean diff is
            a line nobody reads by the day it says something else. */}
        {problems > 0 && (
          <span className="text-removed shrink-0 text-xs">
            {problems} {problems === 1 ? 'problem' : 'problems'}
          </span>
        )}
      </header>

      <ol>
        {group.keys.map((key) => (
          <KeyCard
            key={key.key}
            base={base}
            entry={key}
            readable={readable}
            shown={shown}
            syntax={group.source.placeholders}
            onJumpToLine={onJumpToLine}
          />
        ))}
      </ol>

      <GroupFootnotes group={group} />
    </section>
  );
}

const KIND_LABEL: Record<LocalizationKeyKind, string> = {
  added: 'added',
  removed: 'removed',
  changed: 'changed',
};

const KIND_CLASS: Record<LocalizationKeyKind, string> = {
  added: 'text-added border-added/40',
  removed: 'text-removed border-removed/40',
  changed: 'text-ink-muted border-line',
};

function KeyCard({
  base,
  entry,
  onJumpToLine,
  readable,
  shown,
  syntax,
}: {
  base: string | undefined;
  entry: LocalizationKey;
  onJumpToLine: LocalizationPanelProps['onJumpToLine'];
  /** Every locale that is not generated, shown or not. */
  readable: readonly string[];
  shown: readonly string[];
  syntax: PlaceholderSyntax;
}) {
  const issuesByLocale = new Map<string, LocalizationIssue[]>();
  for (const issue of entry.issues) {
    const list = issuesByLocale.get(issue.locale) ?? [];
    list.push(issue);
    issuesByLocale.set(issue.locale, list);
  }
  // A hidden language does not hide a problem: its issues are counted here,
  // under the rows that are on screen.
  const hiddenProblems = entry.issues.filter(
    (issue) => isProblem(issue) && !shown.includes(issue.locale)
  );
  const hiddenCount = [...entry.values.keys()].filter(
    (locale) => readable.includes(locale) && !shown.includes(locale)
  ).length;

  return (
    <li className="border-line border-t">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <span
          className={cn(
            'rounded border px-1 text-[10px] leading-4',
            KIND_CLASS[entry.kind]
          )}
        >
          {KIND_LABEL[entry.kind]}
        </span>
        <span
          className="text-ink min-w-0 truncate font-mono text-xs"
          title={entry.key}
        >
          {entry.key}
        </span>
      </div>
      <table className="mb-1.5 w-full table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-16" />
          <col />
          <col className="w-9" />
        </colgroup>
        <tbody>
          {shown.map((locale) => (
            <LocaleRow
              key={locale}
              base={base}
              isBase={locale === base}
              issues={issuesByLocale.get(locale) ?? []}
              locale={locale}
              syntax={syntax}
              value={entry.values.get(locale)}
              onJumpToLine={onJumpToLine}
            />
          ))}
          {/* A row of the table and not a paragraph under it, so it keeps the
              rows' own rhythm: the same padding above and below, and the same
              column its text starts in. */}
          {(hiddenCount > 0 || hiddenProblems.length > 0) && (
            <tr>
              <td />
              <td className="text-ink-faint py-1 text-xs leading-5" colSpan={2}>
                {hiddenCount > 0 && `${String(hiddenCount)} hidden`}
                {hiddenProblems.length > 0 && (
                  <span className="text-removed">
                    {hiddenCount > 0 && ' · '}
                    {hiddenProblems
                      .map(
                        (issue) =>
                          `${issue.locale}: ${describeIssue(issue, base)}`
                      )
                      .join(', ')}
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </li>
  );
}

function LocaleRow({
  base,
  isBase,
  issues,
  locale,
  onJumpToLine,
  syntax,
  value,
}: {
  base: string | undefined;
  isBase: boolean;
  issues: readonly LocalizationIssue[];
  locale: string;
  onJumpToLine: LocalizationPanelProps['onJumpToLine'];
  syntax: PlaceholderSyntax;
  value: LocaleValue | undefined;
}) {
  const jump = value == null ? undefined : jumpTarget(value);
  return (
    <tr className="group/row hover:bg-surface align-baseline">
      <th
        scope="row"
        className={cn(
          'py-1 pl-3 text-left font-mono text-xs font-normal',
          isBase ? 'text-ink' : 'text-ink-muted'
        )}
      >
        {locale}
      </th>
      <td className="min-w-0 py-1 pr-2 break-words">
        {value == null ? (
          <span className="text-ink-faint">Not in this diff</span>
        ) : (
          <>
            {value.old != null && (
              <Message
                className={cn(
                  value.new != null && 'block',
                  'text-removed decoration-removed/50 line-through'
                )}
                syntax={syntax}
                text={value.old}
              />
            )}
            {value.new != null && (
              <Message className="text-ink" syntax={syntax} text={value.new} />
            )}
          </>
        )}
        {issues.map((issue) => (
          <IssueTag
            key={`${issue.kind}:${issue.names?.join(',') ?? ''}`}
            base={base}
            issue={issue}
          />
        ))}
      </td>
      <td className="py-0.5 pr-2 text-right align-middle">
        {value != null && jump != null && (
          <button
            type="button"
            aria-label={`Show ${locale} in the diff`}
            className="text-ink-faint hover:text-ink inline-flex size-5 items-center justify-center rounded opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
            title="Show in the diff"
            onClick={() => onJumpToLine(value.itemId, jump.side, jump.line)}
          >
            <IconArrowDownRight size={12} />
          </button>
        )}
      </td>
    </tr>
  );
}

function jumpTarget(
  value: LocaleValue
): { side: AnnotationSide; line: number } | undefined {
  if (value.newLine != null) return { side: 'additions', line: value.newLine };
  if (value.oldLine != null) return { side: 'deletions', line: value.oldLine };
  return undefined;
}

/** A message with its placeholders drawn as chips. */
function Message({
  className,
  syntax,
  text,
}: {
  className?: string;
  syntax: PlaceholderSyntax;
  text: string;
}) {
  return (
    <span className={className}>
      {tokenizeMessage(text, syntax).map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <code
            key={index}
            className="border-line bg-surface text-ink mx-px rounded border px-0.5 font-mono text-[12px] no-underline"
          >
            {segment.text}
          </code>
        )
      )}
    </span>
  );
}

function describeIssue(
  issue: LocalizationIssue,
  base: string | undefined
): string {
  const names = issue.names?.map((name) => `{${name}}`).join(' ') ?? '';
  switch (issue.kind) {
    case 'missing-placeholder':
      return `missing ${names}`;
    case 'extra-placeholder':
      return `extra ${names}`;
    case 'absent':
      return 'not added';
    case 'same-as-base':
      return `same as ${base ?? 'the base'}`;
  }
}

function IssueTag({
  base,
  issue,
}: {
  base: string | undefined;
  issue: LocalizationIssue;
}) {
  const problem = isProblem(issue);
  return (
    <span
      className={cn(
        'ml-2 inline-block rounded border px-1 align-baseline text-[11px] leading-4',
        problem
          ? 'border-removed/50 text-removed'
          : 'border-line text-ink-faint'
      )}
    >
      {describeIssue(issue, base)}
    </span>
  );
}

function GroupFootnotes({ group }: { group: LocalizationGroup }) {
  if (group.unreadPaths.length === 0) return null;
  return (
    <p className="border-line text-ink-faint border-t px-3 py-1.5 text-xs">
      {group.unreadPaths.length}{' '}
      {group.unreadPaths.length === 1 ? 'file has' : 'files have'} nested
      messages. {group.unreadPaths.length === 1 ? 'It stays' : 'They stay'} in
      the diff below.
    </p>
  );
}
