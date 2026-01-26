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

quickOps 是一个 VS Code 扩展，集成了代码标记、本地文件忽略、路径补全及调试辅助等功能。旨在补充 VS Code 原生功能的不足，通过快捷指令和配置文件优化开发流程。

---

## 功能列表

### 1. Git 本地文件忽略 (File Isolation)

该功能允许在本地忽略对**已跟踪文件**的修改，而无需更改 `.gitignore`。适用于需要修改本地配置文件（如数据库配置、API端点）但禁止提交该修改的场景。

- **实现原理**：插件读取配置后，通过 `git update-index --skip-worktree` 或修改 `.git/info/exclude` 实现忽略。
- **特性**：
  - 被忽略的文件在 Git 状态中显示为未修改。
  - 忽略规则仅在本地生效，不影响远程仓库和其他协作者。
  - 在资源管理器中，被忽略的文件会显示 `IG` (Ignored) 徽章以便识别。

### 2. 代码锚点 (Anchors)

在代码行中添加可视化标记，用于记录关键逻辑位置或待办事项。

- **功能**：
  - **添加锚点**：支持对当前行添加标记，并归类到自定义分组（如 TODO, FIXME, Default）。
  - **CodeLens 导航**：在锚点行的上方显示操作栏，支持跳转至同组的上一个/下一个锚点，或删除当前锚点。
  - **持久化存储**：锚点数据存储于工作区根目录的 `.telemetryrc` 文件中（该文件默认被插件设为 Git 忽略）。

### 3. 智能导入辅助 (Auto Import)

增强现有的导入路径补全功能，支持解析项目别名。

- **路径补全**：
  - 支持识别 `tsconfig.json` 或 `.quickopsrc` 中配置的路径别名（如 `@/`）。
  - 输入路径后，自动列出该路径下的文件。
- **导出解析**：
  - 选中文件后，插件会解析该文件的 AST（抽象语法树）。
  - 列出该文件中所有 `export` 的变量和函数供选择，自动生成 import 语句。

### 4. 调试日志工具 (Smart Log)

快速插入包含上下文信息的调试语句。

- **模板生成**：输入特定前缀（默认 `log`）触发。
- **内容格式**：自动填充 `[文件名:行号]` 及当前选中的变量名。
- **样式定制**：可通过配置文件自定义 `console.log` 的输出模板。

### 5. 样式结构生成 (Style Generator)

针对 Vue 或 HTML 文件，根据 `template` 结构自动生成对应的 SCSS/Less 嵌套代码。

- **用法**：在编辑器中右键选择 "Generate SCSS"，插件将解析 HTML 类名层级并生成样式代码至剪贴板或样式块中。

### 6. 视图导航 (Smart Scroll)

- **一键滚动**：提供命令在文件的顶部（通常是 Template）和底部（通常是 Style/Script）之间快速切换。
- **定位文件**：提供命令在左侧资源管理器中选中当前正在编辑的文件。

### 7. 脚本执行 (Script Runner)

- **NPM 脚本**：自动读取 `package.json` 中的 `scripts` 字段，提供列表供选择执行。
- **自定义脚本**：支持在 `.quickopsrc` 中定义项目专属的 Shell 命令。

---

## 配置说明

插件行为由项目根目录下的 `.quickopsrc` 文件控制（JSON 格式）。

```json
{
  "project": {
    // 项目路径别名，用于辅助路径补全
    "alias": {
      "@": "./src",
      "components": "./src/components"
    }
  },
  "git": {
    // 本地忽略文件列表 (相对路径)
    // 这些文件的改动将不会被 Git 记录
    "ignoreList": ["src/config.local.js", ".env"]
  },
  "logger": {
    // 调试日志的插入模板
    // 可用变量: ${file}, ${line}, ${selection}
    "template": "console.log('[${file}:${line}]', ${selection})"
  }
}
```
