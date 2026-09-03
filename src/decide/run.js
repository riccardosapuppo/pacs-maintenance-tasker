/**
 * One run of the job.
 *
 * Two functions, and the split between them is the design:
 *
 *   `look`       decides. Reads both stores, changes neither, and returns a
 *                decision with a reason for every study it considered.
 *   `carryOut`   acts. Takes those decisions and does what they say.
 *
 * A dry run is `look`. A real run is `look` **and then** `carryOut` on exactly
 * what it returned. There is no `if (dryRun)` inside the deciding, because
 * there is no deciding inside the acting — so "the dry run and the real run
 * agree" is not a property anybody has to maintain. It is the only arrangement
 * the code permits.
 *
 * ── Why that is worth the extra function ─────────────────────────────────────
 *
 * The version this was rebuilt from checked the flag in the middle of the loop,
 * three times, and the branches were not the same shape. The dry branch asked
 * the filesystem whether the folder existed and reported "would delete" only if
 * it did; the real branch deleted the catalogue row whether or not the folder
 * was there. So a study whose files had already gone was counted in one run and
 * not the other — quietly, in a report somebody reads to decide whether to turn
 * the flag off.
 *
 * That is the failure worth designing against, because of what a dry run is
 * FOR. Nobody runs this job on an archive without doing a dry run first; the
 * dry run is the entire basis on which anybody agrees to the real one. A dry
 * run that is a good approximation of the real run is worth nothing at all.
 *
 * ── The order of the two deletions ───────────────────────────────────────────
 *
 * A study is in two places and there is no transaction across them. Whichever
 * is removed first, the other can fail, and the two leftovers are not equally
 * bad:
 *
 *   pointer first   the catalogue row is gone and the files are not. Nothing
 *                   knows they are there. No future run finds them, because
 *                   every run starts from the catalogue. They sit on the disk
 *                   for ever.
 *   files first     the files are gone and the row is not. The next run picks
 *                   the same study up, gets "was not there" from the disk, and
 *                   finishes the job.
 *
 * One of those is garbage nothing can find and the other is work that finishes
 * itself. `FILES_FIRST` is the default; `POINTER_FIRST` exists so the
 * measurement can produce both and count what is left.
 */

import { decide } from './rules.js';

export const FILES_FIRST = 'files first, then the catalogue';
export const POINTER_FIRST = 'the catalogue first, then the files';

/**
 * Decide, for every study past the retention window.
 *
 * Reads. Does not write. Returns the same array whether or not anybody intends
 * to act on it.
 */
export function look(archive, recordSystem, when) {
  const considered = archive.olderThan(when.keepForDays, when.today);

  return considered.map((study) => {
    // Asked once per study, and the answer is kept on the decision. A run that
    // asked again while acting would be a run whose two halves could disagree
    // about a record that changed in between.
    const said = study.accession ? recordSystem.ask(study.accession) : { asked: true, rows: [] };
    const verdict = decide(study, said, when);

    return {
      study,
      said,
      mayGo: verdict.mayGo,
      code: verdict.code,
      why: verdict.why,
    };
  });
}

/**
 * Do what the decisions say.
 *
 * @param decisions  exactly what `look` returned
 * @param order      FILES_FIRST or POINTER_FIRST
 * @param toBin      move the files aside rather than deleting them
 */
export function carryOut(decisions, { archive, store, order = FILES_FIRST, toBin = true }) {
  const done = [];

  for (const decision of decisions) {
    if (!decision.mayGo) continue;

    const { studyUid, path } = decision.study;
    const outcome = { studyUid, path, files: null, catalogue: null, trouble: null };

    const removeFiles = () => {
      outcome.files = store.remove(path, { toBin });
    };

    const forgetRow = () => {
      outcome.catalogue = archive.forget(studyUid) ? 'forgotten' : 'was not there';
    };

    const steps = order === FILES_FIRST ? [removeFiles, forgetRow] : [forgetRow, removeFiles];

    try {
      for (const step of steps) step();
    } catch (error) {
      // The step that threw stops this study and nothing else. One unreadable
      // folder is not a reason to leave the other three hundred studies taking
      // up the disk, and the half-finished state is recorded rather than
      // retried here -- the next run is the retry, and it is the retry because
      // of the order the steps are in.
      outcome.trouble = error.message;
    }

    done.push(outcome);
  }

  return done;
}

/**
 * A whole run, as a report somebody reads.
 *
 * `forReal` is the only thing that changes what happens, and it changes it in
 * exactly one place: whether `carryOut` is called.
 */
export function runOnce({ archive, recordSystem, store }, when, { forReal = false, order = FILES_FIRST, toBin = true } = {}) {
  const decisions = look(archive, recordSystem, when);

  const chosen = decisions.filter((one) => one.mayGo);
  const refused = decisions.filter((one) => !one.mayGo);

  const byReason = {};
  for (const one of refused) byReason[one.code] = (byReason[one.code] ?? 0) + 1;

  const did = forReal ? carryOut(decisions, { archive, store, order, toBin }) : [];

  return {
    when,
    forReal,
    order,
    toBin,
    considered: decisions.length,
    chose: chosen.length,
    refusedCount: refused.length,
    refusedBecause: byReason,
    decisions,
    /** The studies chosen, as ids, in order. This is what "the two runs agree" compares. */
    chosenUids: chosen.map((one) => one.study.studyUid),
    did,
    trouble: did.filter((one) => one.trouble),
  };
}
