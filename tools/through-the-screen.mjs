#!/usr/bin/env node
/**
 * The console, driven with a browser.
 *
 *     npm run check:screen
 *     npm run check:screen -- --show          with a visible browser
 *     npm run check:screen -- --against URL   against something already running
 *
 * The layer the others cannot reach. `npm test` says the rules are right and
 * `npm run measure` says the three claims hold — only this says that somebody
 * can sit in front of the thing, press the dangerous button, and see what it
 * did. Which for this project is the whole argument: the point is not that the
 * job is careful, it is that you can watch it be careless on purpose and count
 * what that costs.
 *
 * It starts its own service on a port nothing else uses, so it can never go
 * green having driven a stranger's process.
 */

import { aBrowser } from './a-browser.mjs';
import { startTheService } from './with-the-service.mjs';

const show = process.argv.includes('--show');

let checks = 0;
let bad = 0;

function is(what, got, wanted, detail) {
  checks += 1;

  if (got === wanted) return console.log(`    ok    ${what}`);

  bad += 1;
  console.log(`    NO    ${what}\n            wanted ${JSON.stringify(wanted)}, got ${JSON.stringify(detail ?? got)}`);
}

function has(what, got, wanted) {
  checks += 1;

  if (String(got ?? '').toLowerCase().includes(String(wanted).toLowerCase())) {
    return console.log(`    ok    ${what}`);
  }

  bad += 1;
  console.log(`    NO    ${what}\n            wanted something containing ${JSON.stringify(wanted)}, got ${JSON.stringify(got)}`);
}

const say = (what) => console.log(`\n  ${what}`);

const service = await startTheService();
const { browser, channel } = await aBrowser({ headless: !show });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 }, reducedMotion: 'reduce' });

// Anything the page throws fails this even if every assertion passes: a screen
// that works while quietly throwing is one that stops working on the next
// browser.
const thrown = [];
page.on('pageerror', (error) => thrown.push(`threw: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') thrown.push(message.text());
});

const figure = async (which) => Number((await page.locator(which).textContent()).trim());

/**
 * Press something and wait for the page to have drawn the answer.
 *
 * The page counts its own draws. Waiting for the table to be non-empty would be
 * waiting for something that is already non-empty from the run before: it
 * returns instantly, and every check after it reads the page too early — which
 * fails on a fast machine and passes on a slow one, or the other way round.
 */
async function press(which) {
  const before = await page.getAttribute('body', 'data-drawn');

  await page.locator(which).click();

  await page.waitForFunction((was) => document.body.dataset.drawn !== was, before, { timeout: 20_000 });
}

try {
  console.log(`\n  driving ${service.base} through the screen, in ${channel}`);

  await page.goto(`${service.base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.ready === 'yes', null, { timeout: 30_000 });

  // ── the page is the page ──────────────────────────────────────────────────
  say('the page');

  has('the title names the project', await page.title(), 'PACS Maintenance Tasker');
  is('the mark is drawn', await page.locator('svg[data-mark]').count(), 1);
  has('and it says there is no undo', await page.locator('.thesis').textContent(), 'no undo');

  const studiesAtStart = await figure('[data-studies]');
  const foldersAtStart = await figure('[data-folders]');

  is('the archive is there', studiesAtStart, 409);
  is('and so are its folders', foldersAtStart, 400);
  is('nothing is orphaned yet', await figure('[data-orphans]'), 0);

  // ── a dry run changes nothing ─────────────────────────────────────────────
  say('a dry run');

  await press('[data-dry]');

  has('it says it changed nothing', await page.locator('[data-ran]').textContent(), 'nothing was changed');
  is('the catalogue is untouched', await figure('[data-studies]'), studiesAtStart);
  is('and so is the disk', await figure('[data-folders]'), foldersAtStart);

  const chose = await page.locator('.tally.went .count').textContent();
  is('it chose the studies the measurement says it chooses', Number(chose.trim()), 255);

  is('every study it considered is listed with a reason', await page.locator('[data-decisions] tbody tr').count() > 0, true);
  is('and the refusals are broken down', await page.locator('.tally').count() > 1, true);

  // ── the reasons are filterable, and the dangerous one is there ────────────
  say('the reason this project exists');

  const silence = page.locator('[data-filters] button[data-filter="RECORDS_SAY_NOTHING"]');

  is('there is a filter for "the records said nothing"', await silence.count(), 1);
  has('and it carries the count', await silence.textContent(), '17');

  await silence.click();
  await page.waitForTimeout(200);

  const rows = await page.locator('[data-decisions] tbody tr').count();
  is('filtering shows those studies', rows, 17);

  const first = await page.locator('[data-decisions] tbody tr').first().textContent();
  has('and each is marked to keep', first, 'keep');
  has('with the reason in words', first, 'nothing about this study');

  // ── a real run does exactly what the dry run said ─────────────────────────
  say('the real run');

  await press('[data-real]');

  has('it says it was real', await page.locator('[data-ran]').textContent(), 'a real run');
  is('the catalogue lost exactly what was chosen', await figure('[data-studies]'), studiesAtStart - 255);
  is('the files were moved aside rather than deleted', await figure('[data-binned]'), 246);
  is('and nothing was orphaned', await figure('[data-orphans]'), 0);

  // ── the two mistakes, on purpose ──────────────────────────────────────────
  say('making the mistakes on purpose');

  await press('[data-reset]');
  is('the archive comes back', await figure('[data-studies]'), studiesAtStart);

  // The safe order, with the disk failing: nothing is lost.
  await page.locator('[data-disk]').check();
  await page.locator('[data-permanent]').check();
  await press('[data-real]');

  has('the disk refused some studies', await page.locator('[data-ran]').textContent(), 'did not finish');
  has('and the page says the next run picks them up', await page.locator('[data-ran]').textContent(), 'next run');
  is('the safe order orphans nothing', await figure('[data-orphans]'), 0);

  // The other order, same failures.
  await press('[data-reset]');
  await page.locator('[data-order]').check();
  await press('[data-real]');

  const orphans = await figure('[data-orphans]');

  is('the other order leaves folders nothing can find', orphans, 25);
  has('and the page says the catalogue has forgotten them', await page.locator('[data-ran]').textContent(), 'already forgotten');
  is('and lists them', await page.locator('.orphan-list li').count() > 0, true);
  has('with what that means', await page.locator('.orphan-list p').textContent(), 'nothing will look for them again');

  // ── the claims are on the page ────────────────────────────────────────────
  say('the three claims, on the page rather than only in a terminal');

  is('all three are shown', await page.locator('.claim-card').count(), 3);
  is('and all three hold', await page.locator('.claim-card .holds:not(.no)').count(), 3);
  has('the header agrees', await page.locator('[data-claim-figure]').textContent(), '3 of 3');

  const claimText = await page.locator('.claims').textContent();

  has('the one about the dry run', claimText, 'dry run and a real run choose the same studies');
  has('the one about silence', claimText, 'record system said nothing');
  has('the one about the order', claimText, 'next run can finish it');

  // ── nothing was thrown ────────────────────────────────────────────────────
  say('and the page was quiet while doing all that');

  is('nothing was thrown or logged as an error', thrown.length, 0, thrown);
} finally {
  await browser.close();
  await service.stop();
}

console.log(`\n  ${checks} checks, ${bad} of them failed\n`);
process.exit(bad ? 1 : 0);
