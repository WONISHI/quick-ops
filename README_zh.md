<p align="center">
    <img src="./icon.png" width="128" height="128" alt="quickOps Logo" />
</p>

<h1 align="center">Quick Ops</h1>

<p align="center">
    <a href="https://img.shields.io/visual-studio-marketplace/v/quick-ops.quick-ops">
        <img src="https://img.shields.io/visual-studio-marketplace/v/quick-ops.quick-ops?style=flat-square&label=Version&color=007ACC" alt="Version">
    </a>
    <a href="https://img.shields.io/visual-studio-marketplace/i/quick-ops.quick-ops">
        <img src="https://img.shields.io/visual-studio-marketplace/i/quick-ops.quick-ops?style=flat-square&label=Installs&color=green" alt="Installs">
    </a>
    <img src="https://img.shields.io/badge/License-MIT-orange.svg?style=flat-square" alt="License">
</p>

**Quick Ops** 是一款功能全面、高性能的 VS Code 扩展，内置了众多企业级特性。从**极致的 UI 组件智能提示**、**历史项目管理器**，到代码锚点、本地 Mock 服务器以及项目上下文导出。它的设计旨在弥补 VS Code 原生功能的不足，大幅优化前端和全栈开发者的工作流。

---

## 多语言文档
- [English Documentation](https://github.com/WONISHI/quick-ops/blob/master/README.md)

## 🚀 核心功能

### 1. 极致的 UI 组件智能提示 (New!) 🔥
内置离线可用的智能补全与丰富的悬停文档，为顶级 Vue UI 框架提供强大的开发体验增强。
- **支持的框架**: Element UI (Vue 2), Element Plus (Vue 3), Vant 2, 以及 Ant Design Vue (v1 & v4)。
- **智能短横线转换**: 在自动补全时，自动将驼峰命名 (camelCase) 的属性转换为 Vue 官方推荐的短横线命名 (`kebab-case`)。
- **丰富的悬停文档**: 鼠标悬停在任何组件标签、属性或事件上，即可瞬间查看详细的 Markdown 文档、可选类型及默认值。
- **动态按需加载**: 仅激活你当前项目 `package.json` 中已安装的 UI 库，保持插件运行极速流畅。

### 2. 历史项目与工作区管理器 🗂️
在活动栏提供一个专属视图，用于高效管理你的本地与远程代码仓库。
- **Git 分支同步**: 自动获取并显示本地及远程 (GitHub/GitLab) 项目的当前分支。
- **远程只读预览**: 无需将代码克隆到本地，即可在只读编辑器中直接浏览远程仓库的文件。
- **一键状态同步**: 瞬间并发拉取并同步你保存的所有项目的最新分支状态。

### 3. 高性能本地 Mock 与文件服务 📡
提供一个强大的可视化 Webview 面板，直接在 VS Code 中管理 Mock 数据并提供本地文件服务。
- **动态 Mock 数据**: 支持静态 JSON 以及与 `Mock.js` 的深度集成。包含多行快捷构建器，自动生成复杂的嵌套对象和数组。
- **智能响应包装器**: 自动将内部 Mock 数据包装为标准 API 格式（例如 `{ code, msg, data }`），支持分页格式，或使用 `${data}` 和 `${statusCode}` 占位符完全自定义模板。
- **本地文件服务**: 将 API 接口直接映射到本地文件（如图片、文档等）。
- **高级模拟**: 准确模拟网络延迟 (Delay) 并自定义 HTTP 返回状态码。

### 4. 代码锚点与交互式思维导图 🧠
在代码行添加可视化标记，轻松追踪关键逻辑或待办任务。
- **交互式思维导图**: 在 Webview 中以动态、可拖拽的 D3.js 思维导图形式对代码锚点进行可视化。
- **分类管理**: 添加标记并将其归类到自定义分组中（如 TODO, FIXME, Default 等）。
- **CodeLens 导航**: 在锚点代码行上方显示操作栏，支持快速跳转到同组的上一个/下一个锚点。

### 5. 项目上下文导出 (大模型/LLM 助手) 🤖
一键将整个项目的文件树和源码内容导出为单个 Markdown 或文本文件。
- 自动读取并遵循 `.gitignore`、`.vscodeignore` 以及 `.quickopsrc` 的忽略规则，智能过滤无关文件（如 `node_modules`）。
- 完美契合 ChatGPT 或 Claude 等 LLM 大语言模型，帮助 AI 瞬间理解你的整个代码库上下文。

### 6. 智能文本与格式转换 ✨
在编辑器内通过优雅的原生二级菜单，直接将选中的文本转换为各种编程命名规范，彻底告别外部网页工具。

| 命令 | 快捷键 (Win/Mac) | 动作 |
| --- | --- | --- |
| **打开转换菜单** | `Ctrl + Alt + T` | 呼出下拉菜单或右键二级菜单进行格式化 |
| 转为小驼峰 (camelCase) | *通过菜单* | `user-id` → `userId` |
| 转为大驼峰 (PascalCase) | *通过菜单* | `user-id` → `UserId` |
| 转为全大写常量 (CONSTANT_CASE) | *通过菜单* | `user-id` → `USER_ID` |
| 转为短横线 (kebab-case) | *通过菜单* | `userId` → `user-id` |
| 转为全小写 (lowercase) | *通过菜单* | `USER ID` → `user id` |

### 7. 代码生成与编辑器实用工具 🛠️
- **样式结构生成器**: 在 Vue/HTML 文件中右键并选择 "Generate SCSS"，即可解析 HTML 类名层级并直接输出嵌套的 SCSS/Less 代码。
- **快捷代码片段**: 选中任意代码，右键选择 "Add to Quick Ops Snippets"，即可将其保存以便后续快速调用。
- **网页预览台**: 打开内置的 Webview 即时预览 HTML 文件效果。
- **导航快捷键**: 快速切换到上一个编辑器 (`Alt+B`)、滚动到顶部/底部，或快速切换终端显示状态。

---

## ⚙️ 配置指南

插件的行为可以通过 VS Code 原生设置 (`Settings > Extensions > Quick Ops`) 以及项目根目录下的 `.quickopsrc` JSON 配置文件进行自定义。

### VS Code 设置 (`settings.json`)
你可以自由开启/关闭 UI 框架的智能提示、配置日志格式，或直接在设置中添加 GitHub Token：
```json
{
  "quick-ops.general.use.ElementPlus": true,
  "quick-ops.general.use.Vant": true,
  "quick-ops.logger.dateFormat": "YYYY-MM-DD HH:mm:ss",
  "quick-ops.git.githubToken": "your_personal_access_token_here" // 防止历史项目视图触发 GitHub API 的频率限制
}
