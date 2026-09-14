/**
 * The number the README publishes about a check, against the number it ran.
 *
 * ── What was already held, and what was not ──────────────────────────────────
 *
 * This repository was careful about its README already. `check:paths` asserts
 * that every file it names exists, a CI step asserts that every command it
 * gives is a script, and `test/claims.test.ts` pins the numbers it quotes about
 * the archive -- 255 studies chosen, the date the corpus is anchored to.
 *
 * What nothing held were the numbers it publishes about its own checks:
 *
 *     npm test                 38 tests, about thirteen seconds
 *     npm run check:screen     drives the console in a real browser — 36 checks
 *     npm run check:serving    what the service actually sends — 39 checks
 *
 * All three were right. They were right because somebody had looked, which is
 * not the same as being held there: the first check added or removed leaves a
 * published number disagreeing with a printed one, quietly, and a README that is
 * confidently wrong about its own repository is worse than one that says
 * nothing. It is also the first thing anybody reads.
 *
 * ── Why inside the check rather than in a job of its own ─────────────────────
 *
 * Because the check has just counted, knows the number, and is already running.
 * A separate step would have to run everything a second time to learn what this
 * one already knows.
 *
 * ── Why a missing line fails ─────────────────────────────────────────────────
 *
 * A pattern that stops matching finds nothing, contradicts nothing and reports
 * success. If the README stops naming a check, this says so rather than quietly
 * becoming an assertion about nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const README = path.join(here, '..', 'README.md');

/**
 * @param command the command as the README writes it, e.g. `npm run check:screen`
 * @param ran how many checks actually ran
 * @returns an explanation when they disagree, or null when they agree
 */
export function readmeDisagrees(command: string, ran: number): string | null {
  const readme = fs.readFileSync(README, 'utf8');
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The line that begins with the command, whatever else is on it. The count
  // is written into the prose here rather than in a column, so the number is
  // looked for on the line and not at a fixed position.
  const line = readme.match(new RegExp(`^\\s*${escaped}\\s+.*$`, 'm'));

  if (!line) return `the README no longer gives ${command}, so nothing was compared`;

  const said = line[0].match(/(\d+)\s+(?:checks|tests)\b/);

  if (!said) {
    return `the README gives ${command} without saying how many checks it runs, so nothing was compared`;
  }

  return Number(said[1]) === ran
    ? null
    : `the README says ${command} runs ${said[1]} and ${ran} ran. Whichever is wrong, they cannot both be published`;
}

/** Say it and fail the run. Used at the end of a check that has just counted. */
export function holdTheReadmeToIt(command: string, ran: number): void {
  const wrong = readmeDisagrees(command, ran);
  if (!wrong) return;

  console.log('');
  console.log(wrong);
  process.exitCode = 1;
}
