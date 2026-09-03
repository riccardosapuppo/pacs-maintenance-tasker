#!/usr/bin/env node
/**
 * `npm run measure` — the three claims, checked.
 *
 * Exits non-zero if any of them is false. That is the point of writing them as
 * claims rather than as prose: this project's README says three things about an
 * operation nobody can undo, and all three can fail here and in CI.
 *
 * Each claim prints itself. The first version looped over the three and chose
 * what to print by index — `if (at === 0)` — which is how you write this when
 * every result is the same shapeless object. They are not: each claim has its
 * own result type, and three small printers say so in the code rather than in a
 * comment.
 */

import { everyClaim } from '../src/measure/claims.ts';
import type { Claim, DryRunResult, OrderResult, SilenceResult } from '../src/measure/claims.ts';
import { FILES_FIRST, POINTER_FIRST } from '../src/decide/run.ts';

const pad = (text: unknown, width: number): string =>
  String(text) + ' '.repeat(Math.max(0, width - String(text).length));

const num = (n: unknown, width = 5): string =>
  ' '.repeat(Math.max(0, width - String(n).length)) + String(n);

const RULE = `  ${'─'.repeat(74)}`;

function heading(at: number, claim: Claim<{ holds: boolean }>): void {
  console.log(`  ${at}. [${claim.result.holds ? 'holds ' : ' FAILS'}]  ${claim.says}`);
  console.log('');
  console.log(`        ${claim.matters}`);
  console.log('');
}

function done(): void {
  console.log('');
  console.log(RULE);
  console.log('');
}

const claims = everyClaim();
const [dryRun, silence, ordering] = claims;

console.log('');

// ── 1 ───────────────────────────────────────────────────────────────────────
heading(1, dryRun);
{
  const r: DryRunResult = dryRun.result;

  console.log(`        the dry run chose            ${num(r.chose)} studies`);
  console.log(`        the real run deleted         ${num(r.deleted)} studies`);
  console.log(`        the same studies, in order   ${r.holds ? 'yes' : 'NO'}`);
  console.log('');
  console.log('        written as its own branch,');
  console.log(`        the dry run would have said  ${num(r.theOtherWayWouldHaveSaid)} studies`);
  console.log(
    `        so it would not have mentioned ${r.quietlyMissing} of the ${r.chose} it was about to delete.`
  );
}
done();

// ── 2 ───────────────────────────────────────────────────────────────────────
heading(2, silence);
{
  const r: SilenceResult = silence.result;

  console.log(`        studies past the window      ${num(r.considered)}`);
  console.log(`        the records said nothing     ${num(r.refusedForSilence)}  refused`);
  console.log(`        no accession to look up      ${num(r.refusedForNoAccession)}  refused`);
  console.log('');
  console.log(`        with "nothing means yes",    ${num(r.wouldHaveGone)}  would have been deleted:`);
  console.log('');

  for (const one of r.examples) {
    console.log(
      `            ${pad(one.accession ?? '(no accession)', 16)} ${pad(one.patientName, 18)} ${one.studyDate}`
    );
  }

  console.log(`            ... and ${r.wouldHaveGone - r.examples.length} more`);
  console.log('');
  console.log('        None of those would have looked like an error anywhere.');
}
done();

// ── 3 ───────────────────────────────────────────────────────────────────────
heading(3, ordering);
{
  const r: OrderResult = ordering.result;

  console.log('        the disk refuses one study in ten, and the job is run twice');
  console.log('');
  console.log(`        ${pad('', 28)} ${pad('orphaned folders', 18)} catalogue rows   folders`);

  for (const [label, one] of [
    ['files first (this job)', r.filesFirst],
    ['the catalogue first', r.pointerFirst],
  ] as const) {
    console.log(
      `        ${pad(label, 28)} ${pad(num(one.orphans), 18)} ${num(one.rowsLeft, 12)}   ${num(one.foldersLeft, 7)}`
    );
  }

  console.log('');
  console.log(
    `        Same failures, same frequency. One order leaves ${r.costOfTheOtherOrder} folders that nothing`
  );
  console.log('        will ever look for again, and no error anywhere saying so.');

  // Named rather than implied: the two orders are strings, and printing them
  // is cheaper than making the reader trust the labels above.
  console.log('');
  console.log(`        (${FILES_FIRST} / ${POINTER_FIRST})`);
}
done();

const failed = claims.filter((one) => !one.result.holds);

if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed. They are what this project says it does.`);
  console.log('');
  process.exit(1);
}

console.log(`  All ${claims.length} claims hold.`);
console.log('');
