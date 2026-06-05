# EasyTranslate - AI 驱动的双语阅读

一个类似沉浸式翻译的浏览器扩展，支持划词翻译和双语对照阅读。

## 功能特性

- 🎯 **划词翻译**：选中文本后点击浮动按钮，即时翻译
- 📖 **双语对照**：整页翻译，原文与译文段落对照显示
- 🤖 **AI 驱动**：支持 OpenAI 兼容 API（Groq、OpenRouter、Ollama 等）
- ⚡ **快速响应**：流式翻译显示，缓存已翻译内容
- 🔒 **隐私安全**：API Key 本地存储，支持 HTTPS

## 技术栈

- Manifest V3
- TypeScript
- Shadow DOM + Web Components
- Vite 构建工具

## 安装使用

### 环境要求

- Node.js 18+
- Chromium 内核浏览器（Chrome、Edge、Arc 等）

### 1. 下载源码

```bash
git clone https://github.com/huangxinghui/translate-extension.git
cd translate-extension
```

### 2. 安装依赖

```bash
npm install
```

### 3. 构建插件

```bash
# 生产构建
npm run build

# 或开发模式（带热更新）
npm run dev
```

构建完成后，会在项目根目录生成 `dist/` 文件夹。

### 4. 加载到浏览器

#### Chrome / Edge

1. 打开浏览器，地址栏输入 `chrome://extensions/`（Edge 为 `edge://extensions/`）
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目中的 `dist` 目录

![加载扩展示意图](docs/install-step.png)

#### 加载成功标志

- 浏览器工具栏出现扩展图标（🌐）
- 点击图标弹出设置面板，说明加载成功

### 5. 配置 API Key（首次使用必须）

1. 点击浏览器工具栏上的扩展图标 → 选择「打开设置」
2. 选择翻译服务提供商：
   - **Groq**（推荐，速度快，有免费额度）
   - **OpenRouter**（模型选择多）
   - **自定义**（Ollama 本地部署或其他 OpenAI 兼容服务）
3. 填入对应的 API Key
4. 选择目标语言（默认：中文简体）
5. 点击「保存设置」

#### 推荐免费 API 服务

| 服务           | 网址                     | 特点                   |
| -------------- | ------------------------ | ---------------------- |
| **Groq**       | https://console.groq.com | 速度极快，免费额度充足 |
| **OpenRouter** | https://openrouter.ai    | 支持模型多，按需付费   |
| **Ollama**     | http://localhost:11434   | 本地运行，完全免费     |

### 6. 开始使用

#### 划词翻译

1. 在任意网页上选中一段文本（≥1 个字符）
2. 选区附近会出现一个粉色浮动按钮（🌐）
3. 点击按钮，弹出翻译结果弹窗
4. 弹窗中可「复制译文」或「交换」原文/译文

> 💡 点击页面空白处或按 `Esc` 可关闭弹窗

#### 整页双语翻译

1. 打开任意有可读内容的网页
2. 按快捷键 `Alt + T`，或点击扩展图标选择「翻译页面」
3. 页面每段原文下方会插入对应的译文段落
4. 再次按 `Alt + T` 可恢复原始页面

> 💡 翻译过程中按 `Esc` 可取消

## 快捷键

| 快捷键    | 功能                        |
| --------- | --------------------------- |
| `Alt + T` | 翻译/恢复当前页面           |
| `Esc`     | 关闭翻译弹窗 / 取消整页翻译 |

## 运行测试

```bash
# 运行回归测试（验证 Twitter/X 等社交平台 DOM 解析）
npm test
```

测试脚本使用 JSDOM 模拟浏览器 DOM 环境，验证段落提取逻辑在各类页面结构下的正确性。

## 项目结构

```
src/
├── background/      # Service Worker（后台服务）
│   └── index.ts
├── content/         # 内容脚本（注入网页）
│   ├── index.ts     # 入口，监听消息和快捷键
│   ├── popup.ts     # 划词翻译弹窗
│   ├── bilingual.ts # 整页双语翻译引擎
│   ├── readability.ts # 正文提取（基于 Mozilla Readability）
│   └── styles.css   # 内容脚本样式
├── popup/           # 扩展弹出窗口（点击图标）
│   ├── index.html
│   └── index.ts
├── options/         # 设置页面
│   ├── index.html
│   └── index.ts
└── shared/          # 共享代码
    ├── types.ts     # TypeScript 类型定义
    ├── api.ts       # 翻译 API 调用
    └── storage.ts   # 浏览器存储管理
```

## 常见问题

**Q：为什么翻译 Twitter/X 页面提示「页面没有可翻译的内容」？**

A：Twitter/X 的推文文本使用 `div` 标签包裹，旧版提取器将其视为容器而跳过。已在 [d026cad](https://github.com/huangxinghui/translate-extension/commit/d026cad) 修复，支持通过 `data-testid="tweetText"` 等平台标记识别 div 文本容器。

**Q：插件在某些页面报错 "The provided markup is invalid XML"？**

A：XHTML 文档要求 `innerHTML` 传入良构 XML。已在 [d026cad](https://github.com/huangxinghui/translate-extension/commit/d026cad) 修复，将所有 `<img>`、`<br>` 等空元素改为自闭合形式。

**Q：支持 Firefox / Safari 吗？**

A：当前仅支持 Chromium 内核浏览器（Chrome、Edge、Brave、Arc 等）。Firefox 需要额外适配 Manifest V2/V3 差异，计划后续支持。

## License

MIT
