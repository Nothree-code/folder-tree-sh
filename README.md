# folder-tree-sh — DSH Web 工作区文件树插件

> **folder-tree-sh** is a browser plugin for the DeepSeek Harness (DSH) web interface. It adds a workspace file-tree panel beside the sidebar with:
>
> - **Preview** — text with automatic GBK fallback for legacy Chinese encodings; DOCX rendered with full layout (headings, tables, inline images via mammoth); Markdown with rendered preview plus inline editing, debounced autosave and 3 rolling `.dshbak` backups; syntax-highlighted code (18 languages); CSV shown as tables; images with Ctrl+wheel zoom; and PDF.
> - **Real file operations** — right-click menu for open containing folder, attach to chat, copy/cut/paste, rename (auto-appends "副本" on conflicts), delete (to Recycle Bin), and copy path. Double-click opens files or folders with the system default app.
> - **Polished UX** — the panel follows the workspace bar, is drag-resizable, remembers its width and open state, highlights the file being previewed, filters entries by name, and auto-refreshes every 5 seconds.
>
> **Requirements:** Windows · DSH 0.1.0-rc.x (web profile) · Node.js + pnpm

在 DSH Web 界面（http://127.0.0.1:3080）侧边栏提供**工作区文件树面板**，支持预览与文件操作。

## 功能

- 侧边栏文件树：跟随工作区栏宽度，可拖拽调宽（最小 280px），悬浮高亮；**宽度/开关状态自动记忆**（刷新页面不丢失）
- **当前预览文件高亮标记** + **文件名过滤框**（即时过滤）+ **每 5 秒自动刷新**目录
- 预览：文本 / docx / 图片 / PDF（文件上限 100MB，超大文件自动截断）
- **docx 预览**：完整排版还原（标题、加粗、列表、表格、图片内联），接近 Word/WPS 显示效果
- **markdown 预览与编辑**：语法渲染（标题、列表、表格、代码块、引用、链接）；「预览 / 编辑」切换，编辑时下方实时渲染，停止输入 0.8 秒自动保存（或 `Ctrl+S`），工具栏一键插入加粗/标题/表格等语法
- **代码语法高亮**：js/ts/json/python/yaml/html/css/shell/ps1/sql/java/c/cpp/cs/go/rust/ruby/php 等，关键字/字符串/注释/数字着色
- **csv 表格化预览**：自动识别逗号/分号/制表符，表头吸顶，引号转义解析
- **数据安全**：删除进回收站（可恢复）；markdown 每次保存自动保留 3 份 `.dshbak` 滚动备份（文件名带 `.dshbak.1/2/3`）；重命名/粘贴遇到同名自动加「(副本)」；中文 GBK 编码文本自动识别
- 图片预览：全宽显示 + `Ctrl+滚轮` 缩放（不影响页面缩放）
- 右键菜单（真实操作）：打开源文件夹、添加到聊天（图片 ≤4MB）、复制、剪切、粘贴、删除、重命名、复制路径
- 双击文件：用系统默认程序打开；双击目录：在资源管理器中打开该目录
- 布局：文件树插在工作区栏与对话之间，对话自动右移

## 前提条件

| 项目 | 要求 |
|---|---|
| 操作系统 | **Windows**（依赖 PowerShell 与 explorer.exe） |
| DSH | `dsh web` 可正常启动（0.1.0-rc.x 系列） |
| Node.js + pnpm | 用于安装本地包 |

## 安装步骤

1. **放置包目录**：把 `folder-tree-sh` 文件夹整体复制到
   `C:\Users\<你的用户名>\.dsh\profiles\web\packages\`
   （即 `packages` 下应出现 `packages\folder-tree-sh\package.json`）

2. **安装依赖**：在 `profiles\web` 目录打开终端，执行

   ```powershell
   pnpm add "file:./packages/folder-tree-sh"
   ```

   完成后 `profiles\web\node_modules\folder-tree-sh\` 应存在。

3. **挂载插件行**：编辑 `profiles\web\cordis.patch.yml`，**在文件末尾追加**：

   ```yaml
   - insert:
       - id: folder-tree-sh
         name: 'folder-tree-sh'
   ```

   （若文件已有其他 `- insert:` 块，把 `- id: folder-tree-sh` 两行追加进任一块即可，或直接追加新块）

4. **重启生效**：完全关闭 `dsh web` 进程，重新启动，刷新页面。

5. **验证**：侧边栏底部出现文件树开关 → 点击展开面板 → 目录、预览、右键菜单、双击打开均应可用。

## 常见问题

- **面板出现但目录空白**：说明宿主路由未注册，多为安装步骤 2/3 未完成，或 DSH 版本过旧（webServer 服务缺失）。
- **docx 预览失败**：需系统 PowerShell 5.1+ 可用（`powershell.exe` 在 PATH 中）。
- **右键"打开源文件夹"无效**：插件需以完整权限运行 shell；若你的 DSH 配置了受限沙箱策略，可能被拦截。

## 维护提示

安装后 `node_modules\folder-tree-sh` 是**实体目录拷贝**（非软链接）。修改 `packages\folder-tree-sh\` 下的文件后，可执行包内的 `sync.ps1` 一键同步（或手动复制），再重启 `dsh web` 生效。

## 已知限制

- 仅支持 Windows（macOS/Linux 需改写 host 端的 PowerShell 命令）
- 文件预览上限 100MB；"添加到聊天"仅支持图片且 ≤4MB（DSH 草稿框限制）
- 插件包名为 `folder-tree-sh`，可自行修改 package.json 中的 name 后使用（同步修改 cordis.patch.yml 的 name 字段）
