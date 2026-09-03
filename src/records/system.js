/**
 * The record system: bookings, the lines on them, and when each was reported.
 *
 * The other store, and the one with the authority. The archive knows that a
 * study exists; only this knows whether anybody still needs it. So every
 * deletion is really a question asked across a boundary — to a different
 * database, owned by a different product, joined on nothing but an accession
 * number that both sides happen to write down.
 *
 * ── The join is a string somebody typed ──────────────────────────────────────
 *
 * There is no foreign key here and there cannot be. The archive is one vendor's
 * database and this is another's; the accession number is the only thing they
 * share, it arrives on the imaging side through a worklist message, and it is
 * a `VARCHAR`. Leading zeros get lost, a prefix gets added on one side after an
 * upgrade, somebody re-books by hand and types it with a space.
 *
 * Which is why `ask` distinguishes THREE outcomes and not two, and why the
 * caller is made to handle all three:
 *
 *   asked, and found rows     — there is something to reason about
 *   asked, and found nothing  — the question was put and came back empty
 *   could not ask             — the database did not answer
 *
 * A function that returned "the rows" and let an empty array speak for itself
 * is the shape the mistake in `rules.js` was made in.
 */

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE bookings (
    id          INTEGER PRIMARY KEY,
    -- The accession number, as this side writes it. Not unique: a booking can
    -- be made twice, and one of them withdrawn.
    code        TEXT NOT NULL,
    patient_id  TEXT NOT NULL,
    booked_for  TEXT NOT NULL,
    withdrawn   INTEGER NOT NULL DEFAULT 0
  );

  -- One line per examination on the booking. A booking for an abdomen and a
  -- chest is one code and two lines, and they are reported separately.
  CREATE TABLE lines (
    id          INTEGER PRIMARY KEY,
    booking_id  INTEGER NOT NULL REFERENCES bookings(id),
    examination TEXT NOT NULL,
    withdrawn   INTEGER NOT NULL DEFAULT 0,
    -- NULL means not reported. The placeholder date means the same thing said
    -- by a column that was not allowed to be NULL, and it is a different value
    -- that has to be handled separately -- see NOT_YET in decide/rules.js.
    reported_on TEXT
  );

  CREATE INDEX ix_bookings_code ON bookings (code);
  CREATE INDEX ix_lines_booking ON lines (booking_id);
`;

export function records() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);

  /**
   * Whether the database is answering.
   *
   * A switch rather than a mock, because the run has to be exercised against a
   * record system that has stopped answering halfway through — and a job that
   * deletes things needs that path tested, not described.
   */
  let answering = true;
  let asked = 0;

  return {
    db,

    close() {
      db.close();
    },

    stopAnswering() {
      answering = false;
    },

    startAnswering() {
      answering = true;
    },

    timesAsked() {
      return asked;
    },

    addBooking({ code, patientId, bookedFor, withdrawn = false }) {
      return db
        .prepare(
          'INSERT INTO bookings (code, patient_id, booked_for, withdrawn) VALUES (?, ?, ?, ?) RETURNING id'
        )
        .get(code, patientId, bookedFor, withdrawn ? 1 : 0).id;
    },

    addLine({ bookingId, examination, withdrawn = false, reportedOn = null }) {
      db.prepare(
        'INSERT INTO lines (booking_id, examination, withdrawn, reported_on) VALUES (?, ?, ?, ?)'
      ).run(bookingId, examination, withdrawn ? 1 : 0, reportedOn);
    },

    /**
     * What this system knows about one accession number.
     *
     * Three outcomes, always. The caller cannot accidentally treat "nothing" as
     * "nothing to worry about", because "nothing" and "could not ask" are
     * different fields and neither of them is an empty array by default.
     */
    ask(accession) {
      asked += 1;

      if (!answering) {
        return { asked: false, why: 'the record system did not answer' };
      }

      const rows = db
        .prepare(
          `SELECT
              b.withdrawn   AS bookingWithdrawn,
              l.withdrawn   AS lineWithdrawn,
              l.examination AS examination,
              l.reported_on AS reportedOn
            FROM bookings b
            JOIN lines l ON l.booking_id = b.id
           WHERE b.code = ?
           ORDER BY l.id`
        )
        .all(accession);

      return {
        asked: true,
        rows: rows.map((one) => ({
          bookingWithdrawn: Number(one.bookingWithdrawn) === 1,
          lineWithdrawn: Number(one.lineWithdrawn) === 1,
          examination: one.examination,
          reportedOn: one.reportedOn,
        })),
      };
    },

    run(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
  };
}
