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
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
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
        ['content', 'background'].forEach(name => {
          const entryPath = `dist/${name}.js`;
          if (!existsSync(entryPath)) return;
          
          let content = readFileSync(entryPath, 'utf-8');
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
            const importRegex = /import\s*(?:(\{[^}]+\}|\*\s+as\s+\w+|\w+)\s*from\s*["']([^"']+)["'];?)/g;
            let match;
            
            while ((match = importRegex.exec(content)) !== null) {
              const importPath = match[2];
              // 只处理相对路径（assets chunk）
              if (!importPath.startsWith('./assets/')) continue;
              
              const fullPath = `dist/${importPath}`;
              if (existsSync(fullPath)) {
                const importContent = readFileSync(fullPath, 'utf-8');
                // 移除 export 语句
                let inlined = importContent
                  .replace(/export\s*\{[^}]*\};?/g, '')
                  .replace(/export\s+default\s+/g, '');
                content = content.replace(match[0], inlined + ';');
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
