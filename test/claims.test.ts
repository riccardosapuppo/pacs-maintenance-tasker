/**
 * The three claims, and the honesty of the three claims.
 *
 * The first thing asserted is that they hold. The second, and the one that
 * matters more, is that they are capable of not holding — a claim whose
 * comparison is rigged, or whose corpus contains no instance of the case it is
 * about, passes for ever and means nothing.
 *
 * So: the corpus is checked for actually containing each awkward case, the two
 * rules are checked for differing only where they are supposed to, and the
 * numbers the README quotes are pinned here. If somebody changes the corpus,
 * this file goes red and the README gets updated — which is the arrangement
 * that stops a README slowly becoming fiction.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { corpus, closeCorpus, WHEN, HOW_MANY, TODAY } from '../src/measure/corpus.ts';
import { look, FILES_FIRST, POINTER_FIRST } from '../src/decide/run.ts';
import type { WhyCode } from '../src/decide/rules.ts';
import type { World } from '../src/measure/corpus.ts';
import { everyClaim } from '../src/measure/claims.ts';

/** Computed once: each claim builds several archives on disk. */
const claims = everyClaim();

// Destructured off the tuple rather than through `.map`, which would flatten
// three different result shapes into one union and make every field an error.
const [dryClaim, silenceClaim, orderClaim] = claims;
const dry = dryClaim.result;
const silence = silenceClaim.result;
const order = orderClaim.result;

test('all three claims hold', () => {
  const broken = claims.filter((one) => !one.result.holds).map((one) => one.says);
  assert.deepEqual(broken, []);
});

test('each claim says what it is and why it matters', () => {
  for (const one of claims) {
    assert.ok(one.says.endsWith('.'), one.says);
    assert.ok(one.matters.length > 120, `${one.says} explains itself`);
  }
});

test('the corpus really contains every awkward case', () => {
  // A claim about studies the record system says nothing about, measured on a
  // corpus with none in it, is a claim that passes by finding nothing. Each of
  // these is asserted to be present and non-zero.
  const world = corpus();
  const decisions = look(world.archive, world.recordSystem, WHEN);

  const seen: Partial<Record<WhyCode, number>> = {};
  for (const one of decisions) seen[one.code] = (seen[one.code] ?? 0) + 1;

  for (const code of [
    'RECORDS_SAY_NOTHING',
    'NO_ACCESSION',
    'NOT_REPORTED',
    'REPORT_SENTINEL',
    'REPORT_TOO_RECENT',
    'REPORTED_AND_OLD',
    'BOOKING_WITHDRAWN',
    'EVERY_LINE_WITHDRAWN',
  ] as const satisfies readonly WhyCode[]) {
    assert.ok((seen[code] ?? 0) > 0, `the corpus has no ${code} in it`);
  }

  closeCorpus(world);
});

test('the corpus is the same corpus on every machine and every run', () => {
  // No clock and no randomness: `TODAY` is a constant and every date derives
  // from it. Two builds are compared study for study, because a corpus that
  // drifts makes every number in the README a number about a different archive.
  const one = corpus();
  const two = corpus();

  const rows = (world: World) => world.archive.olderThan(WHEN.keepForDays, WHEN.today);

  assert.deepEqual(rows(one), rows(two));
  assert.equal(one.archive.howMany(), HOW_MANY);
  assert.equal(TODAY, '2026-09-03');

  closeCorpus(one);
  closeCorpus(two);
});

test('the corpus is built without reading the clock', () => {
  // `new Date()` with no argument, or Date.now(), would make the measurement
  // give a different answer tomorrow — and the day it crossed a boundary,
  // somebody would be debugging the archive instead of the fixture.
  const source = readFileSync(new URL('../src/measure/corpus.ts', import.meta.url), 'utf8');
  const code = source
    .split('\n')
    .map((one) => one.trim())
    .filter((one) => !one.startsWith('*') && !one.startsWith('/*') && !one.startsWith('//'));

  for (const forbidden of ['Date.now(', 'new Date()', 'Math.random(']) {
    assert.ok(!code.some((one) => one.includes(forbidden)), `corpus.js must not use ${forbidden}`);
  }
});

test('claim 1: the two runs agree, and the other way round would not have', () => {
  assert.equal(dry.chose, dry.deleted);
  assert.equal(dry.chose, 255, 'the number the README quotes');

  // The whole point of the claim: the second way of writing it is worse, by a
  // specific number of studies.
  assert.equal(dry.theOtherWayWouldHaveSaid, 246);
  assert.equal(dry.quietlyMissing, 9);
  assert.ok(dry.quietlyMissing > 0, 'if this is zero the claim demonstrates nothing');
});

test('claim 2: silence is refused, and the old rule would have taken 23 studies', () => {
  assert.equal(silence.refusedForSilence, 17);
  assert.equal(silence.refusedForNoAccession, 6);
  assert.equal(silence.wouldHaveGone, 23);

  assert.ok(silence.examples.length > 0, 'and it can name some of them');
  for (const one of silence.examples) assert.ok(one.patientName && one.studyDate);
});

test('claim 3: one order leaves nothing behind and the other leaves 25 folders', () => {
  assert.equal(order.filesFirst.orphans, 0);
  assert.equal(order.pointerFirst.orphans, 25);

  // Same failures, both times. If the two runs met different numbers of
  // failures then the comparison is between two different experiments.
  assert.equal(order.filesFirst.troubleFirstTime, order.pointerFirst.troubleFirstTime);
  assert.equal(order.filesFirst.troubleSecondTime, 0, 'the safe order finishes on the second run');

  // And the catalogue ends up in the same state either way, which is what makes
  // the difference invisible to anybody looking at the database.
  assert.equal(order.filesFirst.rowsLeft, order.pointerFirst.rowsLeft);
  assert.ok(order.pointerFirst.foldersLeft > order.filesFirst.foldersLeft);
});

test('the two orders are named in words, not as booleans', () => {
  // A parameter that reads `pointerFirst: true` at the call site is a parameter
  // whose meaning has to be remembered. These print themselves in the report.
  assert.match(FILES_FIRST, /files first/);
  assert.match(POINTER_FIRST, /catalogue first/);
});
