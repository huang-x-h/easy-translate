# 沉浸式翻译 - 快速开始指南

## 📦 项目结构

```
translate-extension/
├── src/
│   ├── background/           # Service Worker (后台脚本)
│   │   └── index.ts         # 处理消息、快捷键、安装逻辑
│   ├── content/              # 内容脚本 (注入网页)
│   │   ├── index.ts         # 入口，处理选中文本、键盘事件
│   │   ├── styles.css       # 注入页面的样式
│   │   ├── popup.ts         # 划词翻译浮窗 UI
│   │   ├── bilingual.ts     # 整页双语对照翻译
│   │   └── readability.ts   # 正文提取算法
│   ├── popup/                # 扩展弹出窗口
│   │   ├── index.html
│   │   └── index.ts
│   ├── options/              # 设置页面
│   │   ├── index.html
│   │   └── index.ts
│   └── shared/               # 共享代码
│       ├── types.ts         # TypeScript 类型
│       ├── api.ts           # OpenAI API 封装
│       └── storage.ts       # chrome.storage 封装
├── public/
│   ├── manifest.json        # Chrome 扩展配置
│   └── icons/               # 扩展图标 (需要添加)
├── package.json             # npm 配置
├── vite.config.ts          # Vite 构建配置
├── tsconfig.json           # TypeScript 配置
├── CONTEXT.md              # 领域术语文档
└── README.md               # 项目说明
```

## 🚀 快速启动

### 1. 安装依赖

```bash
npm install
```

### 2. 开发模式

```bash
npm run dev
```

### 3. 构建生产版本

```bash
npm run build
```

### 4. 加载到 Chrome

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择项目的 `dist` 文件夹

## ⚙️ 首次配置

1. 点击浏览器工具栏的扩展图标 (🌐)
2. 点击「打开设置」
3. 选择翻译服务（推荐 Groq）
4. 申请 API Key：
   - **Groq**: https://console.groq.com/keys
   - 注册账号 → 创建 API Key → 复制
5. 粘贴 API Key 到设置页面
6. 点击「保存设置」

## ⌨️ 使用方式

| 操作 | 方式 |
|------|------|
| **划词翻译** | 选中文字 → 点击出现的 🌐 按钮 |
| **整页翻译** | 点击扩展图标 → 「翻译当前页面」或按 `Alt+T` |
| **恢复原页面** | 再次点击扩展图标或按 `Alt+T` |
| **关闭弹窗** | 按 `Esc` 键 |

## 🛠️ 开发调试

### 查看控制台

- **Background**: `chrome://extensions/` → 点击「背景页」
- **Content Script**: 在网页上按 F12 → Console → 筛选 `immersive-translate`
- **Popup**: 右键扩展图标 → 检查弹出内容

### 热更新

开发模式下修改代码后，需要：
1. 在 `chrome://extensions/` 页面点击刷新按钮
2. 刷新目标网页

## 📋 核心功能实现

### 划词翻译流程
```
选中文本 → 显示浮动按钮 → 点击 → 调用 API → 显示弹窗 → 缓存结果
```

### 双语对照流程
```
提取正文 → 分段 → 并行翻译 → 插入译文段落 → 原文译文交替显示
```

### 缓存策略
- Key: `hash(text + targetLang)`
- TTL: 7天
- 存储: `chrome.storage.local`

## 🔧 自定义配置

在 `src/shared/types.ts` 中修改默认配置：

```typescript
export const DEFAULT_CONFIG: TranslationConfig = {
  apiEndpoint: 'https://api.groq.com/openai/v1',
  apiKey: '',
  targetLang: 'zh-CN',
  model: 'llama-3.1-8b-instant',
  translationStyle: 'natural',
};
```

## 📝 添加图标

创建图标文件（PNG 格式）：
```
public/icons/
├── icon16.png   (16x16)
├── icon32.png   (32x32)
├── icon48.png   (48x48)
└── icon128.png  (128x128)
```

可以使用在线工具生成：
- https://favicon.io/
- 或任何设计工具导出 PNG

## 🐛 常见问题

### Q: 划词后没有出现按钮？
A: 检查内容脚本是否注入，刷新页面重试。

### Q: API 调用失败？
A: 检查 API Key 是否正确，网络是否通畅，CORS 是否支持。

### Q: 样式被页面覆盖？
A: 使用了 Shadow DOM 隔离样式，如有问题检查 `styles.css` 中的 `!important` 规则。

## 📚 下一步

- [ ] 添加 Readability.js npm 包替换简化版提取算法
- [ ] 添加更多翻译服务支持（DeepL、Google 等）
- [ ] 添加暗黑模式支持
- [ ] 添加导出翻译功能
- [ ] 添加划词翻译的流式响应

---

**开始开发吧！** 有任何问题随时问我。
