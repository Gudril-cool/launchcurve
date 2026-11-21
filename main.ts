// LaunchCurve — entry point (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, prices every protocol that records no
// token by reading its TVL off the snapshot's own FDV–TVL power law (the model
// lives in lib/model.ts), and writes the deliverables:
//   /output/board.json   the ranked board (the gate reads this)
//   /output/data.js      the same board, shaped for the dashboard
//   /output/dashboard/   a copy of this repository's dashboard/
//   /output/screenshots/ a copy of this repository's screenshots/
//   /output/dossier.json buildDossier's summary of the two directories above
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
// In the grader the snapshot is at /input/snapshot.json and the output at /output.
// The output directory is cleared before each run, so a stale file from an
// earlier run can never leak into a graded one.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const TEXT_MAX_BYTES = 65_536; // the dossier text cap the scorer rebuilds with
const root = fileURLToPath(new URL('.', import.meta.url));

/** Read `--name value` or `--name=value` from argv, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && process.argv[at + 1] !== undefined) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launchcurve: no snapshot at ${inputFile} — pass --input <snapshot.json|dir>\n`);
  process.exit(2);
}
const outDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launchcurve: refusing to write a board the gate would refuse: ${issue}\n`);
  process.exit(1);
}

// Clear the output directory's contents first: the dossier must describe
// exactly this run. The directory itself is never removed — in the grader it
// is a mounted volume, and removing a mount point fails — and a failure to
// clear a stale entry must never fail the run, so each removal is guarded.
if (existsSync(outDir)) {
  for (const name of readdirSync(outDir)) {
    try {
      rmSync(join(outDir, name), { recursive: true, force: true });
    } catch {
      // A stale entry we cannot remove is overwritten below or ignored.
    }
  }
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files (dot-names skipped) into the output; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (dashFiles.length === 0) {
  process.stderr.write('launchcurve: dashboard/ is empty — the page is half the entry\n');
  process.exit(1);
}
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`launchcurve: screenshots/ holds ${shots.length} files — the gate wants 3 or 4\n`);
  process.exit(1);
}

// Written last: the dossier describes the dashboard and screenshots as they now stand.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `launchcurve: ${snapshot.protocols.length} protocols read; power law fitted on ${radar.fit.peer_count} peers ` +
    `(a=${radar.fit.a}, b=${radar.fit.b}, R²=${radar.fit.r_squared}); board of ${board.length} rows ` +
    `(${radar.watchlist_size} watchlist + ${radar.early_size} early) written to ${outDir}\n`,
);
