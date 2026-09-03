/**
 * Three claims, each one a thing that can be false.
 *
 * This is not a benchmark and there is no number here that means "fast". Every
 * claim is about an operation that cannot be taken back, and what is measured
 * is whether the job is right about it — and, where it is right, what being
 * wrong would have cost.
 *
 *   1. A dry run and a real run choose the same studies.
 *   2. Nothing is deleted because the record system said nothing.
 *   3. When the second of the two deletions fails, what is left can be finished.
 *
 * Each returns a result object with `holds: true|false`, so `npm run measure`
 * can exit non-zero and CI can fail on it. A claim that cannot fail is a
 * sentence in a README.
 */

import { corpus, closeCorpus, WHEN } from './corpus.ts';
import { decide, decideAsItWas } from '../decide/rules.ts';
import { look, runOnce, FILES_FIRST, POINTER_FIRST } from '../decide/run.ts';
import type { Order } from '../decide/run.ts';
import type { FileStore } from '../files/store.ts';

/**
 * A claim, and the shape of ITS result.
 *
 * Generic on purpose. The three results have nothing in common beyond `holds`,
 * and `everyClaim` used to return them as an array — which gave every element
 * the union of all three, so reading `result.orphans` off the ordering claim was
 * an error even though it is the only place that field exists. A tuple keeps
 * each one its own type, and the tests and the page read them directly.
 */
export type Claim<T> = { says: string; matters: string; result: T };

export type DryRunResult = {
  holds: boolean;
  chose: number;
  deleted: number;
  theOtherWayWouldHaveSaid: number;
  quietlyMissing: number;
  catalogueLeft: number;
};

export type SilenceResult = {
  holds: boolean;
  refusedForNoAccession: number;
  considered: number;
  refusedForSilence: number;
  wouldHaveGone: number;
  examples: Array<{ accession: string | null; patientName: string; studyDate: string; why: string }>;
};

export type OrderResult = {
  holds: boolean;
  filesFirst: WhatWasLeft;
  pointerFirst: WhatWasLeft;
  costOfTheOtherOrder: number;
};

/** What one ordering left behind. */
export type WhatWasLeft = {
  troubleFirstTime: number;
  troubleSecondTime: number;
  rowsLeft: number;
  foldersLeft: number;
  orphans: number;
};

/** Catalogue paths are absolute; the disk lists them relative to its root. */
const relative = (store: FileStore, path: string): string => path.slice(store.home.length + 1);

// ── 1 ───────────────────────────────────────────────────────────────────────

/**
 * A dry run and a real run choose the same studies.
 *
 * Two identical archives. One is looked at, the other is emptied. If the lists
 * differ by one study, every dry run anybody has ever read was a guess.
 *
 * The comparison is `chosenUids`, in order — not the count. Two runs that
 * choose 255 studies each and disagree about which would compare equal on any
 * total, and that is exactly the failure that would matter.
 *
 * It also measures the OTHER way of writing this, the one where the flag is
 * checked inside the loop and the dry branch reports "would delete" only for
 * studies whose folder is still on the disk. That branch is not stupid — it is
 * trying to be helpful, by not promising to delete something that is not there
 * — and it is wrong, because the real run removes the catalogue row either way.
 */
export function dryRunTellsTheTruth(): DryRunResult {
  const looking = corpus({ onDisk: true });
  const doing = corpus({ onDisk: true });

  const dry = runOnce(looking, WHEN, { forReal: false });
  const real = runOnce(doing, WHEN, { forReal: true, toBin: false });

  const same =
    dry.chosenUids.length === real.chosenUids.length &&
    dry.chosenUids.every((uid, at) => uid === real.chosenUids[at]);

  // What a dry run written as its own branch would have reported: the chosen
  // studies whose folder is on the disk right now.
  const asItWas = dry.decisions
    .filter((one) => one.mayGo)
    .filter((one) => looking.store.exists(relative(looking.store, one.study.path)));

  const result = {
    holds: same,
    chose: dry.chosenUids.length,
    deleted: real.chosenUids.length,
    theOtherWayWouldHaveSaid: asItWas.length,
    quietlyMissing: dry.chosenUids.length - asItWas.length,
    catalogueLeft: doing.archive.howMany(),
  };

  closeCorpus(looking);
  closeCorpus(doing);
  return result;
}

// ── 2 ───────────────────────────────────────────────────────────────────────

/**
 * Nothing is deleted because the record system said nothing.
 *
 * Both rules over the same studies and the same answers, counting where they
 * part. The number that comes out is not a defect count: it is a number of
 * patients whose images would have gone, on a run where nothing errored, no
 * exception was thrown, and the log would have read exactly like a good day.
 */
export function silenceIsNotPermission(): SilenceResult {
  const world = corpus();
  const decisions = look(world.archive, world.recordSystem, WHEN);

  let wouldHaveGone = 0;
  const examples: Array<{
    accession: string | null;
    patientName: string;
    studyDate: string;
    why: string;
  }> = [];

  for (const one of decisions) {
    const asItWas = decideAsItWas(one.study, one.said, WHEN);

    if (asItWas.mayGo && !one.mayGo) {
      wouldHaveGone += 1;
      if (examples.length < 4) {
        examples.push({
          accession: one.study.accession,
          patientName: one.study.patientName,
          studyDate: one.study.studyDate,
          why: one.why,
        });
      }
    }
  }

  const refusedForSilence = decisions.filter((one) => one.code === 'RECORDS_SAY_NOTHING').length;
  const refusedForNoAccession = decisions.filter((one) => one.code === 'NO_ACCESSION').length;

  // The claim is that every study the record system cannot speak for is
  // refused -- not that the two counts match. They do not, and the reason is
  // worth keeping: the old rule also swallowed the studies with no accession
  // number, because they reach the same empty result set by a different road.
  // Asserting equality made this claim fail on a corpus where the rule was
  // working perfectly.
  const everyOneRefused = decisions
    .filter((one) => one.code === 'RECORDS_SAY_NOTHING' || one.code === 'NO_ACCESSION')
    .every((one) => one.mayGo === false);

  const result = {
    holds: everyOneRefused && wouldHaveGone === refusedForSilence + refusedForNoAccession,
    refusedForNoAccession,
    considered: decisions.length,
    refusedForSilence,
    wouldHaveGone,
    examples,
  };

  closeCorpus(world);
  return result;
}

// ── 3 ───────────────────────────────────────────────────────────────────────

/**
 * When the second deletion fails, what is left has to be finishable.
 *
 * A study is a catalogue row and a folder, with no transaction across them. The
 * disk is made to refuse one study in ten, the run is done in both orders, and
 * then — with the disk working again — a second run is done to see which of the
 * two messes clears up.
 *
 * `orphans` is the number that matters: folders on the disk that no catalogue
 * row points at. Nothing finds them. Not this job, which starts every run from
 * the catalogue; not the archive's own tools; not somebody looking for a study
 * by name. They are the disk space this job exists to reclaim, permanently
 * unreclaimable, and there is no error anywhere.
 */
export function theOrderThatCanBeFinished(): OrderResult {
  const outcome: Partial<Record<Order, WhatWasLeft>> = {};

  for (const order of [FILES_FIRST, POINTER_FIRST] as const) {
    const world = corpus({ onDisk: true });

    // One in ten refuses. Deterministic: the same studies every time.
    let seen = 0;
    world.store.failWhen(() => {
      seen += 1;
      return seen % 10 === 0;
    });

    const first = runOnce(world, WHEN, { forReal: true, order, toBin: false });

    // The disk comes back, and the job runs again — which is all anybody would
    // do, and is the whole test.
    world.store.failWhen(null);
    const second = runOnce(world, WHEN, { forReal: true, order, toBin: false });

    const rowsLeft = world.archive.howMany();
    const foldersLeft = world.store.onDisk();

    const pointedAt = new Set(
      world.archive
        .run<{ uid: string }>('SELECT s.study_uid AS uid FROM studies s')
        .map((row) => `partition-1/${row.uid}`)
    );

    outcome[order] = {
      troubleFirstTime: first.trouble.length,
      troubleSecondTime: second.trouble.length,
      rowsLeft,
      foldersLeft: foldersLeft.length,
      orphans: foldersLeft.filter((one) => !pointedAt.has(one)).length,
    };

    closeCorpus(world);
  }

  const safe = outcome[FILES_FIRST] as WhatWasLeft;
  const other = outcome[POINTER_FIRST] as WhatWasLeft;

  return {
    holds: safe.orphans === 0 && other.orphans > 0,
    filesFirst: safe,
    pointerFirst: other,
    costOfTheOtherOrder: other.orphans,
  };
}

// ── all of them ─────────────────────────────────────────────────────────────

export function everyClaim(): [Claim<DryRunResult>, Claim<SilenceResult>, Claim<OrderResult>] {
  return [
    {
      says: 'A dry run and a real run choose the same studies.',
      matters:
        'Nobody turns this job loose on an archive without a dry run first, so the dry run is the entire basis on which anybody agrees to the real one. A dry run that is a good approximation is worth nothing: the studies it did not mention are the ones you were not warned about.',
      result: dryRunTellsTheTruth(),
    },
    {
      says: 'Nothing is deleted because the record system said nothing.',
      matters:
        'An exception is obviously dangerous and gets a safe default without anybody thinking about it. An empty result set is an ordinary return value, so it falls through to whatever the last line of the function happens to be. The loud failure gets guarded and the quiet one does not.',
      result: silenceIsNotPermission(),
    },
    {
      says: 'When the second of the two deletions fails, the next run can finish it.',
      matters:
        'There is no transaction across a catalogue and a disk. Removing the pointer first leaves files nothing can find, because every run starts from the catalogue; removing the files first leaves a row the next run picks up again. Same failure, same frequency, and one of them is permanent.',
      result: theOrderThatCanBeFinished(),
    },
  ];
}
