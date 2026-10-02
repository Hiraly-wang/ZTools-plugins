# 解除占用

ZTools 插件 — 用 **witr 式因果溯源**解释「谁在占用 / 为什么在跑」，再附加 **kill** 解除占用。另附文件粉碎、端口检测。仅支持 Windows。

## 使用方式

### 关键字启动

| 关键字 | 功能 |
|---|---|
| `解除占用` | 打开解除占用标签页 |
| `文件粉碎` | 打开文件粉碎标签页 |
| `端口检测` | 打开端口检测标签页 |

### 拖拽启动

将文件或目录拖到 ZTools 搜索框，选择「解除占用」即可直接带入路径并自动扫描。

## 诊断思路（对齐 witr）

```text
文件/端口
   ↓  确证持有者（witr --file / 重启管理器，不用 cmdline 猜测）
PID
   ↓  溯源解释它为什么在运行（启动链 + 来源）
启动链: explorer.exe (1) → pwsh.exe (20) → node.exe (80)
来源: 交互式 Shell · pwsh.exe
   ↓  用户确认后再附加动作
结束进程 / 粉碎
   ↓  闭环验证：文件能重新独占打开才算真的解除
已解除占用 / 仍被占用（并列出剩余占用者）
```

- **先解释，再动手**：进程卡片展示「它是怎么跑起来的」启动链与来源（服务 / Shell / 计划任务…），结束进程是附加操作。
- **只确证，不猜测**：占用者来自重启管理器或 witr；不再用命令行子串 / 「可疑 java·node」启发式误报。
- **双引擎溯源**：优先调用 [witr](https://github.com/pranshuparmar/witr)（`--pid --json`）；未安装时回退到原生 PowerShell 祖先链 + Windows 服务识别。
- **结束后闭环验证**：结束进程后轮询探测文件是否已能独占打开，只在确认解除后才提示成功；仍被占用时会告诉你还剩谁在占用。
- **提示分级、说人话**：成功 / 提示 / 注意 / 错误四级提示条；不暴露退出码、`engine=` 之类的调试字眼，需要排查时可展开底部「运行记录」。

## 功能

### 解除占用

检测哪些进程正在占用文件或目录，展示启动链与来源，支持单个或一键结束。结束时自动重启管理器句柄检测 + 结束后独占打开验证：只有确认解除才会提示成功，否则会指出「可能还有谁在占用」。

### 文件粉碎

安全删除文件或目录，粉碎模式会先用随机数据覆写再删除。占用时弹出确认，展示占用进程后可结束并重试；权限不足与文件被占用会分别提示，避免误以为是占用问题。

### 端口检测

查看指定端口的监听进程及启动链，支持一键结束。结束进程后会复查端口是否已释放，被其他进程接管时会明确提示。

## 可选依赖：witr（自动安装）

[witr](https://github.com/pranshuparmar/witr) 用于完整溯源（服务描述、容器、警告等），**会自动安装**：

1. `npm install` 时 postinstall 就绪 `public/preload/tools/witr.exe`（打包进插件作内置副本）
2. 运行时若在 `.asar` 内，会**自动释放**到真实路径 `%LOCALAPPDATA%\unlock-file\tools\witr.exe`（asar 内无法 `spawn`，直接跑会 ENOENT）
3. 内置副本不可用时自动从 GitHub 下载，失败再回退 `winget install PranshuParmar.witr`
4. 全部失败时使用原生 PowerShell 溯源，插件功能不受影响

手动强制重装：

```powershell
node scripts/install-witr.js --force
```

## 开发

```powershell
npm install          # 可选：下载 witr
npm run dev
npm run build
npm test             # node --test --test-concurrency=1 public/preload/*.test.js
```

测试覆盖：占用者检测（witr 与重启管理器双路径）、占用状态探测、结束后闭环验证、提示文案（不出现退出码等调试字眼）以及前端依赖的 preload 接口是否齐全。
