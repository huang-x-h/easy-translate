// One-shot release packaging.
//
//   node scripts/release.mjs [--version 1.1.0]
//
// Steps:
//   1. Sync the version across package.json + public/manifest.json.
//   2. Build the extension (tsc + vite) into dist/.
//   3. Rewrite dist/manifest.json's version to match.
//   4. Zip dist/ into release/easytranslate-<version>-chrome.zip.
//   5. Regenerate the Chrome Web Store assets and zip them into
//      release/easytranslate-store-assets.zip.
//
// The ZIP writer lives in package-release.mjs and emits spec-compliant
// forward-slash entry names.

import { readFileSync, writeFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createZip } from './package-release.mjs';

const args = process.argv.slice(2);
const versionArgIndex = args.indexOf('--version');
const newVersion = versionArgIndex >= 0 ? args[versionArgIndex + 1] : null;

const root = process.cwd();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');

function log(step, message) {
  console.log(`[release] ${step.padEnd(22)} ${message}`);
}

// --- 1. Version -------------------------------------------------------------
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'public', 'manifest.json');
const pkg = readJson(pkgPath);
const manifest = readJson(manifestPath);

const version = newVersion || pkg.version;
if (newVersion) {
  pkg.version = newVersion;
  writeJson(pkgPath, pkg);
  log('version', `package.json -> ${newVersion}`);
}
manifest.version = version;
writeJson(manifestPath, manifest);
log('version', `manifest.json -> ${version}`);

// --- 2. Build ---------------------------------------------------------------
// Invoke the tool JS entry points with the current Node binary. Going
// through `npx` is awkward here: it's a shell script on POSIX and a
// `.cmd` shim on Windows, and execFileSync can't spawn `.cmd` files
// without `shell: true` (which then mangles argument quoting).
const NODE = process.execPath;
const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const VITE = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

log('build', 'running tsc + vite build...');
execFileSync(NODE, [TSC], { cwd: root, stdio: 'inherit' });
execFileSync(NODE, [VITE, 'build'], { cwd: root, stdio: 'inherit' });

// --- 3. Sync the built manifest's version ----------------------------------
const distManifestPath = path.join(root, 'dist', 'manifest.json');
const distManifest = readJson(distManifestPath);
distManifest.version = version;
writeJson(distManifestPath, distManifest);
log('build', `dist/manifest.json version -> ${version}`);

// --- 4. Package the extension ----------------------------------------------
// The test-only bundle is built alongside the extension (the test suite
// needs it) but must never ship to users — it exposes internal classes
// on globalThis. Delete it from dist/ and also exclude it from the
// archive as a belt-and-braces measure.
const EXCLUDE = ['test-vocabulary.iife.js'];
for (const rel of EXCLUDE) {
  const abs = path.join(root, 'dist', rel);
  if (existsSync(abs)) rmSync(abs);
}

const releaseDir = path.join(root, 'release');
const chromeZip = path.join(releaseDir, `easytranslate-${version}-chrome.zip`);
if (existsSync(chromeZip)) rmSync(chromeZip);
const chromeResult = createZip(path.join(root, 'dist'), chromeZip, EXCLUDE);
log('package', `easytranslate-${version}-chrome.zip (${chromeResult.files} files, ${(chromeResult.bytes / 1024).toFixed(1)} KB)`);

// --- 5. Store assets --------------------------------------------------------
const storeAssetsDir = path.join(root, 'assets', 'store');
if (existsSync(storeAssetsDir)) {
  log('assets', 'generating Chrome Web Store assets...');
  try {
    execFileSync('node', ['scripts/generate-store-assets.mjs'], { cwd: root, stdio: 'inherit' });
  } catch (error) {
    log('assets', `skipped (${error.message.split('\n')[0]})`);
  }

  const storeZip = path.join(releaseDir, 'easytranslate-store-assets.zip');
  if (existsSync(storeZip)) rmSync(storeZip);
  const storeResult = createZip(storeAssetsDir, storeZip);
  log('package', `easytranslate-store-assets.zip (${storeResult.files} files, ${(storeResult.bytes / 1024).toFixed(1)} KB)`);
} else {
  log('assets', 'assets/store not present, skipped');
}

log('done', `release artifacts ready in release/`);
