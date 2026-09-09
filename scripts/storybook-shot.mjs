import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [storyId = 'review-pull-status--states', theme = 'light'] =
  process.argv.slice(2);
if (!['light', 'dark'].includes(theme))
  throw new Error('Theme must be light or dark');
const output = await mkdtemp(join(tmpdir(), 'storybook-shot-'));
const url = new URL(
  '/iframe.html',
  process.env.STORYBOOK_URL ?? 'http://localhost:6006'
);
url.search = new URLSearchParams({
  id: storyId,
  viewMode: 'story',
  globals: `theme:${theme}`,
}).toString();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 2,
  });
  await page.goto(url.href);
  await page.locator('#storybook-root > *').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Allow entrance transitions to settle; videos keep normal motion too.
  await page.waitForTimeout(500);
  const path = join(output, 'screenshot.png');
  await page.screenshot({ path });
  console.log(path);
} finally {
  await browser.close();
}
