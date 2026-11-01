// Sanity-check a produced ZIP: entry names, separators, and (for the
// extension package) the manifest version inside the archive.
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

function readEntries(file) {
  const b = readFileSync(file);
  const entries = [];
  // Local file headers
  let i = 0;
  while (i < b.length - 4) {
    if (b.readUInt32LE(i) === 0x04034b50) {
      const method = b.readUInt16LE(i + 8);
      const compSize = b.readUInt32LE(i + 18);
      const uncompSize = b.readUInt32LE(i + 22);
      const nameLen = b.readUInt16LE(i + 26);
      const extraLen = b.readUInt16LE(i + 28);
      const name = b.toString('utf8', i + 30, i + 30 + nameLen);
      const dataStart = i + 30 + nameLen + extraLen;
      const payload = b.subarray(dataStart, dataStart + compSize);
      entries.push({
        name,
        method,
        uncompSize,
        content: method === 8 ? zlib.inflateRawSync(payload) : payload,
      });
      i = dataStart + compSize;
    } else {
      i++;
    }
  }
  return entries;
}

const files = process.argv.slice(2);
let failures = 0;

for (const file of files) {
  const entries = readEntries(file);
  const names = entries.map(e => e.name);
  const bad = names.filter(n => n.includes('\\'));
  console.log(`\n=== ${file} ===`);
  console.log(`entries: ${names.length}`);
  console.log(`backslash separators: ${bad.length}${bad.length ? ' -> ' + bad.join(', ') : ' (good)'}`);
  if (bad.length) failures++;

  // Every entry must round-trip to its declared size.
  for (const e of entries) {
    if (e.content.length !== e.uncompSize) {
      console.log(`  !! size mismatch for ${e.name}`);
      failures++;
    }
  }

  const manifest = entries.find(e => e.name === 'manifest.json');
  if (manifest) {
    const parsed = JSON.parse(manifest.content.toString('utf8'));
    console.log(`manifest version: ${parsed.version}`);
    console.log(`manifest permissions: ${JSON.stringify(parsed.permissions)}`);
  }

  console.log(names.join('\n'));
}

console.log(failures === 0 ? '\nOK: all archives are well-formed' : `\nFAILED: ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);