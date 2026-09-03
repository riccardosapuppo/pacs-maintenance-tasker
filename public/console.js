/**
 * The console.
 *
 * No framework and no build step. Every fact on this page comes from the
 * service — the archive's counts, the reasons, the claims, the prose explaining
 * each one — because a page holding its own copy of any of that is a page that
 * keeps agreeing with itself after the code changes.
 *
 * The one thing this file decides on its own is what to warn about, and it is
 * deliberately narrow: the orphan count, and only when it is not zero.
 */

const $ = (what) => document.querySelector(what);

const at = {
  studies: $('[data-studies]'),
  folders: $('[data-folders]'),
  binned: $('[data-binned]'),
  orphans: $('[data-orphans]'),
  orphanFigure: $('[data-orphan-figure]'),
  orphanList: $('[data-orphan-list]'),
  keep: $('[data-keep]'),
  settles: $('[data-settles]'),
  dry: $('[data-dry]'),
  real: $('[data-real]'),
  reset: $('[data-reset]'),
  ran: $('[data-ran]'),
  tallies: $('[data-tallies]'),
  filters: $('[data-filters]'),
  decisions: $('[data-decisions] tbody'),
  disk: $('[data-disk]'),
  order: $('[data-order]'),
  permanent: $('[data-permanent]'),
  claims: $('[data-claims]'),
  claimFigure: $('[data-claim-figure]'),
};

const send = async (where, body) => {
  const said = await fetch(where, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  return said.json();
};

const text = (tag, className, content) => {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (content !== undefined) made.textContent = content;
  return made;
};

const empty = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

let reasons = {};
let lastRun = null;
let showing = 'all';

/**
 * How many times the page has drawn a run.
 *
 * Read by `npm run check:screen`, which presses a button and then looks at the
 * result. Waiting for the table to be non-empty is waiting for something that
 * may already be non-empty from the run before, so it returns instantly and
 * every check after it reads the page too early.
 */
let drawn = 0;

// ── the archive ─────────────────────────────────────────────────────────────

function drawState(state) {
  at.studies.textContent = state.studies;
  at.folders.textContent = state.folders;
  at.binned.textContent = state.inTheBin;
  at.orphans.textContent = state.orphans;

  at.orphanFigure.dataset.showing = state.orphans > 0 ? 'yes' : 'no';

  empty(at.orphanList);

  if (state.orphans > 0) {
    at.orphanList.append(
      text('h4', null, `${state.orphans} folders are now orphaned`),
      text(
        'p',
        null,
        'The catalogue no longer points at these. Nothing will look for them again: not this job, ' +
          'which starts every run from the catalogue, and not the archive’s own tools. This page ' +
          'can list them only because it happens to hold both sides, which a real archive does not.'
      )
    );

    const ul = text('ul');
    for (const one of state.orphanExamples) ul.append(text('li', null, one));
    if (state.orphans > state.orphanExamples.length) {
      ul.append(text('li', null, `… and ${state.orphans - state.orphanExamples.length} more`));
    }

    at.orphanList.append(ul);
  }
}

// ── a run ───────────────────────────────────────────────────────────────────

function settings(forReal) {
  return {
    forReal,
    keepForDays: Number(at.keep.value),
    reportSettlesAfterDays: Number(at.settles.value),
    diskRefuses: at.disk.checked,
    catalogueFirst: at.order.checked,
    toBin: !at.permanent.checked,
  };
}

async function run(forReal) {
  const said = await send('/api/run', settings(forReal));

  lastRun = said;
  drawState(said.state);
  drawRan(said.ran);
  drawTallies(said.ran);
  drawFilters(said.ran);
  drawDecisions(said.decisions);

  drawn += 1;
  document.body.dataset.drawn = String(drawn);
}

function drawRan(ran) {
  empty(at.ran);

  const line = (what) => at.ran.append(text('span', null, what));
  const strong = (what) => at.ran.append(text('b', null, what));

  if (!ran.forReal) {
    line('A dry run. Nothing was changed — it chose ');
    strong(`${ran.chose} studies`);
    line(` out of ${ran.considered} past the window, and held ${ran.refusedCount} back.`);
    return;
  }

  const binned = ran.did.filter((one) => one.files === 'binned').length;
  const gone = ran.did.filter((one) => one.files === 'gone').length;
  const missing = ran.did.filter((one) => one.files === 'was not there').length;

  line('A real run. ');
  strong(`${ran.chose} studies`);
  line(` deleted: ${binned} moved aside, ${gone} removed permanently, ${missing} already missing. `);

  if (ran.trouble.length) {
    strong(`${ran.trouble.length} did not finish`);
    line(
      ran.order.startsWith('files')
        ? ' — the catalogue still points at them, so the next run picks them up.'
        : ' — and the catalogue has already forgotten them.'
    );
  }
}

function drawTallies(ran) {
  empty(at.tallies);

  const row = (n, what, went) => {
    const made = text('div', went ? 'tally went' : 'tally');
    made.append(text('span', 'count', n), text('span', null, what));
    return made;
  };

  at.tallies.append(row(ran.chose, ran.forReal ? 'deleted' : 'would be deleted', true));

  for (const [code, n] of Object.entries(ran.refusedBecause).sort((a, b) => b[1] - a[1])) {
    at.tallies.append(row(n, `kept — ${reasons[code] ?? code}`, false));
  }
}

// ── the table ───────────────────────────────────────────────────────────────

function drawFilters(ran) {
  empty(at.filters);

  const counts = { all: ran.considered, GOES: ran.chose, ...ran.refusedBecause };

  const make = (key, label) => {
    const button = text('button', null, `${label} · ${counts[key] ?? 0}`);
    button.type = 'button';
    button.dataset.filter = key;
    button.setAttribute('aria-pressed', String(showing === key));
    button.addEventListener('click', () => {
      showing = key;
      drawFilters(ran);
      drawDecisions(lastRun.decisions);
    });
    return button;
  };

  at.filters.append(make('all', 'everything'), make('GOES', 'chosen'));

  for (const code of Object.keys(ran.refusedBecause).sort((a, b) => ran.refusedBecause[b] - ran.refusedBecause[a])) {
    at.filters.append(make(code, reasons[code] ?? code));
  }
}

function drawDecisions(decisions) {
  empty(at.decisions);

  const wanted = decisions.filter((one) => {
    if (showing === 'all') return true;
    if (showing === 'GOES') return one.mayGo;
    return one.code === showing;
  });

  // A page that draws three hundred rows and a page that draws sixty read the
  // same; the count is on the filter button above, which is where somebody
  // looks for it.
  for (const one of wanted.slice(0, 120)) {
    const row = text('tr');
    row.dataset.code = one.code;

    const study = text('td');
    study.append(text('span', null, one.accession ?? '(no accession)'));
    study.append(text('span', 'verdict-why', one.description));
    row.append(study);

    const who = text('td');
    who.append(text('span', null, one.patientName));
    who.append(text('span', 'verdict-why', one.patientId));
    row.append(who);

    row.append(text('td', 'soft', one.studyDate));
    row.append(text('td', 'soft', one.recordsSaid));

    const verdict = text('td');
    verdict.append(text('span', `verdict ${one.mayGo ? 'goes' : 'stays'}`, one.mayGo ? 'delete' : 'keep'));
    verdict.append(text('span', 'verdict-why', one.why));
    row.append(verdict);

    at.decisions.append(row);
  }

  if (wanted.length > 120) {
    const row = text('tr');
    const cell = text('td', 'soft', `… and ${wanted.length - 120} more`);
    cell.colSpan = 5;
    row.append(cell);
    at.decisions.append(row);
  }
}

// ── the claims ──────────────────────────────────────────────────────────────

function drawClaims(claims) {
  empty(at.claims);

  const held = claims.filter((one) => one.result.holds).length;
  at.claimFigure.textContent = `${held} of ${claims.length} hold`;

  for (const claim of claims) {
    const card = text('div', 'claim-card');

    const title = text('h3');
    title.append(text('span', `holds${claim.result.holds ? '' : ' no'}`, claim.result.holds ? 'holds' : 'fails'));
    title.append(text('span', null, claim.says));
    card.append(title);

    card.append(text('p', null, claim.matters));

    const figures = text('div', 'claim-figures');
    const r = claim.result;

    const line = (n, what, bad) => {
      const made = text('div', bad ? 'bad' : null);
      made.append(text('span', 'n', n), text('span', null, what));
      figures.append(made);
    };

    if ('quietlyMissing' in r) {
      line(r.chose, 'studies the dry run chose');
      line(r.deleted, 'studies the real run deleted — the same ones, in the same order');
      line(r.theOtherWayWouldHaveSaid, 'a dry run written as its own branch would have reported');
      line(r.quietlyMissing, 'it would not have mentioned, of the ones it was about to delete', true);
    }

    if ('wouldHaveGone' in r) {
      line(r.refusedForSilence, 'studies the record system had nothing to say about');
      line(r.refusedForNoAccession, 'studies with no accession number to look up');
      line(r.wouldHaveGone, 'would have been deleted if nothing meant yes', true);
    }

    if ('costOfTheOtherOrder' in r) {
      line(r.filesFirst.troubleFirstTime, 'studies the disk refused, in both orders');
      line(r.filesFirst.orphans, 'orphaned folders, deleting the files first');
      line(r.pointerFirst.orphans, 'orphaned folders, deleting the catalogue row first', true);
    }

    card.append(figures);
    at.claims.append(card);
  }
}

// ── starting ────────────────────────────────────────────────────────────────

at.dry.addEventListener('click', () => run(false));
at.real.addEventListener('click', () => run(true));

at.reset.addEventListener('click', async () => {
  const said = await send('/api/reset', {});

  drawState(said.state);
  empty(at.tallies);
  empty(at.filters);
  empty(at.decisions);
  at.ran.textContent = 'The archive is back the way it started.';

  lastRun = null;
  showing = 'all';

  drawn += 1;
  document.body.dataset.drawn = String(drawn);
});

async function start() {
  const [state, gotReasons, gotClaims] = await Promise.all([
    send('/api/state'),
    send('/api/reasons'),
    send('/api/claims'),
  ]);

  reasons = gotReasons.reasons;

  at.keep.value = String(state.defaults.keepForDays);
  at.settles.value = String(state.defaults.reportSettlesAfterDays);

  drawState(state);
  drawClaims(gotClaims.claims);

  at.ran.textContent = `Today is ${state.today} in this archive. Press a button.`;

  // The page says when it has finished drawing, so a check that presses a button
  // presses it after there is something to press. Waiting on a timeout instead
  // is a check that passes on a fast machine and fails on a loaded one.
  document.body.dataset.ready = 'yes';
  document.body.dataset.drawn = '0';
}

start();
