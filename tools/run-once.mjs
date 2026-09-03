#!/usr/bin/env node
/**
 * One run of the job, against the invented archive, printed.
 *
 *     npm run run:dry           decide, and change nothing
 *     npm run run:for-real      decide, and do it
 *     npm run run:for-real -- --permanent    without the recycle bin
 *
 * The two commands are the same command. `--for-real` is the only difference
 * and it reaches exactly one line of `runOnce`, which is the arrangement the
 * whole project is arguing for — so being able to run both and compare the
 * output is the argument, made where somebody can check it.
 *
 * It says which mode it is in at the top AND at the bottom. A report that says
 * so only at the top is a report somebody scrolls past.
 */

import { corpus, closeCorpus, WHEN } from '../src/measure/corpus.js';
import { runOnce, POINTER_FIRST, FILES_FIRST } from '../src/decide/run.js';
import { WHY } from '../src/decide/rules.js';

const forReal = process.argv.includes('--for-real');
const toBin = !process.argv.includes('--permanent');
const order = process.argv.includes('--catalogue-first') ? POINTER_FIRST : FILES_FIRST;

const pad = (text, width) => String(text) + ' '.repeat(Math.max(0, width - String(text).length));
const num = (n, width = 5) => ' '.repeat(Math.max(0, width - String(n).length)) + String(n);

const world = corpus({ onDisk: true });

console.log('');
console.log(`  ${forReal ? 'A REAL RUN — this deletes things' : 'A dry run — nothing will be changed'}`);
console.log('');
console.log(`      archive          ${world.archive.howMany()} studies, ${world.store.onDisk().length} folders on disk`);
console.log(`      today            ${WHEN.today}`);
console.log(`      keep for         ${WHEN.keepForDays} days`);
console.log(`      report settles   ${WHEN.reportSettlesAfterDays} days after it is signed`);

if (forReal) {
  console.log(`      files            ${toBin ? 'moved to the recycle bin' : 'DELETED PERMANENTLY'}`);
  console.log(`      order            ${order}`);
}

console.log('');

const report = runOnce(world, WHEN, { forReal, toBin, order });

console.log(`      considered       ${num(report.considered)}  studies past the retention window`);
console.log(`      chosen           ${num(report.chose)}`);
console.log(`      refused          ${num(report.refusedCount)}`);
console.log('');

for (const [code, n] of Object.entries(report.refusedBecause).sort((a, b) => b[1] - a[1])) {
  console.log(`        ${num(n)}  ${WHY[code] ?? code}`);
}

console.log('');

if (!forReal) {
  console.log(`      Nothing was changed. ${report.chose} studies would be deleted.`);
  console.log(`      The real run chooses these same ${report.chose}: npm run run:for-real`);
} else {
  const binned = report.did.filter((one) => one.files === 'binned').length;
  const gone = report.did.filter((one) => one.files === 'gone').length;
  const missing = report.did.filter((one) => one.files === 'was not there').length;

  console.log(`      files moved aside      ${num(binned)}`);
  console.log(`      files deleted          ${num(gone)}`);
  console.log(`      files already missing  ${num(missing)}`);
  console.log(`      catalogue rows gone    ${num(report.did.filter((one) => one.catalogue === 'forgotten').length)}`);
  console.log('');

  if (report.trouble.length) {
    console.log(`      ${report.trouble.length} studies did not finish:`);
    for (const one of report.trouble.slice(0, 5)) console.log(`        ${one.studyUid}  ${one.trouble}`);
    console.log('');
    console.log(`      The catalogue still points at them, so the next run picks them up.`);
    console.log('');
  }

  console.log(`      archive now      ${world.archive.howMany()} studies, ${world.store.onDisk().length} folders`);
  console.log('');
  console.log(`      That was a REAL run. The archive was invented and is now gone from`);
  console.log(`      a temporary folder; nothing outside this repository was touched.`);
}

console.log('');

closeCorpus(world);
