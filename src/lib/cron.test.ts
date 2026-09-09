import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeCron, findCronSchedules } from './cron.ts';

const EVERY_FIVE_MINUTES = /every 5 minutes/i;
const WEEKDAY_MORNING = /09:00.*Monday.*Friday/;
const WEEKDAY_RANGE = /Monday.*Friday/;
const EVERY_TEN_MINUTES = /every 10 minutes/i;
const SYSTEM_STARTUP = /startup/i;
const MINUTES_ZERO_AND_THIRTY_FIVE = /0 and 35 minutes/;
const EVERY_THIRTY_FIVE_MINUTES = /every 35 minutes/i;
const HOURS_ZERO_AND_TWENTY_THREE = /00:00.*23:00/;
const ODD_CALENDAR_DAYS = /day 1, 3, 5/;
const MINUTES_ZERO_FIVE_TEN = /0, 5, and 10 minutes/;
const FIRST_DAY_OR_FRIDAY = /day 1.*; or .*Friday/;
const MONDAY_THROUGH_THURSDAY = /Monday|Tuesday|Wednesday|Thursday/;
const ODD_DAYS_ON_MONDAY = /day 1, 3.*only on Monday/;
const JANUARY = /January/;
const DECEMBER = /December/;
const OR_MONDAY = /; or .*Monday/;
const REPEATED_FIRST_DAY = /day 1, 1,/;
const DAY_FIELD_DISJUNCTION = /; or /;

describe('cron schedules', () => {
  it('reads literal schedules in configuration and code without needing token boundaries', () => {
    const schedules = findCronSchedules(
      'cron.schedule("*/5 * * * *", run);',
      'jobs.ts'
    );
    assert.equal(schedules[0]?.expression, '*/5 * * * *');
    assert.match(schedules[0]!.description, EVERY_FIVE_MINUTES);
    assert.match(
      findCronSchedules("  - cron: '0 9 * * MON-FRI'", 'ci.yml')[0]!
        .description,
      WEEKDAY_MORNING
    );
    assert.equal(
      findCronSchedules('const jobs = ["@daily", `@hourly`];', 'jobs.ts')
        .length,
      2
    );
  });

  it('accepts bare cron entries only with file or field context', () => {
    assert.match(
      findCronSchedules('0 9 * * 1-5 /usr/bin/run', 'etc/cron.d/jobs')[0]!
        .description,
      WEEKDAY_RANGE
    );
    assert.match(
      findCronSchedules('schedule: */10 * * * * # refresh', 'jobs.yml')[0]!
        .description,
      EVERY_TEN_MINUTES
    );
    assert.match(
      findCronSchedules('@reboot /usr/bin/run', 'crontab')[0]!.description,
      SYSTEM_STARTUP
    );
    assert.deepEqual(findCronSchedules('* * * * *', 'README.md'), []);
    assert.deepEqual(
      findCronSchedules('# 0 9 * * * /usr/bin/run', 'crontab'),
      []
    );
  });

  it('never reads part of an unsupported dialect or an invalid expression', () => {
    for (const expression of [
      '0 0 9 * * *',
      '0 0 9 ? * MON *',
      '60 * * * *',
      '0 24 * * *',
      '0 0 0 * *',
      '0 0 * 13 *',
      '0 0 * * 8',
      '*/0 * * * *',
      '0 9-2 * * *',
      '0 0 * FOO *',
      '0 0 * * MON#2',
      '0 0 L * *',
      '0 0 1W * *',
      '0 0 * * 1#2',
      '1abc * * * *',
      '1/5 * * * *',
      '0 0 * * ?',
      '0 0 * * * trailing',
    ]) {
      assert.equal(describeCron(expression), undefined, expression);
      assert.deepEqual(
        findCronSchedules(`schedule: "${expression}"`, 'jobs.yml'),
        [],
        expression
      );
    }
    assert.deepEqual(
      findCronSchedules('const words = "run at 0 9 * * * please";', 'jobs.ts'),
      []
    );
    assert.deepEqual(
      findCronSchedules('const cron = "${minute} * * * *";', 'jobs.ts'),
      []
    );
  });

  it('spells out steps that reset rather than claiming a constant interval', () => {
    assert.match(describeCron('*/35 * * * *')!, MINUTES_ZERO_AND_THIRTY_FIVE);
    assert.doesNotMatch(
      describeCron('*/35 * * * *')!,
      EVERY_THIRTY_FIVE_MINUTES
    );
    assert.match(describeCron('0 */23 * * *')!, HOURS_ZERO_AND_TWENTY_THREE);
    assert.match(describeCron('0 0 */2 * *')!, ODD_CALENDAR_DAYS);
    assert.match(describeCron('0,5,10 * * * *')!, MINUTES_ZERO_FIVE_TEN);
    assert.doesNotMatch(describeCron('0,5,10 * * * *')!, EVERY_FIVE_MINUTES);
  });

  it('preserves the OR between restricted day fields and Sunday aliases', () => {
    assert.match(describeCron('0 0 1 * FRI')!, FIRST_DAY_OR_FRIDAY);
    assert.equal(describeCron('0 0 * * 0'), describeCron('0 0 * * 7'));
    const weekend = describeCron('0 0 * * 5-7')!;
    for (const day of ['Friday', 'Saturday', 'Sunday']) {
      assert.ok(weekend.includes(day));
    }
    assert.doesNotMatch(weekend, MONDAY_THROUGH_THURSDAY);
    assert.equal(describeCron('0 0 * * 0-7'), describeCron('0 0 * * *'));
    assert.match(describeCron('0 0 */2 * MON')!, ODD_DAYS_ON_MONDAY);
  });

  it('describes equivalent overlapping fields once', () => {
    assert.equal(describeCron('0 0 1,1-5 * *'), describeCron('0 0 1-5 * *'));
    assert.equal(describeCron('0 0 * JAN,MAR *'), describeCron('0 0 * 1,3 *'));
  });

  it('keeps calendar names on the same month after normalization', () => {
    assert.match(describeCron('0 0 1 JAN *')!, JANUARY);
    assert.match(describeCron('0 0 1 DEC *')!, DECEMBER);
    assert.equal(describeCron('@midnight'), describeCron('@daily'));
  });

  it('takes the day-field wildcard flag from the first character', () => {
    const restricted = describeCron('0 0 1,*/2 * MON')!;
    assert.match(restricted, OR_MONDAY);
    assert.doesNotMatch(restricted, REPEATED_FIRST_DAY);
    assert.doesNotMatch(
      describeCron('0 0 */2,1 * MON')!,
      DAY_FIELD_DISJUNCTION
    );
  });
});
