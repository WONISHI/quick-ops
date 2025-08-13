# Scope Search

Scope Search 是一个 VS Code 扩展，用于在指定范围内进行代码搜索，让你能够快速、高效地定位目标代码段。

## ✨ 功能特性

- **范围限定搜索**：只在选定的文件夹、文件或代码块中搜索。
- **精确匹配**：支持精确匹配、正则匹配和大小写敏感模式。
- **高亮显示**：搜索结果高亮显示，方便快速定位。
- **快捷键支持**：可通过快捷键快速触发搜索。

## 📦 安装

1. 从 VSIX 文件安装  
   - 在 VS Code 中打开命令面板（`Ctrl+Shift+P`）  
   - 输入 `Extensions: Install from VSIX...` 并选择 `.vsix` 文件

2. 或从 VS Code Marketplace 搜索 **Scope Search** 安装（发布后可用）

## ⚙️ 使用方法

1. 选中你想搜索的范围（文件、目录或选中代码段）。
2. 打开命令面板（`Ctrl+Shift+P`），输入并选择 **Scope Search: Search in scope**。
3. 输入关键词，查看高亮显示的搜索结果。

## 🔧 配置项

| 配置项 | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `scopeSearch.caseSensitive` | `boolean` | `false` | 是否区分大小写 |
| `scopeSearch.useRegex` | `boolean` | `false` | 是否使用正则表达式 |

## 📝 更新日志

### 0.0.1
- 初始化版本，支持基本的范围搜索功能。

---

**Enjoy fast and precise searching!**