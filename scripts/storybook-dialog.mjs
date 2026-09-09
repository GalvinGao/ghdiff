export const viewport = { width: 960, height: 540 };

export async function setup(page) {
  const url = new URL(
    '/iframe.html',
    process.env.STORYBOOK_URL ?? 'http://localhost:6006'
  );
  url.search = new URLSearchParams({
    id: 'ui-dialog--interaction',
    viewMode: 'story',
    globals: 'theme:light',
  }).toString();
  await page.goto(url.href);
  await page
    .getByRole('button', { name: 'Open dialog', exact: true })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
}

export async function run(page, { outputDir }) {
  await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review ready' });
  await dialog.waitFor();
  await page.waitForTimeout(400);
  await dialog.screenshot({ path: `${outputDir}/dialog.png` });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(400);
}
