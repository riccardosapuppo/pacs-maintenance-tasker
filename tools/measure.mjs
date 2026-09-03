#!/usr/bin/env node
/**
 * `npm run measure` — the three claims, checked.
 *
 * Exits non-zero if any of them is false. That is the point of writing them as
 * claims rather than as prose: this project's README says three things about an
 * operation nobody can undo, and all three can fail here and in CI.
 */

import { everyClaim } from '../src/measure/claims.js';
import { FILES_FIRST, POINTER_FIRST } from '../src/decide/run.js';

const claims = everyClaim();

const pad = (text, width) => String(text) + ' '.repeat(Math.max(0, width - String(text).length));
const num = (n, width = 5) => ' '.repeat(Math.max(0, width - String(n).length)) + String(n);

console.log('');

for (const [at, claim] of claims.entries()) {
  const mark = claim.result.holds ? 'holds ' : ' FAILS';

  console.log(`  ${at + 1}. [${mark}]  ${claim.says}`);
  console.log('');
  console.log(`        ${claim.matters}`);
  console.log('');

  const r = claim.result;

  if (at === 0) {
    console.log(`        the dry run chose            ${num(r.chose)} studies`);
    console.log(`        the real run deleted         ${num(r.deleted)} studies`);
    console.log(`        the same studies, in order   ${r.holds ? 'yes' : 'NO'}`);
    console.log('');
    console.log(`        written as its own branch,`);
    console.log(`        the dry run would have said  ${num(r.theOtherWayWouldHaveSaid)} studies`);
    console.log(
      `        so it would not have mentioned ${r.quietlyMissing} of the ${r.chose} it was about to delete.`
    );
  }

  if (at === 1) {
    console.log(`        studies past the window      ${num(r.considered)}`);
    console.log(`        the records said nothing     ${num(r.refusedForSilence)}  refused`);
    console.log(`        no accession to look up      ${num(r.refusedForNoAccession)}  refused`);
    console.log('');
    console.log(`        with "nothing means yes",    ${num(r.wouldHaveGone)}  would have been deleted:`);
    console.log('');

    for (const one of r.examples) {
      console.log(`            ${pad(one.accession ?? '(no accession)', 16)} ${pad(one.patientName, 18)} ${one.studyDate}`);
    }

    console.log(`            ... and ${r.wouldHaveGone - r.examples.length} more`);
    console.log('');
    console.log('        None of those would have looked like an error anywhere.');
  }

  if (at === 2) {
    console.log(`        the disk refuses one study in ten, and the job is run twice`);
    console.log('');
    console.log(`        ${pad('', 28)} ${pad('orphaned folders', 18)} catalogue rows   folders`);

    for (const [order, label] of [
      [FILES_FIRST, 'files first (this job)'],
      [POINTER_FIRST, 'the catalogue first'],
    ]) {
      const one = order === FILES_FIRST ? r.filesFirst : r.pointerFirst;
      console.log(
        `        ${pad(label, 28)} ${pad(num(one.orphans), 18)} ${num(one.rowsLeft, 12)}   ${num(one.foldersLeft, 7)}`
      );
    }

    console.log('');
    console.log(
      `        Same failures, same frequency. One order leaves ${r.costOfTheOtherOrder} folders that nothing`
    );
    console.log('        will ever look for again, and no error anywhere saying so.');
  }

  console.log('');
  console.log(`  ${'─'.repeat(74)}`);
  console.log('');
}

const failed = claims.filter((one) => !one.result.holds);

if (failed.length) {
  console.log(`  ${failed.length} of ${claims.length} claims failed. They are what this project says it does.`);
  console.log('');
  process.exit(1);
}

console.log(`  All ${claims.length} claims hold.`);
console.log('');
