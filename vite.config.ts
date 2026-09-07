import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    // 禁用压缩，保持原始变量名，避免内联后名称不匹配
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        // IIFE bundles for tests — jsdom can't import './assets/...' modules,
        // so we produce standalone scripts that expose their classes on
        // globalThis for the test harness.
        'test-vocabulary': resolve(__dirname, 'src/shared/vocabulary.test-entry.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Test entries are bundled as standalone IIFEs so jsdom can
          // `window.eval()` them. Everything else stays as ES modules
          // (vite emits them as ESM by default).
          if (chunkInfo.name?.startsWith('test-')) {
            return '[name].iife.js';
          }
          return '[name].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        // Deterministic chunk names for shared modules. Without this, rollup
        // reassigns symbols to chunks based on which entry pulls them in
        // first (e.g. adding speech.ts merged vocabulary into a "speech"-
        // named chunk), which breaks the tests that locate chunks by name.
        // Pinning each shared module to its own chunk keeps names stable.
        manualChunks: (id) => {
          if (!id.includes('node_modules') && id.includes('src/shared/')) {
            const base = id.split('src/shared/')[1].split('/')[0].replace(/\.ts$/, '');
            if (base) return `shared-${base}`;
          }
          return undefined;
        },
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name || '';
          if (info.endsWith('.css')) {
            return '[name][extname]';
          }
          if (info.endsWith('.png') || info.endsWith('.svg') || info.endsWith('.jpg')) {
            return 'icons/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  plugins: [
    {
      name: 'copy-manifest-and-icons',
      closeBundle() {
        if (existsSync('public/manifest.json')) {
          copyFileSync('public/manifest.json', 'dist/manifest.json');
          console.log('Copied manifest.json');
        }
        if (existsSync('public/icons/logo.png')) {
          if (!existsSync('dist/icons')) {
            mkdirSync('dist/icons', { recursive: true });
          }
          copyFileSync('public/icons/logo.png', 'dist/icons/logo.png');
          console.log('Copied logo.png');
        }
      }
    },
    {
      name: 'inline-shared-chunks',
      closeBundle() {
        // 修复 content.js 和 background.js 中的 import 语句
        // Rollup 把 chunks 写到 dist/assets/ 下，所以 chunk 之间的 import
        // 既可能是 "./assets/xxx.js"（入口层），也可能是 "./xxx.js"
        // （被内联后的 chunk 里再次出现的相对路径）。
        const resolveChunkPath = (importPath) => {
          const candidates = [
            `dist/${importPath}`,
            `dist/assets/${importPath.replace(/^\.\//, '')}`,
            `dist/assets/${importPath.replace(/^\.\/assets\//, '')}`,
          ];
          for (const candidate of candidates) {
            if (existsSync(candidate)) return candidate;
          }
          return null;
        };

        ['content', 'background', 'test-vocabulary'].forEach(name => {
          const entryCandidates = [
            `dist/${name}.js`,
            `dist/${name}.iife.js`,
          ];
          const entryPath = entryCandidates.find(p => existsSync(p));
          if (!entryPath) return;

          let content = readFileSync(entryPath, 'utf-8');
          const inlined = new Set();
          let hasChanges = true;
          let iterations = 0;
          const maxIterations = 10; // 防止无限循环（多层嵌套）

          // 循环处理，直到没有更多 import
          while (hasChanges && iterations < maxIterations) {
            hasChanges = false;
            iterations++;

            // 匹配所有 import 语句
            // 格式: import { A, B as C } from "./assets/xxx.js";
            // 也支持: import A from "xxx"; import * as A from "xxx";
            // 以及: import "./side-effect.js";
            const importRegex = /import\s*(?:(\{[^}]+\}|\*\s+as\s+\w+|\w+)\s*from\s*)?["']([^"']+)["'];?/g;
            let match;

            while ((match = importRegex.exec(content)) !== null) {
              const importPath = match[2];
              if (!importPath.startsWith('./')) continue;
              // 归一化为 basename，确保 "./storage-x.js" 和
              // "./assets/storage-x.js" 被视作同一个 chunk。
              const normalized = `./${importPath.replace(/^\.\/(?:assets\/)?/, '')}`;
              if (inlined.has(normalized)) {
                // 已经内联过同名 chunk，移除这条冗余 import 避免重复声明。
                content = content.replace(match[0], '');
                hasChanges = true;
                continue;
              }

              const fullPath = resolveChunkPath(importPath);
              if (fullPath) {
                const importContent = readFileSync(fullPath, 'utf-8');
                // 移除 export 语句
                let inlinedBody = importContent
                  .replace(/export\s*\{[^}]*\};?/g, '')
                  .replace(/export\s+default\s+/g, '');
                content = content.replace(match[0], inlinedBody + ';');
                inlined.add(normalized);
                hasChanges = true;
                console.log(`Inlined ${importPath} into ${name}.js`);
              }
            }
          }

          writeFileSync(entryPath, content);
          console.log(`Fixed imports in ${name}.js (${iterations} passes)`);
        });
      }
    }
  ]
});
