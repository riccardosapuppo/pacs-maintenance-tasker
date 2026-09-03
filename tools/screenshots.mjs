#!/usr/bin/env node
/**
 * The pictures in the README, made rather than taken.
 *
 *     npm run screenshots
 *
 * Nothing here photographs the screen. It starts its own service on its own
 * port, opens the console in a browser, drives it, and captures **the page** —
 * so whatever else happens to be on this machine cannot end up in a file about
 * to be pushed to a repository.
 *
 * Generated rather than kept by hand so they cannot quietly stop matching the
 * thing they are pictures of. Re-run whenever the console changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { aBrowser } from './a-browser.mjs';
import { startTheService } from './with-the-service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, '..', 'docs');

fs.mkdirSync(DOCS, { recursive: true });

const service = await startTheService();
const { browser, channel } = await aBrowser();

console.log(`\nRetaking the pictures in ${channel}\n`);

const say = (name) => console.log(`  docs/${name}`);

try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1150 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });

  const press = async (which) => {
    const before = await page.getAttribute('body', 'data-drawn');
    await page.locator(which).click();
    await page.waitForFunction((was) => document.body.dataset.drawn !== was, before, { timeout: 30_000 });
    await page.waitForTimeout(300);
  };

  await page.goto(`${service.base}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'yes', null, { timeout: 30_000 });
  await page.waitForTimeout(500);

  // 1. The whole page, after a dry run — which is the state anybody would be
  //    looking at before deciding anything.
  await press('[data-dry]');
  await page.screenshot({ path: path.join(DOCS, 'console.png'), fullPage: true });
  say('console.png');

  // 2. The run itself: what it chose, and every reason it held something back.
  await page.locator('#run').screenshot({ path: path.join(DOCS, 'a-dry-run.png') });
  say('a-dry-run.png');

  // 3. The seventeen studies the record system has nothing to say about — the
  //    ones the version this was rebuilt from would have deleted.
  await page.locator('[data-filters] button[data-filter="RECORDS_SAY_NOTHING"]').click();
  await page.waitForTimeout(400);
  await page.locator('#decisions').screenshot({ path: path.join(DOCS, 'silence.png') });
  say('silence.png');

  // 4. The mistake made on purpose: the disk refuses, the catalogue row goes
  //    first, and twenty-five folders become unfindable.
  await press('[data-reset]');
  await page.locator('[data-disk]').check();
  await page.locator('[data-order]').check();
  await page.locator('[data-permanent]').check();
  await press('[data-real]');

  await page.locator('#run').screenshot({ path: path.join(DOCS, 'orphans.png') });
  say('orphans.png');

  await page.locator('#mistakes').screenshot({ path: path.join(DOCS, 'the-two-mistakes.png') });
  say('the-two-mistakes.png');

  // 5. The three claims.
  await page.locator('#claims').screenshot({ path: path.join(DOCS, 'the-claims.png') });
  say('the-claims.png');

  // 6. The mark, at the sizes it is actually seen.
  const mark = await browser.newPage({ viewport: { width: 320, height: 96 }, deviceScaleFactor: 4 });
  const svg = fs.readFileSync(path.join(here, '..', 'public', 'mark.svg'), 'utf8');

  await mark.setContent(
    `<style>html,body{margin:0;background:#f4f1ee;display:flex;gap:18px;align-items:center;
       justify-content:center;height:96px}img{display:block}</style>` +
      [16, 32, 64]
        .map(
          (size) =>
            `<img src="data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}" width="${size}" height="${size}">`
        )
        .join('')
  );

  await mark.waitForFunction(() => [...document.images].every((one) => one.complete));
  await mark.screenshot({ path: path.join(DOCS, 'the-mark.png') });
  say('the-mark.png');
  await mark.close();

  await page.close();
} catch (error) {
  console.error(`\nThe pictures could not be retaken: ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await service.stop();
}
