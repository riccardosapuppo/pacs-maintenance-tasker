/**
 * May this study be deleted?
 *
 * One function, no side effects, no database. It is handed a study and whatever
 * the record system said about it, and it returns a decision with a reason. It
 * does not delete anything and it cannot: that is the entire point of it being
 * separate.
 *
 * ── Why this is a pure function ──────────────────────────────────────────────
 *
 * Because the run has to be able to answer, for every study it touched, "why".
 * A decision tangled up with the deleting can only be understood by deleting
 * something, and the whole difficulty of this job is that you cannot try it and
 * see. There is no undo for a study. There is barely a "what happened" once the
 * files are gone and the catalogue row with them.
 *
 * So the decision is made here, in the open, over data — and `run.js` maps every
 * study through it and *then* acts. The dry run and the real run call this
 * identical function on identical input, which is not a promise anybody has to
 * keep by being careful: it is the only code there is.
 *
 * ── Silence is not permission ────────────────────────────────────────────────
 *
 * The rule this file exists to get right.
 *
 * When the record system returns **nothing** for a study — no booking, no
 * report, no row at all — that is not the record system saying "go ahead". It is
 * the record system saying nothing, and the reasons it might say nothing are all
 * reasons to stop: the accession number is written differently on the two sides,
 * a sync has not run, the study was imported from somewhere else, the query hit
 * a replica that is behind, somebody typed the code in by hand.
 *
 * It is worth being precise about how easy this is to get wrong, because the
 * mistake is not carelessness. A `catch` block is *obviously* dangerous, so it
 * gets a safe default without anybody having to think. An empty result set is
 * not obviously anything — it is a perfectly ordinary return value — so it falls
 * through to whatever the last line of the function happens to be. The loud
 * failure gets guarded and the quiet one does not.
 *
 * `npm run measure` puts a number on that: how many studies, in the corpus,
 * are studies the record system has nothing to say about.
 */

/**
 * The reasons, as codes, because they get counted.
 *
 * A run that says "88 refused" and cannot break that down is a run nobody can
 * act on. Half of those might be a broken sync somebody should fix today and
 * the other half studies that are simply not old enough yet, and those are not
 * the same news.
 */
export const WHY = {
  // may go
  BOOKING_WITHDRAWN: 'the booking was withdrawn',
  EVERY_LINE_WITHDRAWN: 'every line of the booking was withdrawn',
  REPORTED_AND_OLD: 'reported, and past the retention window',

  // may not go
  TOO_YOUNG: 'inside the retention window',
  NOT_REPORTED: 'no report yet',
  REPORT_SENTINEL: 'the report date is the placeholder, not a date',
  REPORT_TOO_RECENT: 'reported, but not long enough ago',
  RECORDS_SAY_NOTHING: 'the record system has nothing about this study',
  RECORDS_UNREACHABLE: 'the record system could not be asked',
  NO_ACCESSION: 'the study carries no accession number to match on',
} as const;

/**
 * The shapes, written down once.
 *
 * `WhatTheRecordsSaid` is a union rather than an object with optional fields,
 * and that is the whole point of it. "Asked, and found nothing" and "could
 * not ask" are different answers with different consequences, and a caller
 * that destructures `rows` has to have decided which one it is holding first.
 * The bug this project is about was written in a function that returned the
 * rows and let an empty array speak for itself.
 */
export type WhyCode = keyof typeof WHY;

export type Verdict = { mayGo: boolean; code: WhyCode; why: string };

export type RecordLine = {
  bookingWithdrawn: boolean;
  lineWithdrawn: boolean;
  examination: string;
  reportedOn: string | null;
};

export type WhatTheRecordsSaid =
  | { asked: true; rows: RecordLine[] }
  | { asked: false; why: string };

/** Everything the decision needs from a study, and nothing else. */
export type DecidableStudy = { accession: string | null; studyDate: string };

export type When = {
  today: string;
  keepForDays: number;
  reportSettlesAfterDays: number;
};

/**
 * The date a record system writes when it means "not yet".
 *
 * Every one of them has one. This is not a quirk of the system this was
 * modelled on — it is what happens when a column is `NOT NULL` and somebody
 * needed a value before there was one. It sorts as very old, so any comparison
 * of the form "older than N days" says yes to it, enthusiastically, for exactly
 * the rows that have not been reported at all.
 */
export const NOT_YET = '1900-01-01';

const day = 24 * 60 * 60 * 1000;

/** Whole days between two ISO dates, floored. */
export function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / day);
}

export function decide(study: DecidableStudy, said: WhatTheRecordsSaid, when: When): Verdict {
  const answer = (mayGo: boolean, code: WhyCode): Verdict => ({ mayGo, code, why: WHY[code] });

  // ── the study's own age ──────────────────────────────────────────────────
  //
  // First, and on its own, because it needs nothing from anywhere else. A study
  // inside the retention window is not eligible however tidy its paperwork is,
  // and asking the record system about it would be a question whose answer
  // cannot change anything.
  if (daysBetween(study.studyDate, when.today) < when.keepForDays) {
    return answer(false, 'TOO_YOUNG');
  }

  // ── something to match on ────────────────────────────────────────────────
  //
  // No accession number means there is no way to find this study in the record
  // system, which means there is no way to establish that it may go. It is not
  // an error and it is not permission.
  if (!study.accession || !String(study.accession).trim()) {
    return answer(false, 'NO_ACCESSION');
  }

  // ── what the record system said ──────────────────────────────────────────

  if (said.asked === false) return answer(false, 'RECORDS_UNREACHABLE');

  // THE LINE THIS FILE IS ABOUT.
  //
  // The version this was rebuilt from returned "yes, delete it" here, at the
  // bottom of the function, after the loop over the rows found nothing to loop
  // over. Nobody wrote `if (nothing) delete`; it was the last statement in the
  // function and the empty case walked into it.
  if (!said.rows || said.rows.length === 0) return answer(false, 'RECORDS_SAY_NOTHING');

  const rows = said.rows;

  // ── withdrawn: the booking is gone, so the images can go ─────────────────
  //
  // Somebody cancelled the appointment, or cancelled every line on it. There is
  // nothing to report on and nothing to keep the images for.
  if (rows.some((one) => one.bookingWithdrawn)) return answer(true, 'BOOKING_WITHDRAWN');
  if (rows.every((one) => one.lineWithdrawn)) return answer(true, 'EVERY_LINE_WITHDRAWN');

  // ── reported, and settled ────────────────────────────────────────────────
  //
  // The images may go once every line has been reported and the report has been
  // in place long enough that nobody is still working from it. Every line,
  // not most: a booking with three examinations on it and two reports is a
  // booking somebody is still finishing.
  // Narrowed rather than counted.
  //
  // This was three filters over `rows`, the first counting the ones with no
  // report and the next two reading `reportedOn` as though the first had
  // removed them. It was correct and it was correct by argument: nothing in
  // the code said the rows reaching line three had a date on them, so anybody
  // reordering the checks would have broken it silently.
  //
  // Keeping the reported rows in their own list says it once, and the two
  // checks below read a `string` rather than a `string | null`.
  const reported = rows.filter(
    (one): one is RecordLine & { reportedOn: string } => one.reportedOn !== null && one.reportedOn !== ''
  );

  if (reported.length !== rows.length) return answer(false, 'NOT_REPORTED');

  if (reported.some((one) => one.reportedOn.slice(0, 10) === NOT_YET)) {
    return answer(false, 'REPORT_SENTINEL');
  }

  if (reported.some((one) => daysBetween(one.reportedOn, when.today) < when.reportSettlesAfterDays)) {
    return answer(false, 'REPORT_TOO_RECENT');
  }

  return answer(true, 'REPORTED_AND_OLD');
}

/**
 * The same decision, with the mistake put back.
 *
 * Not dead code and not a joke. `npm run measure` runs both over the same
 * corpus and prints the difference, because "we fixed a bug" is a sentence and
 * "this would have deleted 23 patients' studies out of 400, and none of them
 * would have looked like an error in any log" is a number.
 *
 * It is exported from here, next to the real rule, so that the two cannot drift
 * apart into a comparison that is no longer comparing anything.
 */
export function decideAsItWas(study: DecidableStudy, said: WhatTheRecordsSaid, when: When): Verdict {
  if (said.asked === false) return { mayGo: false, code: 'RECORDS_UNREACHABLE', why: WHY.RECORDS_UNREACHABLE };

  if (!said.rows || said.rows.length === 0) {
    return {
      mayGo: true,
      code: 'RECORDS_SAY_NOTHING',
      why: 'the record system had nothing, and nothing was read as yes',
    };
  }

  return decide(study, said, when);
}
