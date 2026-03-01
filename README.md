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

**quickOps** is a versatile, high-performance VS Code extension packed with features like code anchoring, interactive mind maps, local mock servers, smart path autocompletion, debugging assistants, and project context export. It is designed to bridge the gaps in native VS Code functionality and dramatically optimize the workflow for frontend and full-stack developers.

---

## Translations
- [中文文档](https://github.com/WONISHI/quick-ops/blob/master/README_zh.md)

## 🚀 Features

### 1. High-Performance Local Mock & File Server 🔥
Features a powerful, visual Webview panel to manage mock data and serve local files directly within VS Code. Extremely lightweight and pure, with auto CORS resolution.
- **Dynamic Mock Data**: Supports static JSON as well as deep integration with `Mock.js`. Includes a multi-row quick builder for automatically generating complex nested objects and arrays.
- **Smart Response Wrapper**: Automatically wrap your internal Mock data in standard formats (e.g., `{ code, msg, data }`), pagination formats, or fully custom templates using `${data}` and `${statusCode}` placeholders.
- **Local File Serving**: Map API endpoints to local files (images, documents, etc.). Supports returning multiple files sequentially and configuring `Content-Disposition` (inline/attachment).
- **Advanced Simulation**: Accurately simulate network latency (Delay), inject custom request headers (`req.headers`), and customize HTTP return status codes.
- **Persistent Storage**: Mock rules and JSON data are saved locally in your workspace, making them easy to share with your team.

### 2. Code Anchors & Interactive Mind Map 🧠
Add visual markers to code lines to keep track of crucial logic or pending tasks.
- **Interactive Mind Map**: Visualize your code anchors in a dynamic, draggable D3.js mind map within a Webview. Hover over nodes to preview code snippets, and click to instantly jump to the source code.
- **Categorization**: Add markers and categorize them into custom groups (e.g., TODO, FIXME, Default).
- **CodeLens Navigation**: Displays an action bar above anchor lines to jump to the previous/next anchor in the same group.

### 3. Project Context Export 🤖
Export your entire project's file tree and source code contents into a single Markdown or text file with one click.
- Automatically reads and respects `.gitignore`, `.vscodeignore`, and `.quickopsrc` ignores to filter out irrelevant files (e.g., `node_modules`).
- **The Ultimate AI Helper**: Perfect for copying your project context and feeding it to LLMs like ChatGPT or Claude, helping AI understand your codebase instantly.

### 4. QuickOps Ignore List
Smartly toggle files or folders to be ignored by QuickOps features (such as Project Context Export).
- Simply right-click any file/folder in the Explorer and select "Toggle Ignore" to add or remove it from the `.quickopsrc` ignore list seamlessly.

### 5. Auto Import Assistant
Enhances native path autocompletion and supports AST (Abstract Syntax Tree) parsing.
- Automatically recognizes path aliases configured in `tsconfig.json` or `.quickopsrc` (e.g., `@/`).
- Upon selecting a file, the extension parses its AST to list all `export` variables and functions, automatically generating the correct import statement.

### 6. Smart Log Generator
Quickly insert debugging statements packed with context.
- Triggered by specific prefixes (default: `log`). Automatically injects `[filename:line-number]` and the currently selected variable.
- Fully customizable `console.log` output template via the configuration file.

### 7. Style Generator
Automatically generates nested SCSS/Less code based on the HTML/Vue `template` structure.
- Right-click in the editor and select "Generate SCSS". The extension parses HTML class hierarchies and outputs the nested styles directly.

### 8. Script Runner
- **NPM Scripts**: Automatically reads the `scripts` field from `package.json` and provides a dropdown to execute them. Includes intelligent bypassing of Windows batch script `(Y/N)` termination prompts.
- **Custom Scripts**: Define your own project-specific shell commands in `.quickopsrc`.

### 9. Smart Clipboard Format Converter
Convert clipboard text to various coding casing standards directly in the editor, without needing external web tools.

| Command | Shortcut (Win/Mac) | Example (Before → After) |
| --- | --- | --- |
| To camelCase | Ctrl + Alt + C | user-id → userId |
| To PascalCase | Ctrl + Alt + P | user-id → UserId |
| To CONSTANT_CASE | Ctrl + Alt + U | user-id → USER_ID |
| To kebab-case | Ctrl + Alt + K | userId → user-id |
| To lowercase space | Ctrl + Alt + L | USER ID → user id |
| Capitalize First | Ctrl + Alt + F | apple → Apple |

---

## ⚙️ Configuration

The extension's behavior is controlled by a `.quickopsrc` JSON file located in your project's root directory. 

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