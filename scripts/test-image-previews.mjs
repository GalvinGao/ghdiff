import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const output =
  process.env.EVIDENCE_DIR ??
  (await mkdtemp(join(tmpdir(), 'image-previews-')));
const origin = process.env.STORYBOOK_URL ?? 'http://localhost:6006';
const fixture = await readFile(
  new URL('../src/components/fixtures/image-preview.svg', import.meta.url)
);
const browser = await chromium.launch();
const results = [];
try {
  for (const scenario of [
    {
      name: 'desktop-light',
      width: 1200,
      height: 700,
      theme: 'light',
      story: 'unified',
    },
    {
      name: 'desktop-dark',
      width: 1200,
      height: 700,
      theme: 'dark',
      story: 'unified',
    },
    {
      name: 'phone',
      width: 402,
      height: 874,
      theme: 'light',
      story: 'unified',
      touch: true,
    },
    { name: 'split', width: 1200, height: 700, theme: 'light', story: 'split' },
    {
      name: 'search',
      width: 1200,
      height: 700,
      theme: 'light',
      story: 'search',
    },
    {
      name: 'fallback',
      width: 900,
      height: 650,
      theme: 'light',
      story: 'unified',
      fallback: true,
    },
    {
      name: 'chinese',
      width: 900,
      height: 650,
      theme: 'light',
      story: 'unified',
      locale: 'zh-Hans',
    },
    {
      name: 'arabic',
      width: 402,
      height: 874,
      theme: 'light',
      story: 'unified',
      locale: 'ar',
    },
  ]) {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: scenario.height },
      hasTouch: !!scenario.touch,
      isMobile: !!scenario.touch,
    });
    if (scenario.locale)
      await context.addCookies([
        { name: 'PARAGLIDE_LOCALE', value: scenario.locale, url: origin },
      ]);
    if (scenario.fallback)
      await context.addInitScript(() => {
        delete HTMLElement.prototype.showPopover;
        delete HTMLElement.prototype.hidePopover;
      });
    const page = await context.newPage();
    const errors = [];
    const imageRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.resourceType() === 'image') imageRequests.push(request.url());
    });
    await page.route('**/*slow=1', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: fixture,
      });
    });
    const url = new URL('/iframe.html', origin);
    url.search = new URLSearchParams({
      id: `review-image-link-previews--${scenario.story}`,
      viewMode: 'story',
      globals: `theme:${scenario.theme}`,
      args: `themeType:${scenario.theme}`,
    });
    await page.goto(url.href);
    const buttons = page.locator('[data-ghdiff-image]');
    await buttons.nth(2).waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Wait for the first worker-highlight pass to finish recycling its rows.
    await page.waitForTimeout(700);
    assert.equal(await buttons.count(), 3);
    const codeTheme = await buttons.first().evaluate((button) => {
      const row = button.closest('[data-line]');
      return getComputedStyle(row).getPropertyValue('color-scheme');
    });
    assert.equal(
      codeTheme,
      scenario.theme,
      'the code surface uses the requested theme'
    );
    assert.equal(
      imageRequests.length,
      0,
      'rendering does not download linked images'
    );
    const source = await buttons
      .first()
      .evaluate((button) => button.closest('[data-line]').textContent);
    const imageUrl = await buttons.first().getAttribute('data-ghdiff-image');
    assert.equal(source.trimEnd(), `const landscape = "${imageUrl}";`);
    await page.screenshot({
      path: join(output, `${scenario.name}-closed.png`),
    });
    if (scenario.touch) await buttons.first().tap();
    else await buttons.first().hover();
    const panel = page.locator('[data-ghdiff-image-preview]');
    const image = panel.locator('img');
    await image.waitFor();
    assert.ok(await image.evaluate((node) => node.naturalWidth > 0));
    const box = await panel.boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= scenario.width &&
        box.y + box.height <= scenario.height
    );
    await page.screenshot({ path: join(output, `${scenario.name}-open.png`) });
    // Hover content is reachable; opening never changes copied source text.
    await panel.hover();
    await page.waitForTimeout(220);
    assert.ok(await panel.isVisible());
    assert.equal(
      await buttons
        .first()
        .evaluate((button) => button.closest('[data-line]').textContent),
      source
    );
    if (scenario.story === 'search') {
      const texts = await page.evaluate(() =>
        [...CSS.highlights.get('ghdiff-search')].map((span) => {
          const range = document.createRange();
          range.setStart(span.startContainer, span.startOffset);
          range.setEnd(span.endContainer, span.endOffset);
          return range.toString();
        })
      );
      assert.ok(
        texts.length > 0 && texts.every((text) => text === imageUrl),
        'highlight spans still cover the original URLs'
      );
    }
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false);
    assert.equal(await buttons.first().getAttribute('aria-expanded'), 'false');
    // Keyboard activation enters the nonmodal preview; close restores the trigger.
    await buttons.first().focus();
    await buttons.first().press('Enter');
    await image.waitFor();
    assert.equal(
      await panel
        .locator('a')
        .evaluate((node) => node.getRootNode().activeElement === node),
      true
    );
    await panel.locator('button').click();
    assert.equal(await panel.isVisible(), false);
    assert.equal(
      await buttons
        .first()
        .evaluate((node) => node.getRootNode().activeElement === node),
      true
    );
    // Loading and failed states stay bounded and can be dismissed.
    await page.mouse.move(0, 0);
    await buttons.nth(1).click();
    await panel.locator('[role="status"]').waitFor();
    await page.screenshot({
      path: join(output, `${scenario.name}-loading.png`),
    });
    await image.waitFor();
    await page.keyboard.press('Escape');
    await buttons.nth(2).click();
    const catalog = JSON.parse(
      await readFile(
        new URL(`../messages/${scenario.locale ?? 'en'}.json`, import.meta.url),
        'utf8'
      )
    );
    await panel
      .getByText(catalog.image_preview_failed, { exact: true })
      .waitFor();
    await page.screenshot({
      path: join(output, `${scenario.name}-failed.png`),
    });
    // The original link remains available and reopening retries the image.
    assert.ok(
      (await panel.locator('a').getAttribute('href')).endsWith(
        '/missing-preview.png'
      )
    );
    await page.keyboard.press('Escape');
    await page.route('**/missing-preview.png', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: fixture,
      })
    );
    await buttons.nth(2).click();
    await image.waitFor();
    await page.mouse.click(scenario.width - 4, scenario.height - 4);
    assert.equal(await panel.isVisible(), false);
    await page.mouse.move(0, 0);
    await buttons.first().hover();
    await image.waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    assert.equal(
      await panel.isVisible(),
      false,
      'scroll removes a stale preview'
    );
    await page.setViewportSize({
      width: scenario.width - 20,
      height: scenario.height,
    });
    await page.waitForTimeout(200);
    assert.equal(
      await buttons.count(),
      3,
      'rerenders do not duplicate buttons'
    );
    assert.deepEqual(errors, []);
    results.push({
      ...scenario,
      imageRequests: imageRequests.length,
      passed: true,
    });
    await context.close();
  }
  await writeFile(
    join(output, 'browser-results.json'),
    JSON.stringify(results, null, 2) + '\n'
  );
  console.log(JSON.stringify({ output, results }, null, 2));
} finally {
  await browser.close();
}
