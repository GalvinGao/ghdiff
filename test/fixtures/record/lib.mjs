// The scaffold the record scripts share: fetch with retry, one file per
// source, and a `_meta.json` manifest of what came from where.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

/** @typedef {{ file: string, url: string, status: number, kind: 'json' | 'text', headers?: Record<string, string> }} Source */

const ATTEMPTS = 5;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A dropped request deserves another attempt; `retryOn` names the statuses that do too. */
async function fetchWithRetry(url, init, retryOn) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, init);
      if (
        (response.status >= 500 || retryOn(response.status)) &&
        attempt < ATTEMPTS
      ) {
        await delay(1000 * 2 ** (attempt - 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await delay(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function record(outDir, headers, retryOn, source) {
  const response = await fetchWithRetry(
    source.url,
    { headers: source.headers ?? headers, redirect: 'follow' },
    retryOn
  );
  if (response.status !== source.status) {
    throw new Error(
      `${source.url}: expected ${source.status}, got ${response.status}`
    );
  }
  const text =
    source.kind === 'json'
      ? `${JSON.stringify(await response.json(), null, 2)}\n`
      : await response.text();
  await writeFile(new URL(source.file, outDir), text);
  console.log(`${source.file}  ${text.length} bytes  <- ${source.url}`);
}

/**
 * Records every source into `outDir`, then writes its `_meta.json` manifest.
 * With `keepUnrecorded`, entries this run did not record carry over from the
 * existing manifest, or a re-run would silently drop them while their files
 * stay behind.
 */
export async function recordAll({
  outDir,
  sources,
  headers,
  retryOn = () => false,
  keepUnrecorded = false,
  note,
}) {
  await mkdir(outDir, { recursive: true });
  for (const source of sources) {
    await record(outDir, headers, retryOn, source);
  }

  let kept = [];
  if (keepUnrecorded) {
    const recorded = new Set(sources.map((source) => source.file));
    try {
      const existing = JSON.parse(
        await readFile(new URL('_meta.json', outDir), 'utf8')
      );
      kept = (existing.sources ?? []).filter(
        (source) => !recorded.has(source.file)
      );
    } catch {
      // No manifest yet: the first run writes one.
    }
  }

  const meta = {
    recordedAt: new Date().toISOString(),
    note,
    sources: [
      ...sources.map(({ file, url, status }) => ({ file, url, status })),
      ...kept,
    ],
  };
  await writeFile(
    new URL('_meta.json', outDir),
    `${JSON.stringify(meta, null, 2)}\n`
  );
  console.log('_meta.json  written');
}
