#!/usr/bin/env node
/**
 * Every path this repository writes down is a path that is here.
 *
 *     npm run check:paths
 *
 * A README names files, and files get renamed. The prose keeps the old name and
 * goes on reading perfectly well while it is wrong, which is the expensive kind
 * of wrong: two of the mentions here are markdown links, so on GitHub they are
 * not stale text, they are a 404 in the middle of the argument.
 *
 * That is not hypothetical. Everything under `src/` was `.js` until Node began
 * running the types directly. The imports moved, the tests moved, CI moved, and
 * thirteen mentions in the README did not — the map at the bottom listed eight
 * files by names nothing had any more, and nothing anywhere went red.
 *
 * So the list is not written down a second time for this to compare against. It
 * is read out of the README and out of the source, and looked for on the disk,
 * which is the arrangement CI already uses for the pictures and the npm
 * scripts: the copy is the thing that goes stale, so there is no copy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/**
 * What counts as a path, and what is only shaped like one.
 *
 * The extension is the deciding rule for anything written in prose, and it has
 * to be, because a README about this program is full of things a looser rule
 * would go looking for on the disk: `node:sqlite`, `127.0.0.1:4100`,
 * `1900-01-01`, `v24.19.0`, `Date.now(`, `@types/node`. None of them ends in
 * one of these, and none of them is a file anybody could open.
 */
const KINDS = /[.](ts|js|json|css|html|svg|png|md|yml)$/;

/** The directories a path can be rooted at, read off the disk rather than listed. */
const ROOTS = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((one) => one.isDirectory() && !one.name.startsWith('.') && one.name !== 'node_modules')
  .map((one) => one.name);

type Mention = { file: string; where: number; says: string };

const mentioned: Mention[] = [];
const already = new Set<string>();

function note(file: string, where: number, says: string): void {
  const one = `${file} ${where} ${says}`;
  if (already.has(one)) return;

  already.add(one);
  mentioned.push({ file, where, says });
}

/** Addresses on the web are not paths on this disk, and one of them ends in `.html`. */
const withoutLinks = (text: string): string => text.replace(/https?:[/][/]\S+/g, ' ');

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const lines = readme.split('\n');

lines.forEach((text, n) => {
  const local = withoutLinks(text);

  // A link target is a claim whatever it is shaped like: [LICENSE](LICENSE) has
  // no slash and no extension and is still a link that can 404. Only the ones
  // that leave the repository — a scheme, or an anchor — are let past.
  for (const link of local.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (!/^([a-z][a-z0-9+.-]*:|#)/i.test(link[1])) note('README.md', n + 1, link[1]);
  }

  // And anything path-shaped in the prose, in the code blocks and in the map at
  // the bottom. Trailing punctuation is trimmed: a sentence ending on a filename
  // would otherwise send this looking for `store.ts.`.
  for (const loose of local.matchAll(/[A-Za-z0-9_.-]+(?:[/][A-Za-z0-9_.-]+)*[/]?/g)) {
    const says = loose[0].replace(/[.,;:]+$/, '');
    if (says.endsWith('/') || KINDS.test(says)) note('README.md', n + 1, says);
  }
});

/**
 * The same rule over the source, for the mentions that name their directory.
 *
 * The rename left two of those behind as well, in comments pointing a reader at
 * a neighbouring module. Only rooted mentions are read — `src/http/api.ts`, not
 * a bare `api.ts` — because a rooted one says where it is and can therefore be
 * looked for, and because it is the form that cannot be mistaken for an
 * identifier or for a path the program builds at run time.
 */
function everySource(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((one) => {
    const full = path.join(folder, one.name);

    if (one.isDirectory()) return everySource(full);
    return one.name.endsWith('.ts') ? [full] : [];
  });
}

const rooted = new RegExp(`\\b(?:${ROOTS.join('|')})(?:[/][A-Za-z0-9_.-]+)+`, 'g');

for (const file of ['src', 'test', 'tools'].flatMap((one) => everySource(path.join(root, one)))) {
  const named = path.relative(root, file).split(path.sep).join('/');

  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, n) => {
      for (const loose of withoutLinks(text).matchAll(rooted)) {
        if (KINDS.test(loose[0])) note(named, n + 1, loose[0]);
      }
    });
}

/**
 * The check that this check is still looking at anything.
 *
 * A pattern that has stopped matching reports nothing wrong in exactly the tone
 * of a pattern that found nothing wrong. The map under "Where things are" holds
 * most of the paths and is the part a rewrite would reformat first, so it is
 * counted separately rather than folded into the total.
 */
const heading = lines.findIndex((one) => /^#+\s+Where things are/i.test(one));
const opens = heading < 0 ? -1 : lines.findIndex((one, n) => n > heading && one.startsWith('```'));
const shuts = opens < 0 ? -1 : lines.findIndex((one, n) => n > opens && one.startsWith('```'));

const map =
  opens < 0 || shuts < 0
    ? []
    : mentioned.filter((one) => one.file === 'README.md' && one.where > opens + 1 && one.where <= shuts);

if (mentioned.length === 0 || map.length === 0) {
  console.error(`Nothing was read out of the README: ${mentioned.length} paths in all, ${map.length} in the map.`);
  console.error('A check that passes by finding nothing is worse than no check.');
  process.exit(1);
}

/** What the name became, so the message can be acted on without searching for it. */
function insteadOf(says: string): string | null {
  const folder = path.join(root, path.dirname(says));
  if (!fs.existsSync(folder)) return null;

  const stem = path.basename(says).replace(/[.][^.]+$/, '');

  const near = fs
    .readdirSync(folder)
    .filter((one) => one !== path.basename(says) && one.replace(/[.][^.]+$/, '') === stem)
    .map((one) => path.posix.join(path.dirname(says), one));

  return near.length > 0 ? near.join(', ') : null;
}

let bad = 0;

for (const one of mentioned) {
  const onDisk = path.join(root, ...one.says.split('/').filter(Boolean));
  const found = fs.existsSync(onDisk) ? fs.statSync(onDisk) : null;

  if (!found) {
    const instead = insteadOf(one.says);

    console.error(`${one.file} line ${one.where} points at ${one.says}, which is not in the repository.`);
    if (instead) console.error(`  there is ${instead}`);

    bad += 1;
    continue;
  }

  // A trailing slash is a claim about which kind of thing it is, and `public/`
  // becoming a file would be as broken as it going missing.
  if (one.says.endsWith('/') !== found.isDirectory()) {
    const [called, is] = found.isDirectory() ? ['a file', 'a directory'] : ['a directory', 'a file'];

    console.error(`${one.file} line ${one.where} calls ${one.says} ${called} and it is ${is}.`);
    bad += 1;
  }
}

if (bad > 0) {
  console.error(`\n${bad} of the ${mentioned.length} paths written down here point at nothing.`);
  process.exitCode = 1;
} else {
  console.log(
    `Every path written down here is here: ${mentioned.length} of them, ${map.length} in the map at the bottom of the README.`
  );
}
