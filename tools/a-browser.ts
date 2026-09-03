/**
 * A browser to drive, wherever this is running.
 *
 * `playwright-core` deliberately ships no browsers — that is the whole point of
 * `-core`, and it is why installing it costs two megabytes instead of four
 * hundred. So it has to be pointed at one that is already on the machine, and
 * which one that is depends entirely on where you are:
 *
 *   this machine        Edge, which Windows already has
 *   a GitHub runner     Chrome and Chromium, which the image already has
 *   somebody else's     whatever they have; `--channel` says so
 *
 * A tool that hard-coded `msedge` ran here and nowhere else, which is the kind
 * of check that exists only on the machine it was written on. A tool that
 * silently fell back would be worse: it would go green having driven something
 * nobody can name. So this tries them in order and **says which one it got**.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** In the order they are likely to exist, this machine first. */
const CHANNELS = ['msedge', 'chrome', 'chromium'];

export function chosen(argv = process.argv) {
  const at = argv.indexOf('--channel');
  return at !== -1 && argv[at + 1] ? argv[at + 1] : null;
}

/**
 * @returns {{browser, channel: string}} the browser, and what it turned out to
 *   be. Print the second: a check whose output does not say what it drove is a
 *   check whose green nobody can reproduce.
 */
export async function aBrowser({ headless = true } = {}) {
  let chromium;

  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    console.error('playwright-core is not installed here, so this cannot run.');
    console.error('  npm install');
    process.exit(2);
  }

  const asked = chosen();
  const tries = asked ? [asked] : CHANNELS;
  const refused = [];

  for (const channel of tries) {
    try {
      // `chromium` with no channel is Playwright's own build, which -core does
      // not ship — so it is last, and it fails the same way as a missing Edge.
      const browser = await chromium.launch(
        channel === 'chromium' ? { headless } : { channel, headless }
      );

      return { browser, channel };
    } catch (error) {
      refused.push(`${channel}: ${String(error instanceof Error ? error.message : error).split('\n')[0]}`);
    }
  }

  console.error('No browser could be launched, so this check did not run.\n');
  for (const one of refused) console.error(`  ${one}`);
  console.error('\nInstall Edge or Chrome, or pass --channel <name> for one you have.');

  // 2, not 1. A check that could not run is neither a pass nor a failure, and
  // reporting it as either is a lie in one direction or the other.
  process.exit(2);
}
