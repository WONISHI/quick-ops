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

**quickOps** 是一个多功能、高性能的 VS Code 扩展，集成了代码锚点、交互式思维导图、本地 Mock 服务器、路径补全、调试辅助以及项目上下文导出等功能。旨在补充 VS Code 原生功能的不足，极大地优化前端及全栈的开发流程。

---

## Translations
- [English Documentation](https://github.com/WONISHI/quick-ops/blob/master/README.md)

## 🚀 功能列表

### 1. 高性能本地 Mock 与文件服务 (Mock & File Server) 🔥
内置强大的可视化 Webview 面板，在 VS Code 内直接管理 Mock 数据和下发本地文件。极度轻量纯粹，自动解决本地开发跨域问题。
- **动态 Mock 数据**：支持静态 JSON 返回，同时深度集成 `Mock.js` 语法，提供多行快捷字段生成器，支持复杂嵌套对象和数组的自动生成。
- **智能响应包裹 (Wrapper)**：自动将内层 Mock 数据包裹在标准格式（如 `{ code, msg, data }`）、分页格式或完全自定义的模板中，支持 `${data}` 和 `${statusCode}` 占位符。
- **本地文件下发**：将 API 接口映射到本地真实文件（图片、文档等）。支持按顺序下发多个文件列表，并可配置 `Content-Disposition`（内联浏览器预览 / 作为附件下载）。
- **高级模拟**：精准模拟网络延迟 (Delay)、强行注入自定义请求头 (`req.headers`)，以及自定义 HTTP 返回状态码。
- **文件持久化**：Mock 规则和数据自动保存为工作区本地文件，方便团队共享和版本控制。

### 2. 代码锚点与交互式思维导图 (Code Anchors & Mind Map) 🧠
在代码行中添加可视化标记，用于记录关键逻辑位置或待办事项。
- **交互式思维导图**：在 Webview 中将所有代码锚点可视化为可拖拽的 D3.js 动态思维导图。悬停节点可预览代码片段及快捷操作，点击即可瞬间跳转至源码位置。
- **分组管理**：支持对当前行添加标记，并归类到自定义分组（如 TODO, FIXME, Default）。
- **CodeLens 导航**：在锚点行的上方显示操作栏，支持跳转至同组的上一个/下一个锚点。

### 3. 项目上下文导出 (Project Context Export) 🤖
一键将当前项目的文件树结构和文本内容导出为 Markdown 或纯文本格式。
- 自动读取并遵守 `.gitignore`、`.vscodeignore` 以及 `.quickopsrc` 的忽略列表，过滤无关文件（如 `node_modules`、`dist` 等）。
- **AI 辅助利器**：极其适合将项目上下文一键复制并喂给 ChatGPT、Claude 等大语言模型，让 AI 瞬间理解你的项目代码库。

### 4. QuickOps 忽略列表 (QuickOps Ignore List)
智能切换文件或文件夹被 QuickOps 功能（如项目上下文导出）忽略的状态。
- 在左侧资源管理器中，右键点击任意文件或文件夹（支持批量多选），选择 "Toggle Ignore"，即可无缝将其添加至或移出 `.quickopsrc` 的忽略列表。

### 5. 调试面板与全局日志拦截 (Debug Console Interceptor)
在状态栏提供一个集成的调试入口，让你在不打开完整终端的情况下掌控日志。
- **状态栏调试中心**：悬停可展示包含“刷新窗口”、“打开开发者工具”、“打开输出面板”的快捷操作台。
- **Console 弹窗拦截**：可动态勾选是否拦截全局的 `console.log`、`info`、`warn`、`error`，将其以右下角系统弹窗的形式展示，极大方便 Webview 或隐藏进程的调试。

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
- **NPM 脚本**：自动读取 `package.json` 中的 `scripts` 字段，提供下拉列表供选择执行。内置智能拦截机制，完美绕过 Windows 批处理脚本烦人的 `(Y/N)` 终止询问。
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
    "debug": true,
    "mockDir": ".quickops/mocks",
    "ignores": [
      "src/config.local.js",
      ".env",
      "node_modules/**"
    ]
  },
  "project": {
    "alias": {
      "@": "./src",
      "components": "./src/components"
    }
  },
  "logger": {
    "template": "console.log('[${file}:${line}]', ${selection})"
  },
  "proxy": [
    {
      "id": "proxy-1",
      "port": 8080,
      "enabled": true
    }
  ]
}