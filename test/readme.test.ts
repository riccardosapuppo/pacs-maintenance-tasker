import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * How many tests there are, against how many the README says there are.
 *
 * This repository already held most of what it publishes: `check:paths` asserts
 * that every file the README names exists, a CI step asserts that every command
 * it gives is a script, and `claims.test.ts` pins the numbers it quotes about
 * the archive. The two browser-and-service checks assert their own printed
 * count from inside themselves now.
 *
 * This is the one left. It was right, and right because somebody had looked --
 * so the first test added would have left a published figure disagreeing with a
 * printed one, without anything going red.
 *
 * Counted from the files rather than by running the suite: this is one read of
 * four files, not a second pass over everything. The two agree because nothing
 * here generates cases in a loop, and if that changes they will disagree and
 * this is what will say so.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const readme = fs.readFileSync(path.join(here, '..', 'README.md'), 'utf8');

function casesInTheSuite(): number {
  return fs
    .readdirSync(here)
    .filter((name) => name.endsWith('.test.ts'))
    .reduce((all, name) => {
      const source = fs.readFileSync(path.join(here, name), 'utf8');
      return all + (source.match(/^\s*(?:it|test)\(/gm) ?? []).length;
    }, 0);
}

describe('the README, about this repository', () => {
  it('says how many tests there are, and is right', () => {
    // The emptiness first: a pattern that has stopped matching finds nothing,
    // contradicts nothing, and passes.
    const said = readme.match(/^\s*npm test\s+.*?(\d+)\s+tests\b/m);

    assert.ok(said, 'the README no longer says how many tests there are, so nothing was compared');
    assert.equal(
      Number(said[1]),
      casesInTheSuite(),
      `the README says ${said[1]} and there are ${casesInTheSuite()}`
    );
  });

  it('gives no command that this package does not have', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    // Only inside code blocks. In prose "npm run measure" appears mid-sentence
    // with punctuation attached, and a sibling project's version of this once
    // went looking for a script called `could` because it had read the words
    // "npm could install".
    const blocks = [...readme.matchAll(/```[\s\S]*?```/g)].map((one) => one[0]).join('\n');
    const named = [...blocks.matchAll(/^npm run ([a-z][a-z:-]*)/gm)].map((one) => one[1]!);

    assert.ok(named.length > 0, 'the README names no commands at all, which cannot be right');

    const missing = [...new Set(named)].filter((one) => !(one in (manifest.scripts ?? {})));
    assert.deepEqual(missing, [], `named in the README and not in package.json: ${missing.join(', ')}`);
  });
});
