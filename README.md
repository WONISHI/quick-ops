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

**quickOps** is a versatile VS Code extension packed with features like code anchoring, local file isolation, smart path autocompletion, local mock proxying, debugging assistants, and project context export. It is designed to bridge the gaps in native VS Code functionality and dramatically optimize the workflow for frontend and full-stack developers.

---

## 🚀 Features

### 1. Local Proxy & Mock Server 🔥
Features a powerful, visual Webview panel to manage API proxies and mock data directly within VS Code, eliminating the need for complex Nginx configs or CORS extensions.
- **Global Proxy Forwarding**: Easily configure local ports and target servers to resolve CORS issues seamlessly.
- **Strict Route Interception**: Intercept specific API requests using exact path matching.
- **Dynamic Mock Data**: Supports static JSON as well as deep integration with `Mock.js`. Includes a multi-row quick builder for automatically generating complex nested objects and arrays.
- **Persistent Storage**: Mock rules and JSON data are saved locally, making them easy to share with your team or edit manually.

### 2. Debug Console Interceptor
Provides an integrated debugging hub in the Status Bar to control logs without opening the full terminal.
- **Status Bar Dashboard**: Hover to reveal quick actions like "Reload Window", "Toggle DevTools", and "Open Output Panel".
- **Global Log Interceptor**: Dynamically toggle interceptions for `console.log`, `info`, `warn`, and `error`. Logs will be displayed as native VS Code notifications, perfect for debugging background processes or Webviews.

### 3. Project Context Export 🤖
Export your entire project's file tree and source code contents into a single Markdown or text file with one click.
- Automatically reads and respects `.gitignore` and `.vscodeignore` to filter out irrelevant files (e.g., `node_modules`).
- **The Ultimate AI Helper**: Perfect for copying your project context and feeding it to LLMs like ChatGPT or Claude, helping AI understand your codebase instantly.

### 4. Git File Isolation
Ignore local modifications to **tracked files** without altering your `.gitignore`. Ideal for scenarios where you need to modify local config files (like DB credentials or API endpoints) but must ensure these changes are never committed.
- Isolated files show up as unmodified in Git status and won't affect remote repositories.
- Files appear with an `IG` (Ignored) badge in the File Explorer for easy identification.

### 5. Code Anchors & Bookmarks
Add visual markers to code lines to keep track of crucial logic or pending tasks.
- Add markers and categorize them into custom groups (e.g., TODO, FIXME, Default).
- **CodeLens Navigation**: Displays an action bar above anchor lines to jump to the previous/next anchor in the same group.
- Anchors are persistently stored in a `.telemetryrc` file in your workspace root.

### 6. Auto Import Assistant
Enhances native path autocompletion and supports AST (Abstract Syntax Tree) parsing.
- Automatically recognizes path aliases configured in `tsconfig.json` or `.quickopsrc` (e.g., `@/`).
- Upon selecting a file, the extension parses its AST to list all `export` variables and functions, automatically generating the correct import statement.

### 7. Smart Log Generator
Quickly insert debugging statements packed with context.
- Triggered by specific prefixes (default: `log`). Automatically injects `[filename:line-number]` and the currently selected variable.
- Fully customizable `console.log` output template via the configuration file.

### 8. Style Generator
Automatically generates nested SCSS/Less code based on the HTML/Vue `template` structure.
- Right-click in the editor and select "Generate SCSS". The extension parses HTML class hierarchies and outputs the nested styles directly.

### 9. Smart Scroll & Locate
- **Quick Jump**: Easily toggle between the top (Template) and bottom (Style/Script) of a file.
- **Locate File**: Quickly reveal and highlight the currently active file in the Explorer side-bar.

### 10. Script Runner
- **NPM Scripts**: Automatically reads the `scripts` field from `package.json` and provides a dropdown to execute them.
- **Custom Scripts**: Define your own project-specific shell commands in `.quickopsrc`.

### 11. Smart Clipboard Format Converter
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
    "debug": true, // Enable Status Bar Debug Panel & Console Interceptor
    "mockDir": ".quickops/mocks" // Directory to store local Mock JSON files
  },
  "project": {
    "alias": {
      "@": "./src",
      "components": "./src/components"
    }
  },
  "git": {
    // List of local files to isolate from Git commits
    "ignoreList": ["src/config.local.js", ".env"]
  },
  "logger": {
    // Template for smart log insertion (${file}, ${line}, ${selection})
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