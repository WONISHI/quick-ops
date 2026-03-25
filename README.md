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

**Quick Ops** is a versatile, high-performance VS Code extension packed with enterprise-grade features. From **Ultimate UI Component Intellisense** and a **Recent Projects Manager**, to code anchoring, local mock servers, and project context export. It is designed to bridge the gaps in native VS Code functionality and dramatically optimize the workflow for frontend and full-stack developers.

---

## Translations
- [中文文档](https://github.com/WONISHI/quick-ops/blob/master/README_zh.md)

## 🚀 Features

### 1. Ultimate UI Component Intellisense (New!) 🔥
Supercharge your frontend development with built-in, offline-ready intelligent autocompletion and rich hover documentation for top Vue UI frameworks.
- **Supported Frameworks**: Element UI (Vue 2), Element Plus (Vue 3), Vant 2, and Ant Design Vue (v1 & v4).
- **Smart Kebab-case**: Automatically converts camelCase attributes to Vue's recommended `kebab-case` during autocompletion.
- **Rich Hover Docs**: Hover over any component tag, attribute, or event to view detailed Markdown documentation, accepted types, and default values instantly.
- **Dynamic Loading**: Only activates the libraries you have installed in your `package.json`, keeping performance snappy.

### 2. Recent Projects & Workspace Manager 🗂️
A dedicated view in the Activity Bar to manage your local and remote repositories.
- **Git Branch Sync**: Automatically fetches and displays the current branch for both local and remote (GitHub/GitLab) projects.
- **Remote Read-Only Preview**: Browse files from remote repositories directly in a read-only editor without cloning them to your local machine.
- **One-Click Sync**: Sync branch statuses across all your saved projects instantly.

### 3. High-Performance Local Mock & File Server 📡
Features a powerful, visual Webview panel to manage mock data and serve local files directly within VS Code.
- **Dynamic Mock Data**: Supports static JSON as well as deep integration with `Mock.js`. Includes a multi-row quick builder for automatically generating complex nested objects and arrays.
- **Smart Response Wrapper**: Automatically wrap your internal Mock data in standard formats (e.g., `{ code, msg, data }`).
- **Local File Serving**: Map API endpoints to local files (images, documents, etc.). 
- **Advanced Simulation**: Accurately simulate network latency (Delay) and customize HTTP return status codes.

### 4. Code Anchors & Interactive Mind Map 🧠
Add visual markers to code lines to keep track of crucial logic or pending tasks.
- **Interactive Mind Map**: Visualize your code anchors in a dynamic, draggable D3.js mind map within a Webview.
- **Categorization**: Add markers and categorize them into custom groups (e.g., TODO, FIXME, Default).
- **CodeLens Navigation**: Displays an action bar above anchor lines to jump to the previous/next anchor.

### 5. Project Context Export (LLM Helper) 🤖
Export your entire project's file tree and source code contents into a single Markdown or text file with one click.
- Automatically reads and respects `.gitignore`, `.vscodeignore`, and `.quickopsrc` ignores to filter out irrelevant files.
- Perfect for copying your project context and feeding it to LLMs like ChatGPT or Claude, helping AI understand your codebase instantly.

### 6. Smart Text & Format Converter ✨
Convert clipboard text to various coding casing standards directly in the editor via an elegant native submenu, without needing external web tools.

| Command | Shortcut (Win/Mac) | Action |
| --- | --- | --- |
| **Transform Text Menu** | `Ctrl + Alt + T` | Opens a quick-pick menu / right-click submenu for formatting |
| To camelCase | *Via Menu* | `user-id` → `userId` |
| To PascalCase | *Via Menu* | `user-id` → `UserId` |
| To CONSTANT_CASE | *Via Menu* | `user-id` → `USER_ID` |
| To kebab-case | *Via Menu* | `userId` → `user-id` |
| To lowercase | *Via Menu* | `USER ID` → `user id` |

### 7. Code Generation & Editor Utilities 🛠️
- **Style Structure Generator**: Right-click in a Vue/HTML file and select "Generate SCSS" to parse HTML class hierarchies and output nested SCSS/Less code.
- **Quick Snippets**: Select any code, right-click, and choose "Add to Quick Ops Snippets" to save it for later.
- **Live Preview**: Open a built-in webview to preview HTML files instantly.
- **Navigation Shortcuts**: Quickly switch to the previous editor (`Alt+B`), scroll to top/bottom, or toggle the terminal visibility.

---

## ⚙️ Configuration

The extension's behavior can be customized via VS Code's native Settings (`Settings > Extensions > Quick Ops`) and a `.quickopsrc` JSON file located in your project's root directory.

### VS Code Settings (`settings.json`)
You can toggle UI framework intellisense, configure log formats, and add your GitHub token directly in VS Code settings:
```json
{
  "quick-ops.general.use.ElementPlus": true,
  "quick-ops.general.use.Vant": true,
  "quick-ops.logger.dateFormat": "YYYY-MM-DD HH:mm:ss",
  "quick-ops.git.githubToken": "your_personal_access_token_here" // Prevents API rate limiting for the Recent Projects view
}
