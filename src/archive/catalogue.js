/**
 * The image archive's catalogue: which studies exist, and where their files are.
 *
 * One of the two stores this job touches, and the one that owns the *pointer*.
 * A row here says "study 1.2.840…4471 is on disk at this path". Delete the row
 * and the files do not go anywhere — they simply stop being findable, by this
 * job or by anything else, because every query that would ever look for them
 * starts here.
 *
 * That asymmetry is the reason `run.js` deletes in the order it does, and it is
 * the third thing `npm run measure` puts a number on.
 *
 * ── Why SQLite ───────────────────────────────────────────────────────────────
 *
 * The archive this was rebuilt from is SQL Server, and the same job also had to
 * run against a Postgres build of the same product — which is why the original
 * carried two spellings of every query behind a `pacsPostgres` flag. None of
 * that is interesting to demonstrate and all of it needs a server, so this uses
 * `node:sqlite`, in memory, built fresh on every start. The shape of the schema
 * is the part that matters and it is preserved: a study row, a storage row, and
 * a filesystem row, joined to work out a path — because that join is where the
 * path comes from, and a job that deletes files needs to be honest about the
 * fact that it is *computing* the thing it is about to remove.
 */

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE studies (
    study_uid       TEXT PRIMARY KEY,
    accession       TEXT,
    patient_id      TEXT NOT NULL,
    patient_name    TEXT NOT NULL,
    study_date      TEXT NOT NULL,
    description     TEXT NOT NULL,
    storage_id      INTEGER NOT NULL REFERENCES storage(id)
  );

  -- Where a study's files live, in two halves: the folder the study is in, and
  -- the filesystem that folder is on. The path is the join of the two, which is
  -- how the archive itself stores it -- an archive gets a second disk and the
  -- filesystem row changes for ten thousand studies at once.
  CREATE TABLE storage (
    id              INTEGER PRIMARY KEY,
    filesystem_id   INTEGER NOT NULL REFERENCES filesystems(id),
    folder          TEXT NOT NULL
  );

  CREATE TABLE filesystems (
    id              INTEGER PRIMARY KEY,
    root            TEXT NOT NULL
  );

  CREATE INDEX ix_studies_date ON studies (study_date);
  CREATE INDEX ix_studies_accession ON studies (accession);
`;

export function catalogue() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);

  const run = (sql, params = []) => db.prepare(sql).all(...params);

  return {
    db,
    run,

    close() {
      db.close();
    },

    /** A filesystem the archive writes to. Returns its id. */
    addFilesystem(root) {
      return db.prepare('INSERT INTO filesystems (root) VALUES (?) RETURNING id').get(root).id;
    },

    addStorage(filesystemId, folder) {
      return db
        .prepare('INSERT INTO storage (filesystem_id, folder) VALUES (?, ?) RETURNING id')
        .get(filesystemId, folder).id;
    },

    add(study) {
      db.prepare(
        `INSERT INTO studies (study_uid, accession, patient_id, patient_name, study_date, description, storage_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        study.studyUid,
        study.accession ?? null,
        study.patientId,
        study.patientName,
        study.studyDate,
        study.description,
        study.storageId
      );
    },

    /**
     * Every study older than `days`, with the path its files are at.
     *
     * The path is computed by the join rather than stored, so a study whose
     * filesystem row has been repointed comes back with the new path — which is
     * correct, and is also the sort of thing that makes deleting from a
     * catalogue you do not own worth being careful about.
     */
    olderThan(days, today) {
      return run(
        `SELECT
            s.study_uid   AS studyUid,
            s.accession   AS accession,
            s.patient_id  AS patientId,
            s.patient_name AS patientName,
            s.study_date  AS studyDate,
            s.description AS description,
            f.root || '/' || st.folder || '/' || s.study_uid AS path
          FROM studies s
          JOIN storage st ON st.id = s.storage_id
          JOIN filesystems f ON f.id = st.filesystem_id
         WHERE julianday(?) - julianday(s.study_date) >= ?
         ORDER BY s.study_date, s.study_uid`,
        [today, days]
      );
    },

    /** One study, or undefined. Used to check what a run actually left behind. */
    find(studyUid) {
      return run('SELECT study_uid AS studyUid FROM studies WHERE study_uid = ?', [studyUid])[0];
    },

    /**
     * Forget a study.
     *
     * Named `forget` rather than `delete` on purpose. This removes the pointer
     * and nothing else: after it returns, the files are still on the disk,
     * taking up the same space, and there is no longer anything in this database
     * that knows they are there.
     */
    forget(studyUid) {
      const before = db.prepare('SELECT COUNT(*) AS n FROM studies WHERE study_uid = ?').get(studyUid).n;
      db.prepare('DELETE FROM studies WHERE study_uid = ?').run(studyUid);
      return Number(before) > 0;
    },

    howMany() {
      return Number(db.prepare('SELECT COUNT(*) AS n FROM studies').get().n);
    },
  };
}
