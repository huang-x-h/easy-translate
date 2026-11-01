// Final pre-publish check: unpack the release archive into a temp dir and
// verify the extension would actually load — manifest parses, every file
// it references exists, and the referenced scripts are present.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// With no argument, pick the newest chrome package in release/.
function findLatestPackage() {
  const dir = path.join(process.cwd(), 'release');
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter(f => /^easytranslate-\d+\.\d+\.\d+-chrome\.zip$/.test(f))
    .sort((a, b) => {
      const va = a.match(/(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
      const vb = b.match(/(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
      for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
      return 0;
    });
  return candidates.length ? path.join(dir, candidates[0]) : null;
}

const zipPath = process.argv[2] || findLatestPackage();
if (!zipPath || !existsSync(zipPath)) {
  console.error('Usage: node scripts/verify_release.mjs <zip>');
  console.error('No release archive found in release/ — run `npm run release` first.');
  process.exit(1);
}
console.log(`Verifying ${path.relative(process.cwd(), zipPath)}\n`);

const tmp = path.join(process.cwd(), '.release-verify');
if (existsSync(tmp)) rmSync(tmp, { recursive: true });
mkdirSync(tmp, { recursive: true });

function extract(file) {
  const b = readFileSync(file);
  let i = 0;
  while (i < b.length - 4) {
    if (b.readUInt32LE(i) === 0x04034b50) {
      const method = b.readUInt16LE(i + 8);
      const compSize = b.readUInt32LE(i + 18);
      const nameLen = b.readUInt16LE(i + 26);
      const extraLen = b.readUInt16LE(i + 28);
      const name = b.toString('utf8', i + 30, i + 30 + nameLen);
      const dataStart = i + 30 + nameLen + extraLen;
      const payload = b.subarray(dataStart, dataStart + compSize);
      const content = method === 8 ? zlib.inflateRawSync(payload) : payload;
      const out = path.join(tmp, name);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, content);
      i = dataStart + compSize;
    } else {
      i++;
    }
  }
}

extract(zipPath);

let problems = 0;
const fail = (msg) => { console.log(`  !! ${msg}`); problems++; };

const manifestPath = path.join(tmp, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('manifest.json missing');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.log(`manifest: v${manifest.version}, name="${manifest.name}"`);
  console.log(`permissions: ${JSON.stringify(manifest.permissions)}`);

  // Referenced files that must exist.
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...(manifest.content_scripts ?? []).flatMap(cs => [...(cs.js ?? []), ...(cs.css ?? [])]),
    ...Object.values(manifest.icons ?? {}),
  ].filter(Boolean);

  for (const rel of referenced) {
    const abs = path.join(tmp, rel);
    if (!existsSync(abs)) fail(`manifest references missing file: ${rel}`);
  }

  // The popup / options pages load ES modules with absolute paths like
  // "/options.js" — resolve those against the extension root.
  for (const htmlRel of [manifest.action?.default_popup, manifest.options_page].filter(Boolean)) {
    const html = readFileSync(path.join(tmp, htmlRel), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="\/([^"]+)"/g)) {
      const asset = m[1];
      if (!existsSync(path.join(tmp, asset))) {
        fail(`${htmlRel} references missing asset: /${asset}`);
      }
    }
  }

  // The ES module entry points import shared chunks by relative path.
  for (const entry of [manifest.background?.service_worker, manifest.action?.default_popup?.replace(/^src\/popup\//, '').replace(/\.html$/, '.js')].filter(Boolean)) {
    const entryPath = path.join(tmp, entry);
    if (!existsSync(entryPath)) continue;
    const code = readFileSync(entryPath, 'utf8');
    for (const m of code.matchAll(/from\s*["']\.\/([^"']+)["']/g)) {
      const dep = m[1];
      if (!existsSync(path.join(tmp, dep))) {
        fail(`${entry} imports missing chunk: ${dep}`);
      }
    }
  }

  // The service worker must not ship the test bundle.
  if (existsSync(path.join(tmp, 'test-vocabulary.iife.js'))) {
    fail('test bundle leaked into the release archive');
  }
}

console.log(problems === 0
  ? '\nOK: the archive looks loadable'
  : `\nFAILED: ${problems} problem(s)`);
rmSync(tmp, { recursive: true, force: true });
process.exit(problems === 0 ? 0 : 1);