import cronstrue from 'cronstrue';

export interface CronSchedule {
  expression: string;
  description: string;
}

const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const DAYS = 'SUN MON TUE WED THU FRI SAT'.split(' ');
const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTHS },
  { min: 0, max: 7, names: DAYS },
];
const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

/** Validate before describing: cronstrue deliberately is not a validator.
 * Five fields only; a sixth could be seconds OR a year in another dialect. */
export function describeCron(expression: string): string | undefined {
  if (expression.length > 256) return undefined;
  const source = expression.trim();
  if (source === '@reboot') return 'At system startup';
  const fields = (Object.hasOwn(ALIASES, source) ? ALIASES[source]! : source)
    .toUpperCase()
    .split(/\s+/);
  if (fields.length !== FIELDS.length) return undefined;

  const normalized: string[] = [];
  for (const [index, field] of fields.entries()) {
    const { min, max, names } = FIELDS[index]!;
    const value = (text: string): number => {
      if (/^\d{1,2}$/.test(text)) return Number(text);
      const named = names?.indexOf(text) ?? -1;
      return named < 0 ? NaN : named + min;
    };
    const parts: string[] = [];
    for (const part of field.split(',')) {
      const match =
        /^(\*|[A-Z]{3}|\d{1,2})(?:-([A-Z]{3}|\d{1,2}))?(?:\/(\d{1,2}))?$/.exec(
          part
        );
      if (match == null) return undefined;
      const [, start, end, stepText] = match;
      if (start === '*' && end != null) return undefined;
      if (stepText != null && start !== '*' && end == null) return undefined;
      const low = start === '*' ? min : value(start!);
      const high = start === '*' ? max : end == null ? low : value(end);
      const step = stepText == null ? 1 : Number(stepText);
      if (
        !Number.isFinite(low) ||
        !Number.isFinite(high) ||
        low < min ||
        high > max ||
        low > high ||
        step < 1 ||
        step > max - min + 1
      ) {
        return undefined;
      }
      // A step resets at the field boundary. "Every 35 minutes" is false:
      // */35 runs at :00 and :35, not at a constant 35-minute interval.
      if (
        (index === 4 && start !== '*' && high === 7 && end != null) ||
        (stepText != null &&
          !(start === '*' && index < 2 && (max + 1) % step === 0))
      ) {
        for (let n = low; n <= high; n += step) {
          parts.push(String(index === 4 ? n % 7 : n));
        }
      } else {
        parts.push(part);
      }
    }
    normalized.push(parts.join(','));
  }

  try {
    // Cron's two restricted day fields are OR, not Quartz's AND. Spell it
    // out: cronstrue's default "and on Friday" is easy to read as AND.
    const bothDays = !fields[2]!.includes('*') && !fields[4]!.includes('*');
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
  for (const match of line.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g)) {
    add(match[2]!);
  }
  const field = /(?:^|\s)(?:cron|schedule)\s*[:=]\s*([^#\r\n]*)(?:#.*)?$/i.exec(
    line
  );
  if (field != null) add(field[1]!);
  if (
    /(?:^|\/)(?:crontab|[^/]+\.cron)$|(?:^|\/)cron\.d\//i.test(path) &&
    !/^\s*#/.test(line)
  ) {
    const entry = /^\s*(@[a-z]+|\S+(?:[\t ]+\S+){4})(?=[\t ]|$)/.exec(line);
    if (entry != null) add(entry[1]!);
  }
  return schedules;
}
