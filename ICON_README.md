# EasyTranslate 图标设置

## 方法 1: 使用图标生成器（推荐）

1. 在浏览器中打开 `generate-icons.html`
2. 点击各尺寸的"下载 PNG"按钮
3. 将下载的文件放入 `public/icons/` 目录：
   - `logo.png` (128x128) - 主要图标

## 方法 2: 使用自己的图标

将你的 `logo.png` 文件放到 `public/icons/` 目录：

```bash
mkdir -p public/icons
cp your-logo.png public/icons/logo.png
```

图标要求：
- 格式: PNG
- 尺寸: 建议 128x128 或更大
- 背景: 可以是透明或纯色
- Chrome 会自动缩放

## 方法 3: 使用在线工具

1. 访问 https://www.canva.com/ 或 https://www.figma.com/
2. 创建 128x128 的图标设计
3. 导出为 PNG
4. 放入 `public/icons/logo.png`

## 重新构建

添加图标后，重新构建：

```bash
npm run build
```

然后在 Chrome 中加载 `dist/` 目录。
