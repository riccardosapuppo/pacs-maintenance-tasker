/**
 * A run, against real files in a real scratch directory.
 *
 * Everything here deletes something. That is deliberate: the subject of this
 * project is an operation nobody can undo, and a suite that removes keys from a
 * `Map` has not exercised the thing anybody is frightened of. Each test builds
 * its own archive under the system temporary folder and takes it away again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { catalogue } from '../src/archive/catalogue.js';
import { records } from '../src/records/system.js';
import { files } from '../src/files/store.js';
import { look, carryOut, runOnce, FILES_FIRST, POINTER_FIRST } from '../src/decide/run.js';

const WHEN = { today: '2026-09-03', keepForDays: 40, reportSettlesAfterDays: 40 };

/** A small archive: `plan` is a list of [accession|null, studyDate, reportedOn|null]. */
function world(plan) {
  const archive = catalogue();
  const recordSystem = records();
  const store = files();

  const fsId = archive.addFilesystem(store.home);
  const storage = archive.addStorage(fsId, 'p1');

  plan.forEach(([accession, studyDate, reportedOn, extra = {}], at) => {
    const studyUid = `1.2.3.${at + 1}`;

    archive.add({
      studyUid,
      accession,
      patientId: `PT${at}`,
      patientName: `PATIENT^${at}`,
      studyDate,
      description: 'CT ABDOMEN',
      storageId: storage,
    });

    if (extra.noFiles !== true) store.put(`p1/${studyUid}`);

    if (accession && extra.noBooking !== true) {
      const bookingId = recordSystem.addBooking({
        code: accession,
        patientId: `PT${at}`,
        bookedFor: studyDate,
        withdrawn: extra.withdrawn === true,
      });

      recordSystem.addLine({ bookingId, examination: 'CT ABDOMEN', reportedOn });
    }
  });

  return {
    archive,
    recordSystem,
    store,
    done() {
      archive.close();
      recordSystem.close();
      store.clear();
    },
  };
}

const OLD = '2025-01-01';
const REPORTED = '2025-01-02';

test('a dry run changes nothing at all', () => {
  const w = world([['ACC1', OLD, REPORTED], ['ACC2', OLD, REPORTED]]);

  const before = { rows: w.archive.howMany(), folders: w.store.onDisk().length };
  const report = runOnce(w, WHEN);

  assert.equal(report.chose, 2, 'it chose them');
  assert.equal(w.archive.howMany(), before.rows, 'and left the catalogue alone');
  assert.equal(w.store.onDisk().length, before.folders, 'and the disk');
  assert.deepEqual(report.did, [], 'and did nothing');

  w.done();
});

test('the dry run and the real run choose exactly the same studies', () => {
  const plan = [
    ['ACC1', OLD, REPORTED],
    ['ACC2', '2026-08-30', REPORTED],
    ['ACC3', OLD, null],
    [null, OLD, null],
    ['ACC5', OLD, REPORTED, { noBooking: true }],
    ['ACC6', OLD, REPORTED, { noFiles: true }],
  ];

  const looking = world(plan);
  const doing = world(plan);

  const dry = runOnce(looking, WHEN);
  const real = runOnce(doing, WHEN, { forReal: true, toBin: false });

  assert.deepEqual(dry.chosenUids, real.chosenUids);

  // Including the one whose files are already gone. A dry run that quietly
  // skipped it would be a dry run that under-reported what the real run does to
  // the catalogue.
  assert.ok(dry.chosenUids.includes('1.2.3.6'), 'the study with no files is chosen too');

  looking.done();
  doing.done();
});

test('a real run removes both the files and the row', () => {
  const w = world([['ACC1', OLD, REPORTED]]);

  const report = runOnce(w, WHEN, { forReal: true, toBin: false });

  assert.equal(report.did.length, 1);
  assert.equal(report.did[0].files, 'gone');
  assert.equal(report.did[0].catalogue, 'forgotten');
  assert.equal(w.archive.howMany(), 0);
  assert.deepEqual(w.store.onDisk(), []);

  w.done();
});

test('the recycle bin is the default, and it keeps the files', () => {
  const w = world([['ACC1', OLD, REPORTED]]);

  const report = runOnce(w, WHEN, { forReal: true });

  assert.equal(report.did[0].files, 'binned');
  assert.deepEqual(w.store.onDisk(), [], 'gone from where the archive looks');
  assert.ok(fs.readdirSync(w.store.bin).length > 0, 'and still on the disk, aside');

  w.done();
});

test('a study whose files were already gone still loses its catalogue row', () => {
  const w = world([['ACC1', OLD, REPORTED, { noFiles: true }]]);

  const report = runOnce(w, WHEN, { forReal: true, toBin: false });

  assert.equal(report.did[0].files, 'was not there');
  assert.equal(report.did[0].catalogue, 'forgotten');
  assert.equal(report.did[0].trouble, null, 'and it is not an error');

  w.done();
});

test('a study nothing may delete is left in both places', () => {
  const w = world([['ACC1', OLD, null]]);

  runOnce(w, WHEN, { forReal: true, toBin: false });

  assert.equal(w.archive.howMany(), 1);
  assert.equal(w.store.onDisk().length, 1);

  w.done();
});

test('when the disk refuses, files-first leaves the study whole', () => {
  const w = world([['ACC1', OLD, REPORTED]]);
  w.store.failWhen(() => true);

  const report = runOnce(w, WHEN, { forReal: true, order: FILES_FIRST, toBin: false });

  assert.equal(report.trouble.length, 1);
  assert.equal(w.archive.howMany(), 1, 'the row is still there');
  assert.equal(w.store.onDisk().length, 1, 'and so are the files');

  // Which means the next run finishes it.
  w.store.failWhen(null);
  runOnce(w, WHEN, { forReal: true, order: FILES_FIRST, toBin: false });

  assert.equal(w.archive.howMany(), 0);
  assert.equal(w.store.onDisk().length, 0);

  w.done();
});

test('when the disk refuses, catalogue-first leaves files nothing can find', () => {
  const w = world([['ACC1', OLD, REPORTED]]);
  w.store.failWhen(() => true);

  const report = runOnce(w, WHEN, { forReal: true, order: POINTER_FIRST, toBin: false });

  assert.equal(report.trouble.length, 1);
  assert.equal(w.archive.howMany(), 0, 'the row is gone');
  assert.equal(w.store.onDisk().length, 1, 'and the files are not');

  // And the next run cannot help, because every run starts from the catalogue
  // and the catalogue no longer mentions it.
  w.store.failWhen(null);
  const second = runOnce(w, WHEN, { forReal: true, order: POINTER_FIRST, toBin: false });

  assert.equal(second.considered, 0, 'there is nothing left to consider');
  assert.equal(w.store.onDisk().length, 1, 'so the folder stays for ever');

  w.done();
});

test('one study that fails does not stop the others', () => {
  const w = world([['ACC1', OLD, REPORTED], ['ACC2', OLD, REPORTED], ['ACC3', OLD, REPORTED]]);
  w.store.failWhen((where) => where.includes('1.2.3.2'));

  const report = runOnce(w, WHEN, { forReal: true, toBin: false });

  assert.equal(report.trouble.length, 1);
  assert.equal(w.archive.howMany(), 1, 'the other two went');

  w.done();
});

test('a record system that stops answering halfway stops the deleting', () => {
  const w = world([['ACC1', OLD, REPORTED], ['ACC2', OLD, REPORTED]]);
  w.recordSystem.stopAnswering();

  const report = runOnce(w, WHEN, { forReal: true, toBin: false });

  assert.equal(report.chose, 0);
  assert.equal(report.refusedBecause.RECORDS_UNREACHABLE, 2);
  assert.equal(w.archive.howMany(), 2, 'nothing was deleted while it could not ask');

  w.done();
});

test('the record system is asked once per study, not once per step', () => {
  const w = world([['ACC1', OLD, REPORTED], ['ACC2', OLD, REPORTED]]);

  runOnce(w, WHEN, { forReal: true, toBin: false });

  assert.equal(w.recordSystem.timesAsked(), 2);

  w.done();
});

test('carryOut acts on exactly what look returned, and nothing else', () => {
  // The property the whole design exists for, asserted directly: hand carryOut
  // a decision list with everything refused, and it does nothing at all.
  const w = world([['ACC1', OLD, REPORTED]]);

  const decisions = look(w.archive, w.recordSystem, WHEN).map((one) => ({ ...one, mayGo: false }));
  const did = carryOut(decisions, { archive: w.archive, store: w.store, toBin: false });

  assert.deepEqual(did, []);
  assert.equal(w.archive.howMany(), 1);

  w.done();
});

test('the store refuses a path that is not under its root', () => {
  // The catalogue computes the path by joining three columns. One wrong row and
  // this job would be pointed at somewhere else entirely, so the check is here
  // rather than in the caller that trusted the join.
  const w = world([['ACC1', OLD, REPORTED]]);

  assert.throws(() => w.store.remove('/etc'), /refusing to touch/);
  assert.throws(() => w.store.remove('../..'), /refusing to touch/);

  w.done();
});

test('a refusal is counted under a reason, and the reasons add up', () => {
  const w = world([
    ['ACC1', OLD, REPORTED],
    ['ACC2', '2026-08-30', REPORTED],
    ['ACC3', OLD, null],
    ['ACC4', OLD, REPORTED, { noBooking: true }],
    [null, OLD, null],
  ]);

  const report = runOnce(w, WHEN);
  const total = Object.values(report.refusedBecause).reduce((n, one) => n + one, 0);

  assert.equal(report.considered, report.chose + report.refusedCount);
  assert.equal(total, report.refusedCount, 'every refusal has a reason');
  assert.equal(report.refusedBecause.RECORDS_SAY_NOTHING, 1);
  assert.equal(report.refusedBecause.NO_ACCESSION, 1);
  assert.equal(report.refusedBecause.NOT_REPORTED, 1);

  // The study inside the window never reaches `considered`: `olderThan` does
  // not return it.
  assert.equal(report.considered, 4);

  w.done();
});
