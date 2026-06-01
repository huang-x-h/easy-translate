import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const logoPath = resolve(rootDir, 'public/icons/logo.png');
const outputDir = resolve(rootDir, 'public/icons');

// 确保目录存在
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// 生成不同尺寸的图标
const sizes = [
  { name: 'logo', width: 48, height: 48 },
  { name: 'icon-16', width: 16, height: 16 },
  { name: 'icon-32', width: 32, height: 32 },
  { name: 'icon-48', width: 48, height: 48 },
  { name: 'icon-128', width: 128, height: 128 },
];

async function generateIcons() {
  console.log('Generating icons...');
  
  // 先缩小大图，避免内存问题
  const resizedLogo = resolve(outputDir, 'logo-resized.png');
  await sharp(logoPath)
    .resize(256, 256, { fit: 'cover' })
    .toFile(resizedLogo);
  console.log('Pre-resized logo to 256x256');
  
  for (const { name, width, height } of sizes) {
    await sharp(resizedLogo)
      .resize(width, height, { fit: 'cover' })
      .png({ quality: 80 })
      .toFile(resolve(outputDir, `${name}.png`));
    console.log(`Generated ${name}.png (${width}x${height})`);
  }
  
  // 生成 toolbar 图标 (19x19，符合 Chrome 规范)
  await sharp(resizedLogo)
    .resize(19, 19, { fit: 'cover' })
    .png({ quality: 80 })
    .toFile(resolve(outputDir, 'icon.png'));
  console.log('Generated icon.png (19x19)');
  
  console.log('Done!');
}

generateIcons().catch(console.error);