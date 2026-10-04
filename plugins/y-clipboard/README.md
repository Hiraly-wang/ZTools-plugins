# Y剪贴板

> ZTools 剪贴板历史管理插件 · Vue 3 + TypeScript + Vite

分类清晰、响应飞快的剪贴板管理：文本 / 链接 / 代码 / 颜色 / 图片 / 文件自动分类，支持收藏、搜索与全键盘操作。

## 功能

- **自动分类**：复制的内容按 文本 / 链接 / 代码 / 颜色值 / 图片 / 文件 自动归类，侧栏一键切换
- **即搜即得**：本地过滤即时出结果，同时防抖调用宿主搜索补充全量历史
- **收藏**：星标记录存入插件独立存储（dbStorage），原历史被清空也不丢
- **键盘流**：`↑` `↓` 选择 · `Enter` 复制并粘贴到原窗口 · `Delete` 删除 · `Esc` 退出
- **主题适配**：跟随 ZTools 浅色 / 深色主题与主题强调色
- **虚拟滚动**：固定行高窗口化渲染，千条记录依然流畅

## 开发

```bash
npm install
npm run dev     # 浏览器打开 http://localhost:5173（自动使用 mock 数据）
npm run build   # 构建到 src-ztools/dist/
```

- 真实环境：ZTools 主窗口输入 `剪贴板` / `clipboard` / `clip` 触发
- 开发模式：`plugin.json` 的 `development.main` 指向 dev server，改代码即时热更新

## 结构

```
├── plugin.json            # 插件配置（功能入口、触发指令）
├── preload/services.js    # 预加载脚本（CommonJS，不可打包压缩）
└── src/
    ├── api.ts             # 宿主 API 封装 + 字段归一化 + 开发 mock
    ├── types.ts           # 类型定义
    ├── utils/format.ts    # 分类判定、时间格式化
    ├── composables/useStore.ts  # 状态：分页加载 / 搜索 / 收藏 / 键盘导航
    └── components/        # Sidebar / Toolbar / VirtualList / ClipboardItem
```

## 发布

```bash
git add . && git commit -m "feat: clipboard plugin"
ztools publish
```
