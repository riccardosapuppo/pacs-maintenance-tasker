/**
 * The files: real folders, on a real disk, that really get deleted.
 *
 * Not a mock. The whole subject of this project is an operation that cannot be
 * undone, and a test suite that deletes an entry from a `Map` has not exercised
 * the thing anybody is actually frightened of. So a run works in a scratch
 * directory under the system temporary folder, writes real DICOM-shaped files
 * into it, and removes them with `fs.rm`.
 *
 * ── The recycle bin ──────────────────────────────────────────────────────────
 *
 * `remove` has two modes and the safe one is the default. Moving a folder aside
 * costs a rename and buys the only thing this job otherwise does not have: a
 * few days in which somebody can notice. The version this was rebuilt from had
 * the same switch — `eliminazioneDefinitiva` — and it defaulted to *permanent*
 * unless the config said otherwise, which is the wrong way round for a flag
 * whose two settings are "recoverable" and "not".
 *
 * ── Failing on purpose ───────────────────────────────────────────────────────
 *
 * `failWhen` makes a removal throw. It exists because the interesting question
 * about this job is not what happens when everything works: it is what is left
 * behind when the catalogue write succeeds and the disk write does not, and
 * that state has to be produced to be counted. `npm run measure` produces it in
 * both orders and counts what survives.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A few files that look like a study, so a folder is not an empty folder. */
const SLICES = 6;

/** What a removal did. Three answers, because "already gone" is its own. */
export type Removal = 'gone' | 'binned' | 'was not there';

/** True when this removal should throw. Used to produce a half-done state. */
export type FailWhen = ((where: string) => boolean) | null;

export type FileStore = ReturnType<typeof files>;

export function files({ root }: { root?: string } = {}) {
  const home = root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pacs-tasker-'));
  const bin = path.join(home, '.bin');

  fs.mkdirSync(home, { recursive: true });

  /** A predicate over the path; when it returns true, removal throws. */
  let failWhen: FailWhen = null;

  let written = 0;
  let removed = 0;
  let binned = 0;

  /**
   * The path the catalogue produced, made absolute and checked.
   *
   * It takes either form, because the two callers genuinely have different
   * ones: the corpus writes folders by their relative name, and the run
   * deletes whatever `catalogue.olderThan` computed, which is absolute --
   * root, partition, study uid, joined in SQL.
   *
   * The first version took only the relative form and quietly did
   * `path.join(home, absolutePath)`, which on Windows produces a path with
   * the root in it twice. Nothing threw: the folder did not exist, so every
   * removal answered "was not there" and the whole measurement ran green
   * having deleted nothing at all. It was the claim about ORDERING that
   * caught it -- both orders left the same 246 orphans, which is impossible
   * if either of them had removed a file.
   */
  const inside = (where: string): string => {
    const full = path.resolve(path.isAbsolute(where) ? where : path.join(home, where));

    // Checked here rather than trusted from the catalogue. The catalogue
    // computes paths by joining three columns; a job that deletes whatever
    // that join produces is one bad row away from deleting something else.
    if (full !== home && !full.startsWith(home + path.sep)) {
      throw new Error(`refusing to touch ${full}: it is not under ${home}`);
    }

    return full;
  };

  /** The same path as the disk lists it: relative to the root, forward slashes. */
  const asListed = (where: string): string =>
    inside(where).slice(home.length + 1).split(path.sep).join('/');

  return {
    home,
    bin,

    /** Write a study's folder, with a handful of slices in it. */
    put(where: string, { slices = SLICES }: { slices?: number } = {}): string {
      const full = inside(where);
      fs.mkdirSync(full, { recursive: true });

      for (let n = 1; n <= slices; n += 1) {
        fs.writeFileSync(path.join(full, `slice-${String(n).padStart(4, '0')}.dcm`), `slice ${n}\n`);
      }

      written += 1;
      return full;
    },

    exists(where: string): boolean {
      return fs.existsSync(inside(where));
    },

    /** Every study folder currently on the disk, as catalogue-relative paths. */
    onDisk(): string[] {
      const out: string[] = [];

      const walk = (dir: string, prefix: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name === '.bin') continue;

          const here = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

          // A study folder is one that holds files. Anything else is a level of
          // the tree — a filesystem root, a partition folder — and is walked.
          const holdsFiles = fs.readdirSync(here, { withFileTypes: true }).some((one) => one.isFile());

          if (holdsFiles) out.push(rel);
          else walk(here, rel);
        }
      };

      walk(home, '');
      return out.sort();
    },

    failWhen(predicate: FailWhen): void {
      failWhen = predicate;
    },

    /**
     * Remove a study's files.
     *
     * @param toBin  move it aside instead of deleting it. Default true, and the
     *   default is the argument: a caller that forgets to say gets the outcome
     *   somebody can walk back.
     * @returns {'gone'|'binned'|'was not there'}
     */
    remove(where: string, { toBin = true }: { toBin?: boolean } = {}): Removal {
      const full = inside(where);

      if (failWhen && failWhen(where)) {
        throw new Error(`the disk refused to remove ${where}`);
      }

      // "Already gone" is not an error and is not a success. It is its own
      // answer, because a run that finds the files missing is a run telling you
      // something about the last run.
      if (!fs.existsSync(full)) return 'was not there';

      if (toBin) {
        const to = path.join(bin, asListed(where).replaceAll('/', '__'));
        fs.mkdirSync(bin, { recursive: true });
        fs.rmSync(to, { recursive: true, force: true });
        fs.renameSync(full, to);
        binned += 1;
        return 'binned';
      }

      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
      return 'gone';
    },

    counts(): { written: number; removed: number; binned: number } {
      return { written, removed, binned };
    },

    /** Take the scratch directory away. */
    clear(): void {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
