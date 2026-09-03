#!/usr/bin/env node
/**
 * Nobody can be handed yesterday's page.
 *
 *     npm run check:serving
 *
 * A caching header is right in the source and wrong in the response more often
 * than anything else in a small service, and the failure is invisible from
 * inside: everything works, on the machine that has never had an old copy.
 *
 * The specific trap this exists for — met in a sibling project and worth
 * carrying — is that `etag` and `lastModified` are **separate** options in
 * every static file server, and both default to on. Turning off only the first
 * leaves the revalidation that serves somebody a stale page.
 *
 * There is no framework here, so the serving is thirty lines in
 * `src/http/api.js`. That does not make it right; it makes it checkable.
 *
 * It starts its own service on a port nothing else uses, so it can never go
 * green having measured a stranger's process.
 */

import { startTheService } from './with-the-service.ts';

let checks = 0;
let bad = 0;

function must(what: string, condition: boolean, detail?: unknown): void {
  checks += 1;

  if (condition) return console.log(`  ok    ${what}`);

  bad += 1;
  console.log(`  NO    ${what}`);
  if (detail) console.log(`          ${detail}`);
}

const service = await startTheService();

try {
  console.log(`\nHow ${service.base} serves what it serves\n`);

  for (const path of ['/', '/console.js', '/console.css', '/mark.svg']) {
    const response = await fetch(`${service.base}${path}`);
    const cache = response.headers.get('cache-control') ?? '';

    must(`${path} is served`, response.status === 200, `status ${response.status}`);
    must(`${path} says no-store`, /no-store/.test(cache), cache || '(no Cache-Control at all)');
    must(`${path} carries no ETag`, !response.headers.get('etag'), response.headers.get('etag'));
    must(
      `${path} carries no Last-Modified`,
      !response.headers.get('last-modified'),
      response.headers.get('last-modified')
    );
  }

  // The types, because a module served as text/plain is a module the browser
  // refuses to run — with a console message about MIME types that says nothing
  // about which file.
  const types = {
    '/': 'text/html',
    '/console.js': 'text/javascript',
    '/console.css': 'text/css',
    '/mark.svg': 'image/svg+xml',
  };

  for (const [path, wanted] of Object.entries(types)) {
    const response = await fetch(`${service.base}${path}`);
    const got = response.headers.get('content-type') ?? '';

    must(`${path} is ${wanted}`, got.startsWith(wanted), got);
  }

  // A file that is not there is not the page. A static server that falls back
  // to index.html for everything answers 200 for a typo, and the console then
  // tries to run HTML as JavaScript.
  const missing = await fetch(`${service.base}/nothing-here.js`);
  must('a file that does not exist is a 404', missing.status === 404, String(missing.status));
  must(
    'and not the page in disguise',
    !(missing.headers.get('content-type') ?? '').startsWith('text/html'),
    missing.headers.get('content-type')
  );

  // Nothing above the folder, whatever the request says. `path.join` resolves
  // `..` quite happily, so this is the check that the refusal happens before
  // the disk is touched.
  for (const climb of ['/../package.json', '/..%2Fpackage.json', '/%2e%2e/package.json']) {
    const response = await fetch(`${service.base}${climb}`);
    const body = await response.text();

    must(`${climb} gets nothing`, !body.includes('"name": "pacs-maintenance-tasker"'), `status ${response.status}`);
  }

  // ── the API says what it is ───────────────────────────────────────────────

  const health = await (await fetch(`${service.base}/api/health`)).json();

  // Parsed, not searched for. A step that greps a JSON body for `"ok":true`
  // goes red the day somebody indents the response — a red that costs an hour,
  // because it sends you looking at the service rather than at the check.
  must('health says it is ok', health.ok === true, JSON.stringify(health));
  must('and that all three claims hold', health.allHold === true, String(health.allHold));
  must('and how big the archive is', health.studies === 409, String(health.studies));

  // What it says it deletes. A job like this one has to be able to answer that
  // over HTTP, because it is the first thing anybody sensibly asks.
  must(
    'and what it is allowed to delete',
    /temporary folder/.test(health.deletes ?? ''),
    health.deletes
  );

  const nowhere = await fetch(`${service.base}/api/nothing`, { method: 'POST' });
  const said = await nowhere.json();
  must('an unknown endpoint is a 404', nowhere.status === 404, String(nowhere.status));
  must('and it says what was asked for', said.you_asked_for === '/api/nothing', JSON.stringify(said));

  const wrongMethod = await fetch(`${service.base}/api/run`);
  must('a GET on a POST route is a 405', wrongMethod.status === 405, String(wrongMethod.status));

  const notJson = await fetch(`${service.base}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ "forReal": ',
  });

  const complaint = await notJson.json();
  must('a half-typed body is a 400', notJson.status === 400, String(notJson.status));
  must('and says it is not JSON', /not JSON/i.test(complaint.error ?? ''), complaint.error);

  // ── and the dangerous default is the safe one ────────────────────────────
  //
  // A run request with nothing in it must be a DRY run. Every other field on
  // that route changes how the job works; this one changes whether an archive
  // still exists afterwards, so a missing field, a typo in its name, or a page
  // that forgot to send it all have to mean "do not delete anything".

  const before = await (await fetch(`${service.base}/api/state`)).json();

  for (const body of [{}, { forReal: 'yes' }, { forreal: true }, { forReal: 1 }]) {
    const said = await (
      await fetch(`${service.base}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json();

    must(
      `${JSON.stringify(body)} is a dry run`,
      said.ran.forReal === false && said.state.studies === before.studies,
      `forReal=${said.ran.forReal}, studies=${said.state.studies}`
    );
  }

  // And only the exact boolean does it.
  const real = await (
    await fetch(`${service.base}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forReal: true }),
    })
  ).json();

  must('and forReal: true really does delete', real.state.studies < before.studies, String(real.state.studies));

  await fetch(`${service.base}/api/reset`, { method: 'POST' });
} finally {
  await service.stop();
}

console.log('');

if (bad > 0) {
  console.log(`${bad} of ${checks} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`All ${checks} checks passed.`);
}
