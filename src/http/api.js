/**
 * The service, and the console it serves.
 *
 * `node:http` and nothing else. A job whose whole subject is being careful with
 * an irreversible operation is a strange place to add forty packages nobody has
 * read.
 *
 * ── What the console is for ──────────────────────────────────────────────────
 *
 * A dry run is a page of text, and a page of text is exactly the thing somebody
 * skims before clicking the button. So the console makes the run something you
 * operate: the archive is on the left, every decision is listed with its reason,
 * and the counts move when you change the retention window.
 *
 * And it lets you make the two mistakes on purpose.
 *
 * There is a switch for the ordering and a switch for the recycle bin, both
 * defaulting to the safe setting, and flipping either one and running the job
 * shows what it costs — in orphaned folders you can then see listed, on this
 * archive, in this browser. That is not a warning in a README. It is twenty-five
 * folders that were there a second ago and are now findable only by this page,
 * because the catalogue has forgotten them.
 *
 * Everything is invented and everything is in a temporary folder that goes when
 * the process stops.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { corpus, closeCorpus, WHEN, TODAY } from '../measure/corpus.js';
import { runOnce, FILES_FIRST, POINTER_FIRST } from '../decide/run.js';
import { WHY } from '../decide/rules.js';
import { everyClaim } from '../measure/claims.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', '..', 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/**
 * The three claims, computed once at startup.
 *
 * They build six archives on disk between them and take a couple of seconds,
 * and they produce the same answer every time — there is no clock in the
 * corpus. Recomputing them per request would be slower for no difference.
 */
function theClaims() {
  return everyClaim().map((one) => ({ says: one.says, matters: one.matters, result: one.result }));
}

export function service({ log = () => {} } = {}) {
  const claims = theClaims();

  /** The archive the console works on. Rebuilt whenever somebody asks. */
  let world = corpus({ onDisk: true });
  let history = [];

  const rebuild = () => {
    closeCorpus(world);
    world = corpus({ onDisk: true });
    history = [];
  };

  const server = http.createServer((request, response) => {
    const at = new URL(request.url, 'http://127.0.0.1');

    try {
      if (at.pathname.startsWith('/api/')) return api(at, request, response);
      return serve(at, response);
    } catch (error) {
      log('error', 'the request could not be handled', { where: at.pathname, why: error.message });
      json(response, 500, { error: error.message });
    }
  });

  return { server, close: () => closeCorpus(world) };

  // -------------------------------------------------------------------------

  function api(at, request, response) {
    if (at.pathname === '/api/health') {
      return json(response, 200, {
        ok: true,
        claims: claims.length,
        allHold: claims.every((one) => one.result.holds),
        studies: world.archive.howMany(),
        dependencies: 'none at runtime — node:http, node:sqlite, node:fs',
        deletes: 'an invented archive in a temporary folder, and nothing else',
      });
    }

    if (at.pathname === '/api/claims') return json(response, 200, { claims });

    if (at.pathname === '/api/reasons') return json(response, 200, { reasons: WHY });

    if (at.pathname === '/api/state') return json(response, 200, state());

    if (request.method !== 'POST') {
      return json(response, 405, { error: 'that route wants a POST', you_used: request.method });
    }

    return body(request, (sent, why) => {
      if (why) return json(response, 400, { error: why });

      if (at.pathname === '/api/reset') {
        rebuild();
        return json(response, 200, { state: state() });
      }

      /**
       * A run.
       *
       * `forReal` is the only field that changes what happens to the archive,
       * and it reaches exactly one line. The rest change how it is done, not
       * whether — which is why they can be offered on a page at all.
       */
      if (at.pathname === '/api/run') {
        const when = {
          today: TODAY,
          keepForDays: whole(sent?.keepForDays, WHEN.keepForDays),
          reportSettlesAfterDays: whole(sent?.reportSettlesAfterDays, WHEN.reportSettlesAfterDays),
        };

        /**
         * A disk having a bad day.
         *
         * Without this the two orderings behave identically, because both of
         * them finish. The difference between them is only ever visible when
         * the SECOND step fails -- so the page can turn that on, and the
         * choice of order stops being a paragraph and becomes a number of
         * folders on the screen.
         *
         * One study in ten, deterministically, so two runs with the same
         * settings produce the same answer.
         */
        if (sent?.diskRefuses === true) {
          let seen = 0;
          world.store.failWhen(() => {
            seen += 1;
            return seen % 10 === 0;
          });
        } else {
          world.store.failWhen(null);
        }

        const report = runOnce(world, when, {
          forReal: sent?.forReal === true,
          toBin: sent?.toBin !== false,
          order: sent?.catalogueFirst === true ? POINTER_FIRST : FILES_FIRST,
        });

        world.store.failWhen(null);

        // The page shows every decision, so they come back whole — but with the
        // record system's raw rows dropped, because a page does not need them
        // and a response does not need to be four times larger than it is.
        const decisions = report.decisions.map((one) => ({
          studyUid: one.study.studyUid,
          accession: one.study.accession,
          patientName: one.study.patientName,
          patientId: one.study.patientId,
          studyDate: one.study.studyDate,
          description: one.study.description,
          mayGo: one.mayGo,
          code: one.code,
          why: one.why,
          recordsSaid: one.said.asked === false ? 'could not ask' : `${one.said.rows.length} rows`,
        }));

        if (report.forReal) {
          history.push({
            chose: report.chose,
            order: report.order,
            toBin: report.toBin,
            trouble: report.trouble.length,
          });
        }

        return json(response, 200, {
          ran: {
            diskRefuses: sent?.diskRefuses === true,
            forReal: report.forReal,
            order: report.order,
            toBin: report.toBin,
            considered: report.considered,
            chose: report.chose,
            refusedCount: report.refusedCount,
            refusedBecause: report.refusedBecause,
            chosenUids: report.chosenUids,
            did: report.did,
            trouble: report.trouble,
          },
          decisions,
          state: state(),
        });
      }

      return json(response, 404, { error: 'no such route', you_asked_for: at.pathname });
    });
  }

  /**
   * What the archive looks like now, including what has been orphaned.
   *
   * `orphans` is computed here rather than remembered, by comparing the disk
   * against the catalogue — which is the only way anybody could ever find them,
   * and is exactly the point: this page can list them because it holds both
   * sides. On a real archive nothing holds both sides, which is why they would
   * never be found at all.
   */
  function state() {
    const folders = world.store.onDisk();

    const pointedAt = new Set(
      world.archive.run('SELECT study_uid AS uid FROM studies').map((row) => `partition-1/${row.uid}`)
    );

    const orphans = folders.filter((one) => !pointedAt.has(one));

    return {
      today: TODAY,
      defaults: { keepForDays: WHEN.keepForDays, reportSettlesAfterDays: WHEN.reportSettlesAfterDays },
      studies: world.archive.howMany(),
      folders: folders.length,
      orphans: orphans.length,
      orphanExamples: orphans.slice(0, 8),
      inTheBin: fs.existsSync(world.store.bin) ? fs.readdirSync(world.store.bin).length : 0,
      history,
    };
  }
}

/** A whole number in a sane range, or the fallback. A page sends strings. */
function whole(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 4000) return fallback;
  return Math.floor(n);
}

/**
 * Read a JSON body, with a size it will not go past.
 *
 * A run request is a few hundred bytes. A server that buffers whatever arrives
 * is a server one request can stop.
 */
function body(request, then) {
  const parts = [];
  let size = 0;

  request.on('data', (chunk) => {
    size += chunk.length;

    if (size > 100_000) {
      request.destroy();
      return then(null, 'that body is larger than any run request needs to be');
    }

    parts.push(chunk);
  });

  request.on('end', () => {
    if (size > 100_000) return;

    try {
      then(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {});
    } catch (error) {
      then(null, `that is not JSON: ${error.message}`);
    }
  });
}

/**
 * The page and its files.
 *
 * `no-store` on everything: these files carry no hash in their names, so a
 * cached copy is one that never updates, and a browser remembers per origin.
 */
function serve(at, response) {
  const name = at.pathname === '/' ? 'index.html' : at.pathname.slice(1);
  const file = path.join(PUBLIC, name);

  // Refuse anything that climbs out, before touching the disk.
  if (!file.startsWith(PUBLIC + path.sep)) return json(response, 403, { error: 'no' });

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return json(response, 404, { error: 'no such file', you_asked_for: at.pathname });
  }

  response.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  });

  response.end(fs.readFileSync(file));
}

function json(response, status, sent) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

  response.end(JSON.stringify(sent, null, 2));
}
