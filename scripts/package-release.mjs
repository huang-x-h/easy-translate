// Packages a directory into a spec-compliant ZIP.
//
// Why not `zip` / PowerShell's Compress-Archive?
//
//   - `zip` is not available on Windows.
//   - Compress-Archive writes entry names with BACKSLASH separators
//     ("assets\api-xyz.js"). That violates the ZIP spec (APPNOTE 4.4.17
//     mandates forward slashes) and some extractors — including the
//     Chrome Web Store's — treat the whole thing as one flat filename.
//
// This writer emits forward-slash paths, sets the UTF-8 name flag, and
// uses deflate. No third-party dependencies.

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function collectFiles(dir, base = dir, exclude = new Set()) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (exclude.has(rel)) continue;
    if (st.isDirectory()) {
      out.push(...collectFiles(full, base, exclude));
    } else {
      // Always forward slashes, regardless of the host OS.
      out.push({ name: rel, full });
    }
  }
  return out;
}

/**
 * Build a ZIP archive of `sourceDir`.
 *
 * @param {string} sourceDir  directory to archive
 * @param {string} outputPath where to write the .zip
 * @param {string[]} exclude  repo-relative paths to skip
 */
export function createZip(sourceDir, outputPath, exclude = []) {
  const files = collectFiles(sourceDir, sourceDir, new Set(exclude));
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const content = readFileSync(file.full);
    const deflated = zlib.deflateRawSync(content, { level: 9 });
    // Fall back to "stored" if deflate made it bigger.
    const useDeflate = deflated.length < content.length;
    const payload = useDeflate ? deflated : content;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6);       // general purpose flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);           // last mod time (fixed, keeps builds reproducible)
    local.writeUInt16LE(0x21, 12);       // last mod date (1996-01-01, fixed)
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length
    localParts.push(local, nameBuffer, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed to extract
    central.writeUInt16LE(0x0800, 8);     // flags: UTF-8
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);         // extra length
    central.writeUInt16LE(0, 32);         // comment length
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0o644 << 16, 38); // external attrs (unix perms)
    central.writeUInt32LE(offset, 42);    // relative offset of local header
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory signature
  end.writeUInt16LE(0, 4);               // number of this disk
  end.writeUInt16LE(0, 6);               // disk with central directory
  end.writeUInt16LE(files.length, 8);    // entries on this disk
  end.writeUInt16LE(files.length, 10);   // total entries
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);         // offset of central directory
  end.writeUInt16LE(0, 20);              // comment length

  const zip = Buffer.concat([...localParts, centralDirectory, end]);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, zip);
  return { files: files.length, bytes: zip.length };
}

// --- CLI -------------------------------------------------------------------
// Compare resolved paths — a plain endsWith() would match
// "package-release.mjs" for "release.mjs" and fire when this module is
// merely imported.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) {
    console.error('Usage: node scripts/package-release.mjs <sourceDir> <outputZip>');
    process.exit(1);
  }
  const result = createZip(source, output);
  console.log(`Packaged ${result.files} files -> ${output} (${(result.bytes / 1024).toFixed(1)} KB)`);
}
