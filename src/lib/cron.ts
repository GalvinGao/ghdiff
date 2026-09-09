import { parseCronExpression } from 'cron-schedule';
import cronstrue from 'cronstrue';

export interface CronSchedule {
  expression: string;
  description: string;
}

const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

// Restrict syntax before parsing: cron-schedule accepts numeric prefixes such
// as "1W" as 1. Range validation and expansion belong to the parser, not here.
const FIELD_PART =
  /^(?:\*(?:\/\d{1,2})?|(?:\d{1,2}|[a-z]{3})(?:-(?:\d{1,2}|[a-z]{3})(?:\/\d{1,2})?)?)$/i;
const FIELD_SEPARATOR = /\s+/;
const QUOTED_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;
const SCHEDULE_FIELD =
  /(?:^|\s)(?:cron|schedule)\s*[:=]\s*([^#\r\n]*)(?:#.*)?$/i;
const CRONTAB_PATH = /(?:^|\/)(?:crontab|[^/]+\.cron)$|(?:^|\/)cron\.d\//i;
const CRONTAB_COMMENT = /^\s*#/;
const CRONTAB_ENTRY = /^\s*(@[a-z]+|\S+(?:[\t ]+\S+){4})(?=[\t ]|$)/;

// Turn sorted, distinct values back into concise input for the descriptor.
// Only minutes and hours have fixed cycles: */35 is :00 and :35, whereas
// */5 really is every five minutes. Calendar fields never become intervals.
function normalizeField(
  values: readonly number[],
  cardinality: number,
  cyclic = false,
  offset = 0
): string {
  if (values.length === cardinality) return '*';
  const first = values[0]!;
  if (values.length > 1) {
    const step = values[1]! - first;
    if (
      cyclic &&
      first === 0 &&
      cardinality % step === 0 &&
      values.length === cardinality / step &&
      values.every((value, index) => value === index * step)
    ) {
      return `*/${step}`;
    }
    if (values.every((value, index) => value === first + index)) {
      return `${first + offset}-${values[values.length - 1]! + offset}`;
    }
  }
  return offset === 0
    ? values.join(',')
    : values.map((value) => value + offset).join(',');
}

/** Validate before describing: cronstrue deliberately is not a validator.
 * Five fields only; a sixth could be seconds OR a year in another dialect. */
export function describeCron(expression: string): string | undefined {
  if (expression.length > 256) return undefined;
  const source = expression.trim();
  if (source === '@reboot') return 'At system startup';
  const fields = (Object.hasOwn(ALIASES, source) ? ALIASES[source]! : source)
    .toUpperCase()
    .split(FIELD_SEPARATOR);
  if (
    fields.length !== 5 ||
    fields.some((field) =>
      field.split(',').some((part) => !FIELD_PART.test(part))
    )
  ) {
    return undefined;
  }

  try {
    const parsed = parseCronExpression(fields.join(' '));
    const normalized = [
      normalizeField(parsed.minutes, 60, true),
      normalizeField(parsed.hours, 24, true),
      normalizeField(parsed.days, 31),
      normalizeField(parsed.months, 12, false, 1),
      normalizeField(parsed.weekdays, 7),
    ];
    // Cron's two restricted day fields are OR, not Quartz's AND. Spell it
    // out: cronstrue's default "and on Friday" is easy to read as AND.
    // Vixie cron records a leading star, not any star in a list. Decide this
    // before normalization: an explicit full range is not a wildcard flag.
    const bothDays = !fields[2]!.startsWith('*') && !fields[4]!.startsWith('*');
    const describe = (parts: string[]) =>
      cronstrue.toString(parts.join(' '), {
        use24HourTimeFormat: true,
        throwExceptionOnParseError: true,
        logicalAndDayFields: !bothDays,
      });
    if (bothDays) {
      const byDate = [...normalized];
      const byWeekday = [...normalized];
      byDate[4] = '*';
      byWeekday[2] = '*';
      return `${describe(byDate)}; or ${describe(byWeekday)}`;
    }
    return describe(normalized);
  } catch {
    return undefined;
  }
}

/** Match whole literals, never a five-field substring of a different dialect.
 * Bare entries are accepted only in cron files or an explicit schedule field. */
export function findCronSchedules(line: string, path: string): CronSchedule[] {
  const schedules: CronSchedule[] = [];
  const add = (candidate: string) => {
    const expression = candidate.trim();
    if (schedules.some((schedule) => schedule.expression === expression))
      return;
    const description = describeCron(expression);
    if (description != null) schedules.push({ expression, description });
  };
  // Scan literal boundaries rather than Shiki tokens: one cron string can
  // span several tokens, and token boundaries change with the highlighter.
  for (const match of line.matchAll(QUOTED_LITERAL)) {
    add(match[2]!);
  }
  const field = SCHEDULE_FIELD.exec(line);
  if (field != null) add(field[1]!);
  if (CRONTAB_PATH.test(path) && !CRONTAB_COMMENT.test(line)) {
    const entry = CRONTAB_ENTRY.exec(line);
    if (entry != null) add(entry[1]!);
  }
  return schedules;
}
