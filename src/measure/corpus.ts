/**
 * The archive to run against: four hundred studies, invented.
 *
 * No clock and no randomness. `today` is a constant, every date is derived from
 * it, and the nth study is the same study on every machine and every run —
 * which is what lets `npm run measure` print numbers a README can quote and a
 * test can assert.
 *
 * ── What is in it, and why each case is here ─────────────────────────────────
 *
 * Every case is one somebody met. None of them is a hypothetical:
 *
 *   reported and settled     the ordinary case, and most of the corpus
 *   inside the window        too new to touch, whatever the paperwork says
 *   booking withdrawn        the appointment was cancelled
 *   every line withdrawn     each examination on it was cancelled separately
 *   not reported             the images are older than the window and nobody
 *                            has reported them, which happens and is not a
 *                            reason to throw them away
 *   the placeholder date     a report column that could not be NULL, so it got
 *                            1900-01-01, which reads as "very old" to any
 *                            comparison that does not know better
 *   reported recently        old images, fresh report, somebody still working
 *   two lines, one reported  the case that catches "some" where it wanted
 *                            "every"
 *   NOTHING IN THE RECORDS   the accession number finds no booking at all. The
 *                            case this whole project is about.
 *   no accession number      nothing to look up, so nothing can be established
 *
 * The "nothing in the records" studies are not padding and their number is not
 * arbitrary. They are the ones the version this was rebuilt from would have
 * deleted, and `npm run measure` reports that count as the price of the bug.
 */

import { catalogue } from '../archive/catalogue.ts';
import { records } from '../records/system.ts';
import { files } from '../files/store.ts';
import type { FileStore } from '../files/store.ts';
import type { Catalogue } from '../archive/catalogue.ts';
import type { RecordSystem } from '../records/system.ts';
import type { When } from '../decide/rules.ts';

export type World = {
  archive: Catalogue;
  recordSystem: RecordSystem;
  store: FileStore;
  when: When;
  plan: typeof PLAN;
};

export const TODAY = '2026-09-03';

export const WHEN = {
  today: TODAY,
  /** The archive keeps everything for this long, whatever else is true. */
  keepForDays: 40,
  /** And a report has to have been in place this long before its images go. */
  reportSettlesAfterDays: 40,
};

const day = 24 * 60 * 60 * 1000;

/** An ISO date `n` days before today. Deterministic: no `new Date()` anywhere. */
export function daysAgo(n: number): string {
  return new Date(Date.parse(TODAY) - n * day).toISOString().slice(0, 10);
}

const NAMES = [
  'ROSSI^MARIA', 'BIANCHI^GIUSEPPE', 'RUSSO^ANNA', 'FERRARI^LUCA', 'ESPOSITO^SOFIA',
  'ROMANO^MARCO', 'COLOMBO^GIULIA', 'RICCI^ANDREA', 'MARINO^CHIARA', 'GRECO^PAOLO',
];

const EXAMS = [
  'CT ABDOMEN', 'MR BRAIN', 'CT CHEST', 'MR KNEE', 'CR CHEST',
  'US ABDOMEN', 'CT HEAD', 'MR SPINE', 'CR WRIST', 'US THYROID',
];

/**
 * The shape of each study, in the order they are made.
 *
 * A list rather than a loop with branches in it, so that "how many of each"
 * is a thing you read rather than a thing you work out.
 */
const PLAN = [
  { kind: 'reported and settled', howMany: 210 },
  { kind: 'inside the window', howMany: 60 },
  { kind: 'booking withdrawn', howMany: 24 },
  { kind: 'every line withdrawn', howMany: 12 },
  { kind: 'not reported', howMany: 28 },
  { kind: 'the placeholder date', howMany: 14 },
  { kind: 'reported recently', howMany: 21 },
  { kind: 'two lines, one reported', howMany: 8 },
  { kind: 'nothing in the records', howMany: 17 },
  { kind: 'no accession number', howMany: 6 },

  /**
   * Reported and settled like the first group, and the folder is not on the
   * disk. The catalogue still points at it.
   *
   * This is ordinary: somebody cleared space by hand, a previous run stopped
   * half way, a restore put the row back without the files. The version this
   * was rebuilt from had a log line for precisely this case -- "probably
   * already deleted but still in the database".
   *
   * It is in the corpus because it is what makes a dry run and a real run
   * disagree, if they are two pieces of code. See claims.ts.
   */
  { kind: 'files already gone', howMany: 9 },
];

export const HOW_MANY = PLAN.reduce((n, one) => n + one.howMany, 0);

/**
 * Build the three stores, filled and consistent with each other.
 *
 * @param onDisk  write the study folders as well. The first two claims are
 *   about deciding and never touch a disk; the third one does.
 *
 * The store itself is always made, even when nothing is written into it. It was
 * `null` in the not-on-disk case for a while and every caller downstream had to
 * carry the possibility -- a run needs a store, so each of them either checked
 * for a null that could not happen or asserted it away. An empty scratch
 * directory costs nothing and removes the question.
 */
export function corpus({ onDisk = false }: { onDisk?: boolean } = {}): World {
  const archive = catalogue();
  const recordSystem = records();
  const store = files();

  const filesystem = archive.addFilesystem(onDisk ? store.home : '/archive');
  const storage = archive.addStorage(filesystem, 'partition-1');

  let n = 0;

  for (const { kind, howMany } of PLAN) {
    for (let i = 0; i < howMany; i += 1) {
      n += 1;

      const studyUid = `1.2.840.113619.2.55.${String(100000 + n)}`;
      const patientId = `PT${String(700000 + (n % 137))}`;
      const patientName = NAMES[n % NAMES.length];
      const description = EXAMS[n % EXAMS.length];

      // Spread the ages out so the corpus is not a cliff: studies from a bit
      // over the window to a couple of years old.
      const age = kind === 'inside the window' ? 3 + (i % 36) : 41 + ((i * 7) % 680);
      const studyDate = daysAgo(age);
      const accession = kind === 'no accession number' ? null : `ACC${String(500000 + n)}`;

      archive.add({ studyUid, accession, patientId, patientName, studyDate, description, storageId: storage });

      // Everything gets a folder except the group that exists to not have one.
      if (onDisk && kind !== 'files already gone') store.put(`partition-1/${studyUid}`);

      // ── and what the record system knows about it ────────────────────────

      if (kind === 'nothing in the records' || kind === 'no accession number') continue;

      const bookingId = recordSystem.addBooking({
        code: accession as string,
        patientId,
        bookedFor: studyDate,
        withdrawn: kind === 'booking withdrawn',
      });

      const line = (extra: { withdrawn?: boolean; reportedOn?: string | null }) =>
        recordSystem.addLine({ bookingId, examination: description, ...extra });

      if (kind === 'booking withdrawn') {
        line({ reportedOn: null });
      } else if (kind === 'every line withdrawn') {
        line({ withdrawn: true, reportedOn: null });
        line({ withdrawn: true, reportedOn: null });
      } else if (kind === 'not reported') {
        line({ reportedOn: null });
      } else if (kind === 'the placeholder date') {
        line({ reportedOn: '1900-01-01' });
      } else if (kind === 'reported recently') {
        line({ reportedOn: daysAgo(2 + (i % 30)) });
      } else if (kind === 'two lines, one reported') {
        line({ reportedOn: daysAgo(age - 1) });
        line({ reportedOn: null });
      } else {
        // reported and settled, and inside the window: reported the day after
        // the study, which is long ago for everything past the window.
        line({ reportedOn: daysAgo(Math.max(1, age - 1)) });
      }
    }
  }

  return { archive, recordSystem, store, when: WHEN, plan: PLAN };
}

export function closeCorpus({ archive, recordSystem, store }: World): void {
  archive.close();
  recordSystem.close();
  store.clear();
}
