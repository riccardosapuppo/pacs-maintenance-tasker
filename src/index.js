#!/usr/bin/env node
/**
 * Starts the service and opens the console.
 *
 *     npm start
 *     npm start -- --port 4101 --no-open
 *
 * Localhost only, and this one means it. Nothing here is anybody's data —
 * every study, patient and booking is invented in `src/measure/corpus.js`, and
 * the files are written into a temporary folder — but this is a job that
 * deletes things, and a job that deletes things does not bind every interface
 * on the machine because a default said so.
 *
 * 4100, and not 3000. That is the port every project on a machine uses in turn,
 * and a browser remembers service workers, storage and permissions per origin —
 * so two projects sharing a port share state neither knows about.
 */

import { openInABrowser } from './open-a-browser.js';
import { service } from './http/api.js';

function argument(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const PORT = Number(argument('port', process.env.PORT ?? 4100));
const HOST = argument('host', process.env.HOST ?? '127.0.0.1');

function log(level, message, detail = {}) {
  // One JSON object per line: a log a person greps and a log a machine parses
  // are the same log, and the moment they are not, one of them stops being kept.
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level, message, ...detail })}\n`);
}

const { server, close } = service({ log });

server.listen(PORT, HOST, () => {
  log('info', 'listening', {
    console: `http://${HOST}:${PORT}`,
    archive: 'invented, in memory, with its files in a temporary folder',
    deletes: 'that folder, and nothing else — no clinic, patient or study in this repository is real',
  });

  const browser = openInABrowser(`http://${HOST}:${PORT}/`);
  log('info', browser.opened ? 'the console is open' : 'the console was not opened', { why: browser.why });
});

/**
 * A port that is already taken is a sentence, not a stack trace.
 *
 * Node's default is eleven lines ending in EADDRINUSE, which says what happened
 * to somebody who already knows and nothing to anybody else. It happens on
 * every second start during development, and what the reader needs is the flag
 * that fixes it.
 */
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log('error', `something is already listening on ${HOST}:${PORT}`, {
      likely: 'another copy of this, or another project using the same port',
      try: `npm start -- --port ${PORT + 1}`,
    });

    process.exit(1);
  }

  log('error', 'the service stopped', { why: error.message });
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('info', 'stopping');
    server.close(() => {
      close();
      process.exit(0);
    });
  });
}
