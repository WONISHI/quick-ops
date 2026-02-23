<p align="center">
    <img src="./icon.png" width="128" height="128" alt="quickOps Logo" />
</p>

<h1 align="center">quickOps</h1>

<p align="center">
    <a href="https://img.shields.io/visual-studio-marketplace/v/quick-ops.quick-ops">
        <img src="https://img.shields.io/visual-studio-marketplace/v/quick-ops.quick-ops?style=flat-square&label=Version&color=007ACC" alt="Version">
    </a>
    <a href="https://img.shields.io/visual-studio-marketplace/i/quick-ops.quick-ops">
        <img src="https://img.shields.io/visual-studio-marketplace/i/quick-ops.quick-ops?style=flat-square&label=Installs&color=green" alt="Installs">
    </a>
    <img src="https://img.shields.io/badge/License-MIT-orange.svg?style=flat-square" alt="License">
</p>

quickOps 是一个多功能的 VS Code 扩展，集成了代码标记、本地文件忽略、路径补全、本地 Mock 代理、调试辅助以及项目上下文导出等功能。旨在补充 VS Code 原生功能的不足，通过快捷指令和配置文件极大地优化前端及全栈的开发流程。

---

## 🚀 功能列表

### 1. 本地代理与 Mock 服务 (Proxy & Mock Server) 🔥
内置强大的可视化 Webview 面板，无需配置复杂的 Nginx 或跨域插件，直接在 VS Code 内管理 API 代理与数据 Mock。
- **全局代理转发**：一键配置本地端口与目标服务器，无缝解决本地开发跨域问题。
- **精准路由拦截**：通过严格路径匹配拦截特定 API 请求。
- **动态 Mock 数据**：支持静态 JSON 返回，同时深度集成 `Mock.js` 语法，提供多行快捷字段生成器，支持复杂嵌套对象和数组的自动生成。
- **文件持久化**：Mock 数据自动保存为本地独立 JSON 文件，方便团队共享或二次编辑。

### 2. 调试面板与全局日志拦截 (Debug Console Interceptor)
在状态栏提供一个集成的调试入口，让你在不打开完整终端的情况下掌控日志。
- **状态栏调试中心**：悬停可展示包含“刷新窗口”、“打开开发者工具”、“打开输出面板”的快捷操作台。
- **Console 弹窗拦截**：可动态勾选是否拦截全局的 `console.log`、`info`、`warn`、`error`，将其以右下角系统弹窗的形式展示，极大方便 Webview 或隐藏进程的调试。

### 3. 项目上下文导出 (Project Context Export) 🤖
一键将当前项目的文件树结构和文本内容导出为 Markdown 或纯文本格式。
- 自动读取并遵守 `.gitignore`，过滤无关文件（如 `node_modules`、`dist` 等）。
- **AI 辅助利器**：极其适合将项目上下文一键复制并喂给 ChatGPT、Claude 等大语言模型，让 AI 更好地理解你的项目结构。

### 4. Git 本地文件忽略 (File Isolation)
在本地忽略对**已跟踪文件**的修改，而无需更改 `.gitignore`。适用于需要修改本地配置文件（如数据库配置、API 端点）但禁止提交该修改的场景。
- 被忽略的文件在 Git 状态中显示为未修改，且不影响远程仓库。
- 在资源管理器中，被隔离的文件会显示 `IG` (Ignored) 徽章以便识别。

### 5. 代码锚点与书签 (Code Anchors)
在代码行中添加可视化标记，用于记录关键逻辑位置或待办事项。
- 支持对当前行添加标记，并归类到自定义分组（如 TODO, FIXME, Default）。
- **CodeLens 导航**：在锚点行的上方显示操作栏，支持跳转至同组的上一个/下一个锚点。
- 锚点数据持久化存储于工作区根目录的 `.telemetryrc` 文件中。

### 6. 智能导入辅助 (Auto Import)
增强现有的导入路径补全功能，支持解析项目别名及 AST 语法树。
- 自动识别 `tsconfig.json` 或 `.quickopsrc` 中配置的路径别名（如 `@/`）。
- 选中文件后，插件会解析该文件的 AST（抽象语法树），列出所有 `export` 的变量和函数供选择，自动生成 import 语句。

### 7. 智能调试日志 (Smart Log)
快速插入包含上下文信息的调试语句。
- 输入特定前缀（默认 `log`）触发。自动填充 `[文件名:行号]` 及当前选中的变量名。
- 可通过配置文件自定义 `console.log` 的输出模板。

### 8. 样式结构生成 (Style Generator)
针对 Vue 或 HTML 文件，根据 `template` 结构自动生成对应的 SCSS/Less 嵌套代码。
- 在编辑器中右键选择 "Generate SCSS"，插件将解析 HTML 类名层级并一键生成嵌套样式代码。

### 9. 视图导航与定位 (Smart Scroll)
- **一键滚动**：在文件的顶部（如 Vue 的 Template）和底部（如 Style/Script）之间快速切换。
- **定位文件**：一键在左侧资源管理器树中高亮并展开当前正在编辑的文件。

### 10. 脚本执行器 (Script Runner)
- **NPM 脚本**：自动读取 `package.json` 中的 `scripts` 字段，提供下拉列表供选择执行。
- **自定义脚本**：支持在 `.quickopsrc` 中定义项目专属的 Shell 快捷命令。

### 11. 剪贴板变量转换 (Smart Clipboard)
无需打开外部工具，直接在编辑器中对剪贴板内容进行代码命名规范的格式转换。

| 命令 | 快捷键 (Win/Mac) | 示例（转换前 → 转换后） |
| --- | --- | --- |
| 转小驼峰 | Ctrl + Alt + C | user-id → userId |
| 转大驼峰 | Ctrl + Alt + P | user-id → UserId |
| 转常量 | Ctrl + Alt + U | user-id → USER_ID |
| 转短横线 | Ctrl + Alt + K | userId → user-id |
| 转小写空格 | Ctrl + Alt + L | USER ID → user id |
| 首字母大写 | Ctrl + Alt + F | apple → Apple |

---

## ⚙️ 配置说明

插件行为由项目根目录下的 `.quickopsrc` 文件控制（JSON 格式）。

```json
{
  "general": {
    "debug": true, // 开启状态栏调试面板与 Console 拦截
    "mockDir": ".quickops/mocks" // 代理请求的 Mock 数据存放目录
  },
  "project": {
    "alias": {
      "@": "./src",
      "components": "./src/components"
    }
  },
  "git": {
    // 本地隔离文件列表 (相对路径)
    "ignoreList": ["src/config.local.js", ".env"]
  },
  "logger": {
    // 调试日志的插入模板 (${file}, ${line}, ${selection})
    "template": "console.log('[${file}:${line}]', ${selection})"
  },
  "proxy": [
    {
      "id": "proxy-1",
      "port": 8080,
      "target": "[https://api.example.com](https://api.example.com)",
      "enabled": true
    }
  ]
}