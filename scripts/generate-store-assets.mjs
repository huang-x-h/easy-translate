import { mkdir, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outRoot = 'assets/store';
const iconPath = 'public/icons/icon-128.png';
const logoData = (await readFile(iconPath)).toString('base64');
const logoHref = `data:image/png;base64,${logoData}`;

const colors = {
  ink: '#111827',
  muted: '#64748b',
  soft: '#f8fafc',
  line: '#e2e8f0',
  blue: '#2563eb',
  cyan: '#0ea5e9',
  pink: '#ec4c8c',
  green: '#10b981',
  amber: '#f59e0b',
};

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function card(x, y, w, h, r = 16, fill = '#ffffff', stroke = colors.line) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" />`;
}

function text(content, x, y, size, fill = colors.ink, weight = 600, extra = '') {
  return `<text x="${x}" y="${y}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${esc(content)}</text>`;
}

function pill(content, x, y, fill, color = '#ffffff') {
  return `
    <rect x="${x}" y="${y}" width="${Math.max(112, content.length * 9 + 28)}" height="34" rx="17" fill="${fill}" />
    ${text(content, x + 14, y + 23, 14, color, 700)}
  `;
}

function browserFrame(x, y, w, h, body) {
  return `
    ${card(x, y, w, h, 20, '#ffffff', '#dbe3ef')}
    <rect x="${x}" y="${y}" width="${w}" height="54" rx="20" fill="#f1f5f9" />
    <rect x="${x}" y="${y + 34}" width="${w}" height="20" fill="#f1f5f9" />
    <circle cx="${x + 28}" cy="${y + 27}" r="6" fill="#f87171" />
    <circle cx="${x + 50}" cy="${y + 27}" r="6" fill="#fbbf24" />
    <circle cx="${x + 72}" cy="${y + 27}" r="6" fill="#34d399" />
    <rect x="${x + 104}" y="${y + 16}" width="${w - 138}" height="22" rx="11" fill="#ffffff" stroke="#dbe3ef" />
    ${body}
  `;
}

function popupMock(x, y, w, includePronunciation = false) {
  return `
    ${card(x, y, w, includePronunciation ? 270 : 230, 18, '#ffffff', '#d7deea')}
    <rect x="${x}" y="${y}" width="${w}" height="48" rx="18" fill="#ffffff" />
    <rect x="${x}" y="${y + 32}" width="${w}" height="16" fill="#ffffff" />
    <image href="${logoHref}" x="${x + 18}" y="${y + 14}" width="22" height="22" />
    ${text('EasyTranslate', x + 50, y + 31, 15, colors.ink, 700)}
    <line x1="${x}" y1="${y + 48}" x2="${x + w}" y2="${y + 48}" stroke="#edf2f7" />
    <rect x="${x + 18}" y="${y + 66}" width="${w - 36}" height="54" rx="10" fill="#f8fafc" />
    ${text(includePronunciation ? 'knowledge' : 'Select text on any webpage', x + 34, y + 99, 17, '#475569', 600)}
    ${includePronunciation ? `
      ${text('Pronunciation', x + 34, y + 146, 14, colors.muted, 600)}
      ${text('/ˈnɑːlɪdʒ/', x + 142, y + 146, 18, colors.ink, 700)}
      <circle cx="${x + w - 48}" cy="${y + 139}" r="15" fill="#eef2ff" />
      <path d="M${x + w - 54} ${y + 134}v10h6l8 6v-22l-8 6z" fill="${colors.blue}" />
    ` : ''}
    <rect x="${x + 18}" y="${includePronunciation ? y + 166 : y + 138}" width="${w - 36}" height="54" rx="10" fill="#eff6ff" />
    ${text(includePronunciation ? 'knowledge; learning' : 'Translate selected text instantly', x + 34, includePronunciation ? y + 199 : y + 171, 17, '#1e3a8a', 700)}
    <rect x="${x + 18}" y="${includePronunciation ? y + 236 : y + 194}" width="92" height="30" rx="8" fill="#f1f5f9" />
    ${text('Copy', x + 48, includePronunciation ? y + 256 : y + 214, 13, '#334155', 700)}
  `;
}

function bilingualMock(x, y, w, rows = 4) {
  let body = '';
  for (let i = 0; i < rows; i++) {
    const yy = y + i * 112;
    body += `
      <rect x="${x}" y="${yy}" width="${w}" height="34" rx="8" fill="#ffffff" />
      <rect x="${x}" y="${yy + 8}" width="${w - 70 - i * 24}" height="10" rx="5" fill="#cbd5e1" />
      <rect x="${x}" y="${yy + 58}" width="${w}" height="42" rx="10" fill="#e0f2fe" />
      <rect x="${x + 16}" y="${yy + 73}" width="${w - 102 - i * 18}" height="10" rx="5" fill="#0284c7" opacity="0.75" />
    `;
  }
  return body;
}

async function renderPng(file, width, height, body) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f8fbff" />
          <stop offset="0.55" stop-color="#eef7ff" />
          <stop offset="1" stop-color="#fff4fa" />
        </linearGradient>
        <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${colors.blue}" />
          <stop offset="1" stop-color="${colors.cyan}" />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0f172a" flood-opacity="0.14" />
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)" />
      <circle cx="${width - 120}" cy="100" r="160" fill="#dbeafe" opacity="0.55" />
      <circle cx="110" cy="${height - 90}" r="180" fill="#fce7f3" opacity="0.50" />
      ${body}
    </svg>
  `;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

async function makeIcon() {
  await mkdir(path.join(outRoot, 'icons'), { recursive: true });
  await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: await sharp(iconPath).resize(96, 96).png().toBuffer(), left: 16, top: 16 }])
    .png()
    .toFile(path.join(outRoot, 'icons', 'store-icon-128.png'));
}

async function makeScreenshots() {
  const dir = path.join(outRoot, 'screenshots');
  await mkdir(dir, { recursive: true });

  await renderPng(path.join(dir, '01-selection-translation.png'), 1280, 800, `
    ${text('Translate selected text without leaving the page', 88, 112, 42, colors.ink, 800)}
    ${text('A focused floating popup keeps reading flow intact.', 92, 156, 22, colors.muted, 500)}
    <g filter="url(#shadow)">
      ${browserFrame(86, 210, 720, 470, `
        <rect x="130" y="300" width="410" height="18" rx="9" fill="#cbd5e1" />
        <rect x="130" y="344" width="540" height="18" rx="9" fill="#cbd5e1" />
        <rect x="130" y="388" width="310" height="18" rx="9" fill="#cbd5e1" />
        <rect x="126" y="338" width="332" height="30" rx="8" fill="#bfdbfe" opacity="0.95" />
        <circle cx="474" cy="384" r="22" fill="#ffffff" stroke="#dbe3ef" />
        <image href="${logoHref}" x="462" y="372" width="24" height="24" />
      `)}
      ${popupMock(702, 312, 430, false)}
    </g>
    ${pill('Selection popup', 92, 654, colors.blue)}
    ${pill('Copy translation', 254, 654, colors.green)}
  `);

  await renderPng(path.join(dir, '02-word-pronunciation.png'), 1280, 800, `
    ${text('English word pronunciation built in', 88, 112, 44, colors.ink, 800)}
    ${text('Single-word selections show IPA and optional audio playback.', 92, 158, 22, colors.muted, 500)}
    <g filter="url(#shadow)">
      ${browserFrame(92, 220, 640, 430, `
        <rect x="138" y="310" width="470" height="18" rx="9" fill="#cbd5e1" />
        <rect x="138" y="358" width="112" height="32" rx="8" fill="#bfdbfe" />
        ${text('knowledge', 152, 381, 18, '#1e3a8a', 800)}
        <rect x="270" y="366" width="330" height="14" rx="7" fill="#cbd5e1" />
      `)}
      ${popupMock(694, 278, 448, true)}
    </g>
    ${pill('IPA notation', 92, 668, colors.pink)}
    ${pill('Audio button', 238, 668, colors.blue)}
  `);

  await renderPng(path.join(dir, '03-bilingual-reading.png'), 1280, 800, `
    ${text('Turn web pages into bilingual reading', 88, 112, 44, colors.ink, 800)}
    ${text('Translate paragraph by paragraph and keep the original context visible.', 92, 158, 22, colors.muted, 500)}
    <g filter="url(#shadow)">
      ${browserFrame(120, 220, 1040, 470, `
        <rect x="176" y="306" width="352" height="20" rx="10" fill="#94a3b8" />
        ${bilingualMock(176, 360, 820, 3)}
        <rect x="1034" y="310" width="66" height="300" rx="12" fill="#f1f5f9" />
        <rect x="1054" y="336" width="26" height="118" rx="13" fill="#bfdbfe" />
      `)}
    </g>
    ${pill('Paragraph translation', 92, 692, colors.blue)}
    ${pill('Original context preserved', 304, 692, colors.green)}
  `);

  await renderPng(path.join(dir, '04-extension-popup.png'), 1280, 800, `
    ${text('One-click page translation controls', 88, 112, 44, colors.ink, 800)}
    ${text('Use the toolbar popup or Alt+T to translate the current page.', 92, 158, 22, colors.muted, 500)}
    <g filter="url(#shadow)">
      ${browserFrame(110, 224, 700, 438, `
        <rect x="160" y="310" width="430" height="18" rx="9" fill="#cbd5e1" />
        <rect x="160" y="354" width="500" height="18" rx="9" fill="#cbd5e1" />
        <rect x="160" y="398" width="320" height="18" rx="9" fill="#cbd5e1" />
        <rect x="690" y="70" width="46" height="46" rx="12" fill="#ffffff" stroke="#dbe3ef" />
      `)}
      ${card(742, 232, 350, 352, 20, '#ffffff', '#d7deea')}
      <image href="${logoHref}" x="772" y="262" width="48" height="48" />
      ${text('EasyTranslate', 836, 288, 20, colors.ink, 800)}
      ${text('AI bilingual reading', 836, 312, 14, colors.muted, 500)}
      <rect x="772" y="340" width="290" height="46" rx="12" fill="#eff6ff" stroke="#dbeafe" />
      <circle cx="795" cy="363" r="6" fill="${colors.green}" />
      ${text('Ready to translate', 814, 369, 15, '#1e3a8a', 700)}
      <rect x="772" y="414" width="290" height="48" rx="12" fill="url(#brand)" />
      ${text('Translate current page', 828, 444, 16, '#ffffff', 800)}
      <rect x="772" y="478" width="290" height="44" rx="12" fill="#f8fafc" stroke="#e2e8f0" />
      ${text('Open settings', 866, 506, 15, '#334155', 700)}
    </g>
  `);

  await renderPng(path.join(dir, '05-settings.png'), 1280, 800, `
    ${text('Use your preferred AI translation provider', 88, 112, 44, colors.ink, 800)}
    ${text('Configure an OpenAI-compatible endpoint, API key, model, and target language.', 92, 158, 22, colors.muted, 500)}
    <g filter="url(#shadow)">
      ${card(180, 214, 920, 482, 22, '#ffffff', '#d7deea')}
      ${text('EasyTranslate Settings', 230, 280, 28, colors.ink, 800)}
      ${text('Translation service', 232, 340, 16, colors.muted, 700)}
      <rect x="232" y="362" width="250" height="82" rx="14" fill="#eff6ff" stroke="#60a5fa" />
      ${text('Zhipu AI', 256, 396, 18, colors.ink, 800)}
      ${text('Chinese optimized', 256, 422, 14, colors.muted, 500)}
      <rect x="502" y="362" width="250" height="82" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      ${text('Custom endpoint', 526, 396, 18, colors.ink, 800)}
      ${text('OpenAI-compatible', 526, 422, 14, colors.muted, 500)}
      ${text('API Endpoint', 232, 488, 15, '#334155', 700)}
      <rect x="232" y="506" width="760" height="42" rx="10" fill="#f8fafc" stroke="#d1d5db" />
      ${text('https://open.bigmodel.cn/api/paas/v4', 252, 533, 15, colors.muted, 500)}
      ${text('Model', 232, 584, 15, '#334155', 700)}
      <rect x="232" y="602" width="360" height="42" rx="10" fill="#f8fafc" stroke="#d1d5db" />
      ${text('glm-4-flash', 252, 629, 15, colors.muted, 500)}
      <rect x="760" y="602" width="232" height="46" rx="12" fill="url(#brand)" />
      ${text('Save settings', 822, 632, 16, '#ffffff', 800)}
    </g>
  `);
}

async function makePromo() {
  const dir = path.join(outRoot, 'promo');
  await mkdir(dir, { recursive: true });

  await renderPng(path.join(dir, 'small-promo-440x280.png'), 440, 280, `
    <image href="${logoHref}" x="34" y="34" width="72" height="72" />
    ${text('EasyTranslate', 122, 74, 30, colors.ink, 800)}
    ${text('AI translation for reading', 124, 102, 15, colors.muted, 600)}
    ${card(42, 140, 356, 92, 20, '#ffffff', '#dbe3ef')}
    <rect x="66" y="166" width="112" height="18" rx="9" fill="#bfdbfe" />
    <rect x="66" y="197" width="178" height="14" rx="7" fill="#cbd5e1" />
    <circle cx="202" cy="174" r="18" fill="#ffffff" stroke="#dbe3ef" />
    <image href="${logoHref}" x="192" y="164" width="20" height="20" />
    <rect x="278" y="154" width="92" height="34" rx="17" fill="${colors.blue}" />
    ${text('Select', 301, 176, 14, '#ffffff', 800)}
    <rect x="278" y="196" width="92" height="34" rx="17" fill="${colors.green}" />
    ${text('Read', 310, 218, 14, '#ffffff', 800)}
  `);

  await renderPng(path.join(dir, 'marquee-promo-1400x560.png'), 1400, 560, `
    <image href="${logoHref}" x="90" y="88" width="92" height="92" />
    ${text('EasyTranslate', 208, 130, 54, colors.ink, 850)}
    ${text('AI-powered selection and bilingual page translation', 212, 176, 24, colors.muted, 600)}
    ${pill('Selection popup', 214, 224, colors.blue)}
    ${pill('Word pronunciation', 396, 224, colors.pink)}
    ${pill('Bilingual reading', 612, 224, colors.green)}
    <g filter="url(#shadow)">
      ${browserFrame(820, 88, 470, 352, `
        <rect x="860" y="178" width="260" height="14" rx="7" fill="#cbd5e1" />
        <rect x="860" y="216" width="312" height="14" rx="7" fill="#cbd5e1" />
        <rect x="856" y="208" width="196" height="26" rx="8" fill="#bfdbfe" />
        <circle cx="1068" cy="256" r="20" fill="#ffffff" stroke="#dbe3ef" />
        <image href="${logoHref}" x="1057" y="245" width="22" height="22" />
      `)}
      ${popupMock(970, 218, 308, true)}
    </g>
  `);
}

await mkdir(outRoot, { recursive: true });
await makeIcon();
await makeScreenshots();
await makePromo();
await copyFile(iconPath, path.join(outRoot, 'icons', 'source-icon-128.png'));

console.log('Generated Chrome Web Store assets in assets/store');
