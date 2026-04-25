<p align="center">
    <img src="./icon.png" width="128" height="128" alt="quickOps Logo" />
</p>

<h1 align="center">Quick Ops</h1>

<p align="center">
    <a href="https://github.com/WONISHI/quick-ops">
        <img src="https://img.shields.io/github/package-json/v/WONISHI/quick-ops?style=flat-square&label=VS%20Marketplace&color=007ACC&logo=visualstudiocode" alt="Version">
    </a>
    
    <a href="https://github.com/WONISHI/quick-ops/releases">
        <img src="https://img.shields.io/github/downloads/WONISHI/quick-ops/total?style=flat-square&label=Installs&color=green&logo=visualstudiocode" alt="Installs">
    </a>
    <img src="https://img.shields.io/badge/License-MIT-orange.svg?style=flat-square" alt="License">
</p>

**Quick Ops** is an ultimate, all-in-one productivity extension designed for frontend and full-stack developers. From a **Custom Git GUI** and **Visual Mock Server**, to **UI Component Intellisense** and **Code Anchors**, it bridges the gaps in VS Code's native features and supercharges your development workflow.

---

## 🚀 All Features (全功能详细指南)

### Feat 1: Advanced Git Operations Manager (全能 Git 图形化管理)
A complete, embedded Git GUI inside your sidebar that rivals standalone Git clients.
* **Interactive Git Graph**: 动态展示 Git 提交树，支持按分支筛选、关键字瞬间搜索，并在 Hover 时展示详细提交信息。
* **Enterprise-grade Stash (贮藏管理)**:
  * 一键 `Push`、`Apply`、`Pop` 和 `Drop`。
  * **深度查看**: 点击贮藏记录即可展开内部包含的具体文件；点击文件即可直接查看差异 (Diff)。
* **Smart Conflict Resolution (智能冲突解决)**:
  * 在合并 (Merge) / 拉取 (Pull) / 弹出 (Pop) 时如果发生冲突，自动拦截拦截报错。
  * 在侧边栏生成红色的**“冲突区 (Conflict Zone)”**，清晰列出所有冲突文件。
  * 文件修改保存后，直接点击旁边的 `➕` 即可标记为已解决并移入暂存区。
* **Cross-Branch Diffing (跨分支对比)**: 任意选择基准分支和目标分支，瞬间调起 VS Code 原生的多文件对比编辑器。
* **Quick Controls**: 顶部工具栏提供一键拉取、推送，以及 **“跳过校验 (--no-verify)”** 的盾牌开关。

> 📸 **Screenshot Placeholder here:**
> `![Git Manager](./resources/images/git-manager-demo.png)`

### Feat 2: Ultimate UI Component Intellisense (UI 框架智能提示)
Offline-ready intelligent autocompletion and rich hover documentation for top Vue UI frameworks.
* **Supported Frameworks**: 完美支持 Element UI (Vue 2), Element Plus (Vue 3), Vant 2, 和 Ant Design Vue (v1 & v4)。
* **Smart Kebab-case**: 自动将驼峰命名 (camelCase) 转换为 Vue 推荐的短横线命名 (kebab-case) 进行代码补全。
* **Rich Hover Docs**: 鼠标悬浮在组件标签、属性或事件上，瞬间展示包含详细类型、默认值和用法的 Markdown 文档。
* **Dynamic Loading**: 智能侦测你的 `package.json`，仅为当前项目已安装的库加载提示，保证编辑器性能。

> 📸 **Screenshot Placeholder here:**
> `![UI Intellisense](./resources/images/ui-intellisense-demo.png)`

### Feat 3: High-Performance Mock & API Server (可视化 Mock 接口服务)
* **Visual Management GUI**: 全新的 Webview 面板，无需写复杂的 Node 脚本即可管理所有 API 路由。
* **Mock.js Integration**: 深度集成 Mock.js 语法，支持通过可视化的“多行快速构建器”一键生成复杂的嵌套对象和数组数据。
* **Smart Response Wrapper**: 自动将数据包裹成企业级标准结构（如 `{ code: 200, msg: 'success', data: [...] }`）。
* **Advanced Simulation**: 自由设置接口延迟 (Delay)、模拟 HTTP 错误状态码 (404, 500) 进行边界测试。
* **Local File Serving**: 直接将本地图片、文档等文件映射为可访问的接口路径。

> 📸 **Screenshot Placeholder here:**
> `![Mock Server](./resources/images/mock-server-demo.png)`

### Feat 4: Recent Projects & Workspace Manager (跨空间项目管理器)
* **Unified Workspace**: 在侧边栏集中管理你电脑里所有的常用项目。
* **Git Branch Sync**: 自动扫描并同步所有已添加项目的当前 Git 分支状态，让你一眼掌握所有项目的开发进度。
* **GitHub Integration**: 支持配置 GitHub Token，突破 API 限制，更稳定地读取远程分支数据。
* **Quick Access**: 一键在新窗口打开项目，或直接清理历史记录。

### Feat 5: Code Anchors & Interactive Mind Map (代码锚点与思维导图)
* **Interactive Mind Map (D3.js)**: 在右侧或左侧切分出动态思维导图，可视化你打下的所有代码锚点，点击节点瞬间跳转代码行。
* **Smart Categorization**: 支持将锚点归类到 TODO, FIXME 等自定义分组。
* **CodeLens Navigation**: 在代码编辑器中自动注入悬浮的 CodeLens 操作条，支持点击上一个/下一个快速穿梭。

> 📸 **Screenshot Placeholder here:**
> `![Mind Map Anchors](./resources/images/mindmap-demo.png)`

### Feat 6: Text Format Converter (代码格式瞬间转换)
* 按下 `Ctrl + Alt + T` (`Cmd + Opt + T`) 或通过右键菜单，瞬间转换选中的文本。
* 支持转换为：`camelCase` (小驼峰)、`PascalCase` (大驼峰)、`CONSTANT_CASE` (全大写常量)、`kebab-case` (短横线) 和 `lowercase` (全小写)。

### Feat 7: Style Structure Generator (SCSS/Less 结构一键生成)
* 告别手写冗长的嵌套 CSS！
* 选中一段 HTML/Vue 模板代码，右键选择 **“Generate SCSS (生成样式结构)”**。
* 自动解析所有 `class` 层级关系，并生成带有缩进的完美 SCSS/Less 骨架代码。

### Feat 8: Code Snippets Manager (私有代码片段库)
* 遇到常用的工具函数或组件模板？
* 选中文本 -> 右键 -> **"Add to Quick Ops Snippets"**。
* 代码会永久保存在插件中，随时可以通过快捷键呼出重用。

### Feat 9: Advanced Log Output Generator (高级日志快捷生成)
* 提供高度可定制的 `console.log` 模板设置 (`quick-ops.logger.template`)。
* 支持自动获取变量所在的：`当前文件名`、`文件绝对路径`、`代码行号` 和 `注入特定 Icon`。
* 支持注入带格式化的当前时间戳 (`quick-ops.logger.dateFormat`)。

### Feat 10: Multi-File Text Compare (多文件/选中对比增强)
* 右键任何文件选择 **"选择以进行比较"**，然后右键另一个文件选择 **"与已选项目进行比较"**，快速调起差异对比。
* 右键编辑器内选中的两段不同文本，直接执行纯文本维度的 Diff 比较。

### Feat 11: NPM Package Scripts Runner (快捷脚本运行器)
* 自动提取项目 `package.json` 中的 `scripts` 脚本。
* 在编辑器右上角菜单区域新增一个 **Run** 按钮，点击即可直接选择启动项目 (如 dev, build)，告别频繁敲击终端。

### Feat 12: Editor Navigation Utilities (极限编辑器导航工具)
* **极速切换**: 绑定了 `Alt + B` (`Opt + B`)，在最近访问的两个编辑器标签页间快速反复横跳。
* **快速滚动**: 编辑器标题栏提供一键 "回到顶部" 和 "回到底部" 按钮。
* **资源管理器增强**: 增强侧边栏右键菜单，支持直接 **"向右拆分打开"**、**"在新标签页打开"** 以及定位当前文件位置。

### Feat 13: Live HTML Preview (原生网页预览)
* 不需要单独安装 Live Server！
* 在任何 HTML 文件点击右上角图标，直接在 VS Code 内部切分出一个 Webview 进行实时网页渲染和预览。

### Feat 14: Developer Quick Tools (开发辅助小工具)
* **Quick UUID/ID**: 在设置中调整 `quick-ops.utils.uuidLength`，支持一键生成从 8 位短 ID 到 32 位 UUID，甚至包含 NanoID 长度标准的 21 位 ID。
* **Ghost Ignore (幽灵隔离)**: 专属的 `quick-ops.git.ignoreList` 设置，允许你临时隐藏工作区中不想看到的特定杂乱文件，而不需要修改项目的 `.gitignore` 污染代码库。

---

## ⚙️ Settings Configuration (自定义设置)

You can customize the extension via VS Code's native Settings (`Settings > Extensions > Quick Ops`) or a `.quickopsrc` JSON file in your project.

```json
{
  "quick-ops.general.use.ElementPlus": true,
  "quick-ops.general.use.Vant": true,
  "quick-ops.logger.template": "[icon]-[~/^/^/name]-[line]-[$0]",
  "quick-ops.logger.dateFormat": "YYYY-MM-DD HH:mm:ss",
  "quick-ops.git.defaultSkipVerify": false, 
  "quick-ops.git.githubToken": "your_github_token_here",
  "quick-ops.utils.uuidLength": 12
}
