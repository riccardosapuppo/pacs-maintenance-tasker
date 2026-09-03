/**
 * The decision, one case at a time.
 *
 * Every one of these is a study somebody would have to answer for. They are
 * written as sentences rather than as a table, because a table of thirty rows
 * goes green again the moment somebody edits the expected column, and the whole
 * value of this file is that a person who disagrees with one of the rules can
 * find the rule and argue with it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decide, decideAsItWas, daysBetween, NOT_YET, WHY } from '../src/decide/rules.ts';
import type { DecidableStudy, RecordLine, WhatTheRecordsSaid } from '../src/decide/rules.ts';

const WHEN = { today: '2026-09-03', keepForDays: 40, reportSettlesAfterDays: 40 };

const study = (over: Partial<DecidableStudy> = {}): DecidableStudy => ({
  accession: 'ACC1',
  studyDate: '2025-01-01',
  ...over,
});

const said = (rows: RecordLine[]): WhatTheRecordsSaid => ({ asked: true, rows });

const line = (over: Partial<RecordLine> = {}): RecordLine => ({
  bookingWithdrawn: false,
  lineWithdrawn: false,
  examination: 'CT ABDOMEN',
  reportedOn: '2025-01-02',
  ...over,
});

test('days are whole days, and the direction is from the past to today', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-03'), 2);
  assert.equal(daysBetween('2026-09-03', '2026-09-03'), 0);
});

test('a study inside the retention window is refused whatever its paperwork says', () => {
  const verdict = decide(study({ studyDate: '2026-08-20' }), said([line()]), WHEN);

  assert.equal(verdict.mayGo, false);
  assert.equal(verdict.code, 'TOO_YOUNG');
});

test('the window is checked before the records are asked at all', () => {
  // Not an optimisation. A study inside the window cannot be deleted whatever
  // the record system says, so asking is a question whose answer changes
  // nothing — and every question across that boundary can fail.
  const verdict = decide(study({ studyDate: '2026-08-20' }), { asked: false, why: 'no answer' }, WHEN);

  assert.equal(verdict.code, 'TOO_YOUNG', 'not RECORDS_UNREACHABLE');
});

test('reported long enough ago, and old enough, may go', () => {
  const verdict = decide(study(), said([line({ reportedOn: '2025-01-02' })]), WHEN);

  assert.equal(verdict.mayGo, true);
  assert.equal(verdict.code, 'REPORTED_AND_OLD');
});

test('a withdrawn booking may go, reported or not', () => {
  const verdict = decide(study(), said([line({ bookingWithdrawn: true, reportedOn: null })]), WHEN);

  assert.equal(verdict.mayGo, true);
  assert.equal(verdict.code, 'BOOKING_WITHDRAWN');
});

test('every line withdrawn may go; some lines withdrawn may not', () => {
  const all = decide(
    study(),
    said([line({ lineWithdrawn: true, reportedOn: null }), line({ lineWithdrawn: true, reportedOn: null })]),
    WHEN
  );

  assert.equal(all.code, 'EVERY_LINE_WITHDRAWN');

  const some = decide(
    study(),
    said([line({ lineWithdrawn: true, reportedOn: null }), line({ reportedOn: null })]),
    WHEN
  );

  assert.equal(some.mayGo, false, 'one line is still live');
  assert.equal(some.code, 'NOT_REPORTED');
});

test('a booking with two lines and one report is not finished', () => {
  // The case that catches "some" written where "every" was meant. A booking for
  // an abdomen and a chest, with the abdomen reported, is somebody's afternoon.
  const verdict = decide(study(), said([line({ reportedOn: '2025-01-02' }), line({ reportedOn: null })]), WHEN);

  assert.equal(verdict.mayGo, false);
  assert.equal(verdict.code, 'NOT_REPORTED');
});

test('the placeholder date is not a date, and is not "very old"', () => {
  // 1900-01-01 sorts older than everything, so any "reported more than 40 days
  // ago" comparison says yes to it — for exactly the rows nobody has reported.
  const verdict = decide(study(), said([line({ reportedOn: NOT_YET })]), WHEN);

  assert.equal(verdict.mayGo, false);
  assert.equal(verdict.code, 'REPORT_SENTINEL');
  assert.ok(daysBetween(NOT_YET, WHEN.today) > WHEN.reportSettlesAfterDays, 'and it would have passed the age test');
});

test('an old study with a fresh report waits for the report to settle', () => {
  const verdict = decide(study(), said([line({ reportedOn: '2026-09-01' })]), WHEN);

  assert.equal(verdict.mayGo, false);
  assert.equal(verdict.code, 'REPORT_TOO_RECENT');
});

test('a study with no accession number cannot be established, so it stays', () => {
  for (const nothing of [null, '', '   ']) {
    const verdict = decide(study({ accession: nothing }), said([]), WHEN);

    assert.equal(verdict.mayGo, false, JSON.stringify(nothing));
    assert.equal(verdict.code, 'NO_ACCESSION');
  }
});

test('a record system that could not be asked is not a record system that agreed', () => {
  const verdict = decide(study(), { asked: false, why: 'no answer' }, WHEN);

  assert.equal(verdict.mayGo, false);
  assert.equal(verdict.code, 'RECORDS_UNREACHABLE');
});

test('SILENCE IS NOT PERMISSION: no rows means no, and says so', () => {
  // The line this whole project is about. The version this was rebuilt from
  // returned "delete it" here, not by decision but because the loop over the
  // rows found nothing to loop over and execution reached the last line.
  // The last two are shapes the type says cannot happen, cast on purpose.
  //
  // `said` comes from a database driver at a boundary the compiler does not
  // reach, and the rule guards against a missing `rows` because a driver that
  // returns `undefined` where it promised an array is a Tuesday. The cast is
  // the test saying "this arrives from outside", not the test working around
  // the type.
  const shapes = [said([]), { asked: true }, { asked: true, rows: null }] as unknown as WhatTheRecordsSaid[];

  for (const nothing of shapes) {
    const verdict = decide(study(), nothing, WHEN);

    assert.equal(verdict.mayGo, false, JSON.stringify(nothing));
    assert.equal(verdict.code, 'RECORDS_SAY_NOTHING');
  }
});

test('and the rule as it was does the opposite, which is why it is kept', () => {
  const asItWas = decideAsItWas(study(), said([]), WHEN);

  assert.equal(asItWas.mayGo, true, 'this is the bug, preserved so it can be counted');

  // The two must agree everywhere else, or the measurement is comparing two
  // unrelated rules and the difference it reports is not the difference it says.
  for (const rows of [
    [line()],
    [line({ reportedOn: null })],
    [line({ reportedOn: NOT_YET })],
    [line({ bookingWithdrawn: true })],
    [line({ reportedOn: '2026-09-01' })],
  ]) {
    const now = decide(study(), said(rows), WHEN);
    const before = decideAsItWas(study(), said(rows), WHEN);

    assert.equal(now.mayGo, before.mayGo, JSON.stringify(rows));
    assert.equal(now.code, before.code);
  }
});

test('an unreachable record system is refused by both rules', () => {
  // The safe default that the original DID have. Worth a test of its own,
  // because the point of this project is that it had this one and not the other
  // — the loud failure was guarded and the quiet one was not.
  assert.equal(decideAsItWas(study(), { asked: false, why: 'no answer' }, WHEN).mayGo, false);
  assert.equal(decide(study(), { asked: false, why: 'no answer' }, WHEN).mayGo, false);
});

test('every reason has words, and every answer carries one', () => {
  for (const [code, words] of Object.entries(WHY)) {
    assert.ok(words.length > 10, `${code} says something`);
  }

  const verdict = decide(study(), said([line()]), WHEN);
  assert.equal(verdict.why, WHY[verdict.code]);
});
