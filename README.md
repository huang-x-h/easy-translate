# 沉浸式翻译 - 浏览器翻译插件

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

1. **安装依赖**
   ```bash
   npm install
   ```

2. **开发模式**
   ```bash
   npm run dev
   ```

3. **构建生产版本**
   ```bash
   npm run build
   ```

4. **加载到 Chrome**
   - 打开 `chrome://extensions/`
   - 开启开发者模式
   - 点击"加载已解压的扩展程序"
   - 选择 `dist` 目录

## 配置说明

首次使用需要配置 API Key：

1. 点击扩展图标 → "打开设置"
2. 选择翻译服务（Groq、OpenRouter 或自定义）
3. 输入 API Key
4. 保存设置

### 推荐免费 API 服务

- **Groq**：https://console.groq.com（速度快，有免费额度）
- **OpenRouter**：https://openrouter.ai（模型选择多）

## 快捷键

- `Alt + T`：翻译/恢复当前页面
- `Esc`：关闭翻译弹窗

## 项目结构

```
src/
├── background/      # Service Worker
├── content/         # 内容脚本
│   ├── index.ts     # 入口
│   ├── popup.ts     # 划词翻译弹窗
│   ├── bilingual.ts # 双语翻译
│   └── readability.ts # 正文提取
├── popup/           # 扩展弹出窗口
├── options/         # 设置页面
└── shared/          # 共享代码
    ├── types.ts     # TypeScript 类型
    ├── api.ts       # 翻译 API
    └── storage.ts   # 存储管理
```

## License

MIT
