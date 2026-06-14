<p align="center">
  <img src="./icon.png" width="96" alt="Quick Ops Logo" />
</p>

<h1 align="center">Quick Ops</h1>

<p align="center">
  面向前端与全栈开发者的 VS Code 开发提效插件。它把 Git 管理、项目资源管理、UI 组件智能提示、Mock 服务、代码锚点、快捷脚本、文本转换、预览工具等高频能力整合到一个统一工作流里。
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=quick-ops.quick-ops">
    <img src="https://img.shields.io/visual-studio-marketplace/v/quick-ops.quick-ops?label=VS%20Marketplace&color=3b82f6" alt="VS Marketplace Version" />
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=quick-ops.quick-ops">
    <img src="https://img.shields.io/visual-studio-marketplace/i/quick-ops.quick-ops?label=Installs&color=22c55e" alt="VS Marketplace Installs" />
  </a>
  <a href="./LICENSE.md">
    <img src="https://img.shields.io/github/license/WONISHI/quick-ops?color=f59e0b" alt="License" />
  </a>
  <a href="https://github.com/WONISHI/quick-ops">
    <img src="https://img.shields.io/github/stars/WONISHI/quick-ops?style=social" alt="GitHub stars" />
  </a>
</p>

---

## 简介

**Quick Ops** 是一个 VS Code 内的开发操作台。它不是只做某一个小功能，而是把开发中经常分散在 Git 客户端、终端、资源管理器、浏览器、Mock 工具、代码片段工具里的操作集中到 VS Code 里。

它适合这些场景：

- 你希望在 VS Code 侧边栏里完成 Git 提交、拉取、推送、分支、贮藏、冲突处理和提交图查看。
- 你经常同时维护多个项目，希望快速打开、搜索、定位、对比和查看 Git 状态。
- 你写 Vue、Element UI、Element Plus、Vant、Ant Design Vue，希望获得组件、属性、事件、插槽的智能提示和悬浮文档。
- 你需要快速创建本地 Mock 接口、预览 HTML、运行 package scripts、生成日志、生成样式结构、转换变量命名。
- 你希望把代码里的 TODO、FIXME、业务点位变成可导航的锚点或思维导图。

---

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [功能总览](#功能总览)
- [Git 管理器](#git-管理器)
- [项目资源管理器](#项目资源管理器)
- [Mock 服务管理器](#mock-服务管理器)
- [UI 组件智能提示](#ui-组件智能提示)
- [代码锚点与思维导图](#代码锚点与思维导图)
- [快捷脚本运行器](#快捷脚本运行器)
- [预览能力](#预览能力)
- [文本与代码辅助工具](#文本与代码辅助工具)
- [常用命令与入口](#常用命令与入口)
- [快捷键](#快捷键)
- [配置说明](#配置说明)
- [本地开发](#本地开发)
- [常见问题](#常见问题)
- [License](#license)

---

## 安装

### 从 VS Code Marketplace 安装

在 VS Code 扩展市场搜索：

```txt
Quick Ops: Code Utils & Anchors
```

或者在命令面板中执行：

```bash
ext install quick-ops.quick-ops
```

### 从源码运行

```bash
git clone https://github.com/WONISHI/quick-ops.git
cd quick-ops
npm install
npm run build:all
```

开发调试时，在 VS Code 中按 `F5` 启动 Extension Development Host。

---

## 快速开始

安装后，VS Code 左侧 Activity Bar 会出现 **Quick Ops** 入口。插件主要提供三个侧边栏视图：

| 视图 | 用途 |
| --- | --- |
| Mock 服务管理器 | 可视化管理本地 Mock 接口 |
| 项目资源管理器 | 管理最近项目、当前项目、远程项目、文件搜索和文件操作 |
| Git 管理器 | 提交、暂存、分支、贮藏、提交图、跨分支对比等 Git 操作 |

编辑器标题栏、资源管理器右键菜单、编辑器右键菜单、行号右键菜单也会出现 Quick Ops 的快捷入口。

---

## 功能总览

| 功能模块 | 主要能力 |
| --- | --- |
| Git 管理器 | 提交、暂存、取消暂存、放弃更改、拉取、推送、分支、贮藏、提交图、文件历史、跨分支对比 |
| 项目资源管理器 | 最近项目、当前项目增强、远程项目、文件搜索、路径模糊搜索、专注模式、文件对比、Git 状态标识 |
| Mock 服务管理器 | 可视化接口管理、Mock.js 数据、延迟模拟、状态码模拟、统一响应结构、本地静态资源映射 |
| UI 组件智能提示 | Element UI、Element Plus、Vant、Ant Design Vue 的标签、属性、事件、插槽提示 |
| 代码锚点 | 添加锚点、分组管理、快速跳转、思维导图展示、CodeLens 导航 |
| 快捷脚本 | 自动读取 package.json scripts，支持 npm / pnpm / yarn / bun，支持自定义 shell 脚本 |
| 文本转换 | lowercase、camelCase、PascalCase、CONSTANT_CASE、kebab-case |
| 样式结构生成 | 从 HTML / Vue / JSX / TSX 结构生成 SCSS / Less 嵌套骨架 |
| 预览工具 | HTML 预览、Markdown / PDF / Excel / Word 等外部预览入口 |
| 其他工具 | 日志生成、UUID / ID 生成、代码片段管理、QuickOps 忽略列表、编辑器快速导航 |

---

## Git 管理器

Git 管理器是 Quick Ops 的核心能力之一，用来替代一部分外部 Git GUI 客户端和终端 Git 操作。

### 打开方式

在左侧 Activity Bar 中点击 **Quick Ops**，进入 **Git 管理器**。

也可以在 Git 管理器标题栏中使用这些操作：

- 返回当前工作区
- 克隆仓库
- 在编辑器中打开当前 Git 项目
- 修改远程仓库地址
- 打开 Git 详情
- 切换项目查看 Git 记录

### 提交代码

Git 管理器顶部会显示当前项目和当前分支。中间区域会展示：

- 暂存区
- 工作区
- 冲突区
- 贮藏区
- 对比区
- 图形提交记录

基本提交流程：

1. 在 **工作区** 查看未暂存文件。
2. 点击文件右侧的暂存按钮，或点击工作区标题上的“暂存所有更改”。
3. 在提交输入框输入提交信息。
4. 点击 **提交 (Commit)**。

如果开启提交类型 Tag，可以选择 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`chore`、`build`、`ci`、`revert` 等类型，最终提交信息会变成类似：

```txt
feat: 添加项目资源管理器搜索功能
```

### 暂存与取消暂存

在文件列表中可以对单个文件执行：

- 暂存文件
- 取消暂存文件
- 打开更改 Diff
- 放弃单个文件更改

在区块标题右侧可以执行：

- 暂存所有更改
- 取消暂存所有更改
- 打开当前区块的所有更改

### 放弃更改

工作区文件可以执行“放弃更改”。如果只有一个文件，直接针对该文件弹出确认；如果有多个文件，可执行“放弃所有更改”。

> 注意：放弃更改是不可恢复操作，插件会使用 VS Code 原生确认弹窗进行确认。

### 拉取与推送

顶部工具栏提供 Pull / Push 按钮。

如果当前分支落后远程分支，会显示需要 Pull 的数量；如果当前分支领先远程分支，会显示需要 Push 的数量。

### 跳过 Git Hook 校验

工具栏中的盾牌按钮用于控制提交时是否跳过校验。

- 开启校验：正常提交。
- 关闭校验：提交时等同于附加 `--no-verify`。

也可以通过配置项控制默认状态：

```json
{
  "quick-ops.git.defaultSkipVerify": false
}
```

### 图形提交记录

Git 管理器底部的图形区域用于展示 Git 提交历史。

支持：

- 提交节点图形化展示
- 当前分支与远程分支标识
- 提交搜索
- 分支筛选
- 展开提交查看变动文件
- 右键提交执行更多操作
- 打开某次提交的多文件 Diff

常用操作：

1. 点击提交记录：展开或收起提交文件。
2. 鼠标悬浮提交记录：查看提交详情。
3. 点击图形区域右上角搜索：按 hash、作者、提交信息搜索。
4. 点击筛选按钮：切换查看全部分支或指定分支。

### 贮藏管理

贮藏区会展示当前仓库的 stash 记录。

支持：

- Apply：应用贮藏并保留。
- Pop：应用并删除贮藏。
- Drop：删除贮藏。
- 展开贮藏记录查看内部文件。
- 点击贮藏文件查看 Diff。

### 冲突处理

当 Pull、Merge、Pop 等操作产生冲突时，Git 管理器会出现 **冲突区**。

推荐流程：

1. 在冲突区打开冲突文件。
2. 在编辑器中解决冲突内容。
3. 保存文件。
4. 在 Git 管理器中将文件标记为已解决并暂存。
5. 继续提交或完成合并流程。

### 文件历史与跨分支对比

对比区支持：

- 查看当前文件历史。
- 跨分支对比当前文件。
- 重新打开分支文件对比。
- 展开对比提交查看文件列表。

使用方式：

1. 打开一个文件。
2. 在 Git 管理器的对比区点击“查看当前文件历史”。
3. 或点击“跨分支对比”，选择基准分支和目标分支。
4. 点击对比结果中的文件即可打开 VS Code 原生 Diff。

---

## 项目资源管理器

项目资源管理器用于集中管理本地项目、远程项目和当前工作区。

### 打开方式

左侧 Activity Bar -> Quick Ops -> **项目资源管理器**。

### 添加项目

在项目资源管理器标题栏点击“添加项目”，可以添加：

- 本地项目目录
- 远程 GitHub / GitLab 项目地址

添加后，项目会保存在 Quick Ops 的历史列表中，后续可以快速打开。

### 打开项目

对项目右键可执行：

- 在当前窗口打开
- 在新窗口打开
- 编辑项目名称
- 更换地址
- 复制项目名 / 文件名 / 地址
- 在访达 / 资源管理器中显示
- 添加到 Git 记录列表
- 从资源管理器记录中移除

### 当前项目增强

当前 VS Code 工作区会作为当前运行项目显示。对于当前项目，文件树支持更多操作：

- 新建文件
- 新建文件夹
- 删除文件 / 文件夹
- 打开文件
- 向右拆分打开
- 在新标签页打开
- 在系统文件管理器中显示
- 与旧代码对比
- 取消变更

### 文件搜索

项目资源管理器支持两类搜索：

#### 1. 文件内容搜索

用于在指定项目或文件夹内查找文本内容。

使用方式：

1. 右键项目或文件夹。
2. 点击“查找文件内容”。
3. 输入关键字。
4. 点击搜索结果可跳转到对应文件和行号。

内容搜索支持：

- 结果高亮
- 上一个 / 下一个匹配项
- 按扩展名筛选结果
- 保持结果滚动位置

#### 2. 文件名 / 文件夹名搜索

用于搜索文件名、文件夹名和路径片段。

支持输入：

```txt
src
src/main
src main
components index
```

插件会按文件名和路径片段进行模糊匹配。

### 专注模式

专注模式用于只查看某个文件夹内部内容。

使用方式：

1. 右键当前项目中的某个文件夹。
2. 点击“专注模式”。
3. 项目资源管理器会只展示该文件夹作为根节点。
4. 点击返回即可退出专注模式。

适合在大型项目中只关注 `src`、`packages/xxx`、`components` 等目录。

### 在项目中定位当前文件

当编辑器打开某个文件时，可以点击项目资源管理器标题栏的“在项目中定位”。

插件会自动：

1. 找到当前文件所属项目。
2. 展开父级文件夹。
3. 滚动到当前文件所在位置。
4. 高亮当前文件。

### Git 状态标识

项目资源管理器会在当前项目文件树中展示 Git 状态。

常见状态：

| 标识 | 含义 |
| --- | --- |
| U / ? | 未跟踪 |
| M | 已修改 |
| A | 已添加 |
| D | 已删除 |
| R | 已重命名 |
| C | 已复制 |
| X | 存在冲突 |

文件夹会根据子项状态显示强调标识。

### 文件对比

支持两种对比方式：

#### 选择文件进行比较

1. 右键一个文件，选择“选择以进行比较”。
2. 右键另一个文件，选择“与已选项目进行比较”。
3. VS Code 会打开 Diff 页面。

#### 与旧代码对比

当前项目中有 Git 修改状态的文件，可以右键选择“与旧代码对比”。

- 左侧为旧代码。
- 右侧为当前工作区真实文件。
- 右侧可以直接编辑。

如果选择“取消变更”，插件会关闭对应 Diff 页面，并执行 Git 放弃更改。

---

## Mock 服务管理器

Mock 服务管理器用于在 VS Code 内管理本地接口模拟服务。

### 打开方式

左侧 Activity Bar -> Quick Ops -> **Mock 服务管理器**。

### 适用场景

- 后端接口还没完成，前端需要先开发页面。
- 需要模拟不同状态码、不同响应延迟。
- 需要快速构造列表、分页、嵌套对象等测试数据。
- 需要把本地图片、文档映射成接口地址。

### 创建 Mock 接口

一般流程：

1. 打开 Mock 服务管理器。
2. 新增接口。
3. 填写请求方法和接口路径，例如：

```txt
GET /api/user/list
POST /api/login
```

4. 配置响应数据。
5. 启动 Mock 服务。
6. 在前端项目中请求本地 Mock 地址。

### Mock.js 数据

响应体可以使用 Mock.js 规则生成随机数据，例如：

```json
{
  "code": 200,
  "message": "success",
  "data|5-10": [
    {
      "id|+1": 1,
      "name": "@cname",
      "email": "@email",
      "createdAt": "@datetime"
    }
  ]
}
```

### 延迟和错误状态

可以为接口设置：

- 响应延迟
- HTTP 状态码
- 错误响应内容

用于测试 loading、空状态、错误提示、重试逻辑等边界场景。

### 静态资源映射

可以把本地图片、文档、JSON 等文件映射成接口地址，方便页面直接访问。

---

## UI 组件智能提示

Quick Ops 提供 Vue UI 框架的组件提示能力，减少查文档和手写属性的时间。

### 支持框架

- Element UI
- Element Plus
- Vant
- Ant Design Vue

### 支持能力

- 组件标签补全
- 属性补全
- 事件补全
- 插槽提示
- Hover 悬浮文档
- 默认值、类型、说明展示
- camelCase 自动转换为 Vue 常用的 kebab-case
- 根据当前项目依赖按需加载提示

### 使用方式

在 `.vue`、`.html`、`.tsx`、`.jsx` 等文件中输入组件名前缀即可触发提示。

例如输入：

```vue
<el-
```

会提示 Element Plus / Element UI 相关组件。

在组件属性位置输入：

```vue
<el-table :
```

会提示该组件可用属性。

### 开启或关闭某个 UI 框架提示

可以在 VS Code Settings 或 `.quickopsrc` 中配置：

```json
{
  "quick-ops.general.use.ElementUI": true,
  "quick-ops.general.use.ElementPlus": true,
  "quick-ops.general.use.Vant": true,
  "quick-ops.general.use.AntDesignVue": true
}
```

---

## 代码锚点与思维导图

代码锚点用于给代码中的关键位置打标记，再通过菜单或思维导图快速跳转。

### 添加锚点

方式一：在编辑器行号区域右键，点击“添加锚点”。

方式二：在命令面板中执行：

```txt
Quick Ops: 添加锚点
```

### 查看锚点

可以通过编辑器标题栏的锚点按钮查看当前项目的锚点。

支持两种展示模式：

- 思维导图模式
- 列表菜单模式

配置项：

```json
{
  "quick-ops.general.anchorViewMode": "mindmap",
  "quick-ops.general.mindMapPosition": "right"
}
```

### 跳转锚点

点击锚点节点或列表项，即可跳转到对应文件和代码行。

### 锚点分组

可以按 TODO、FIXME 或业务分类组织锚点，适合大型项目中记录关键逻辑入口。

---

## 快捷脚本运行器

快捷脚本运行器会自动读取当前项目的 `package.json` scripts，并提供一个快速选择执行入口。

### 打开方式

点击编辑器标题栏中的脚本按钮，或执行命令：

```txt
Quick Ops: 运行快捷脚本 (Scripts)
```

### 自动识别 package scripts

例如项目中有：

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "lint": "eslint ."
  }
}
```

打开脚本列表后会显示：

```txt
dev
build
lint
```

### 包管理器识别

插件会根据锁文件识别包管理器：

| 锁文件 | 包管理器 |
| --- | --- |
| pnpm-lock.yaml | pnpm |
| yarn.lock | yarn |
| bun.lockb | bun |
| package-lock.json | npm |

如果没有检测到锁文件，默认使用 npm。

### 自定义 Shell 脚本

可以在配置中添加自定义脚本：

```json
{
  "quick-ops.shells": [
    {
      "description": "启动开发服务",
      "cmd": "pnpm dev",
      "keepOpen": false
    },
    {
      "description": "构建项目",
      "cmd": "pnpm build",
      "keepOpen": false
    }
  ]
}
```

### 后台执行与错误提示

脚本可以后台执行，不需要每次打开终端。执行失败时会通过 VS Code 原生消息弹窗提示错误信息。

---

## 预览能力

Quick Ops 提供多种预览入口。

### Live HTML Preview

打开 HTML 文件后，点击编辑器标题栏的网页预览按钮，即可在 VS Code 内部预览页面。

适合：

- 单 HTML 页面预览
- 简单静态页面调试
- 不想单独启动 Live Server 的场景

### 外部预览

在资源管理器中右键支持的文件，可以打开外部预览入口。

常见支持类型：

- Markdown
- PDF
- Excel
- Word
- 图片

---

## 文本与代码辅助工具

### 文本格式转换

选中文本后，右键选择 **转换文本格式**，或者使用快捷键：

```txt
Ctrl + Alt + T
Cmd + Alt + T
```

支持转换为：

| 类型 | 示例 |
| --- | --- |
| lowercase | user name |
| camelCase | userName |
| PascalCase | UserName |
| CONSTANT_CASE | USER_NAME |
| kebab-case | user-name |

### 生成样式结构

在 Vue / HTML / JSX / TSX 文件中，选中模板结构后右键：

```txt
Quick Ops -> 生成样式结构 (Generate SCSS)
```

插件会根据 class 层级生成嵌套样式骨架。

示例输入：

```html
<div class="user-card">
  <div class="user-card__header"></div>
  <div class="user-card__content"></div>
</div>
```

生成结构类似：

```scss
.user-card {
  &__header {
  }

  &__content {
  }
}
```

### 代码片段管理

选中一段常用代码，右键：

```txt
添加选中内容到代码片段
```

后续可以通过 Quick Ops 的代码片段能力快速复用。

### 日志生成器

支持按模板快速生成日志输出。

配置示例：

```json
{
  "quick-ops.logger.template": "[icon]-[~/^/^/name]-[line]-[$0]",
  "quick-ops.logger.dateFormat": "YYYY-MM-DD HH:mm:ss"
}
```

模板可以包含：

- 当前变量
- 当前文件名
- 当前行号
- 当前时间
- 图标标记

### UUID / ID 生成

可以通过设置控制生成 ID 的长度：

```json
{
  "quick-ops.utils.uuidLength": 12
}
```

支持长度：

- 8 位
- 12 位
- 16 位
- 21 位
- 32 位

### QuickOps 忽略列表

用于临时隐藏某些不想在 Quick Ops 中看到的文件或目录，不需要污染项目 `.gitignore`。

配置：

```json
{
  "quick-ops.git.ignoreList": [
    "dist",
    "coverage",
    ".turbo"
  ]
}
```

---

## 常用命令与入口

### Activity Bar 入口

| 入口 | 说明 |
| --- | --- |
| Mock 服务管理器 | 管理本地 Mock API |
| 项目资源管理器 | 管理项目、搜索文件、查看状态 |
| Git 管理器 | 管理 Git 工作流 |

### 编辑器标题栏

| 命令 | 说明 |
| --- | --- |
| 运行快捷脚本 | 选择并运行 package scripts |
| 网页预览台 | 预览 HTML 页面 |
| 显示锚点 | 打开当前项目锚点 |
| 定位当前文件 | 在项目资源管理器中定位当前文件 |
| 回到顶部 | 滚动到当前编辑器顶部 |
| 回到底部 | 滚动到当前编辑器底部 |

### 资源管理器右键菜单

| 命令 | 说明 |
| --- | --- |
| Quick Ops -> 打开设置面板 | 创建或打开 Quick Ops 配置 |
| Quick Ops -> 添加/移除 QuickOps 忽略 | 管理忽略项 |
| Quick Ops -> 生成样式结构 | 根据模板生成样式骨架 |
| 选择以进行比较 | 选择一个文件作为 Diff 左侧 |
| 与已选项目进行比较 | 与已选择的文件进行 Diff |

### 编辑器右键菜单

| 命令 | 说明 |
| --- | --- |
| 添加选中内容到代码片段 | 保存选中代码 |
| 转换文本格式 | 命名格式转换 |
| 文本差异对比 | 对比文本内容 |

### 行号右键菜单

| 命令 | 说明 |
| --- | --- |
| 添加锚点 | 在当前行添加代码锚点 |

---

## 快捷键

| 快捷键 | macOS | 功能 |
| --- | --- | --- |
| `Alt + B` | `Option + B` | 在最近访问的两个编辑器之间切换 |
| `Ctrl + Alt + T` | `Cmd + Alt + T` | 转换选中文本格式 |
| `Ctrl + N` | `Cmd + N` | 返回上一个聚焦位置 |

---

## 配置说明

可以在 VS Code Settings 中搜索 **Quick Ops** 进行配置，也可以在项目根目录创建 `.quickopsrc`。

完整示例：

```json
{
  "quick-ops.general": {
    "mockDir": ""
  },
  "quick-ops.general.debug": true,
  "quick-ops.general.use.ElementUI": true,
  "quick-ops.general.use.ElementPlus": true,
  "quick-ops.general.use.Vant": true,
  "quick-ops.general.use.AntDesignVue": true,
  "quick-ops.general.inlineConstantHints": true,
  "quick-ops.general.anchorViewMode": "mindmap",
  "quick-ops.general.mindMapPosition": "right",
  "quick-ops.git.githubToken": "",
  "quick-ops.git.userName": "",
  "quick-ops.git.userEmail": "",
  "quick-ops.git.defaultSkipVerify": false,
  "quick-ops.git.ignoreList": [],
  "quick-ops.logger.template": "[icon]-[~/^/^/name]-[line]-[$0]",
  "quick-ops.logger.dateFormat": "YYYY-MM-DD HH:mm:ss",
  "quick-ops.utils.uuidLength": 12,
  "quick-ops.shells": [],
  "quick-ops.project.marks": {},
  "quick-ops.project.alias": {
    "@/": "./src/"
  }
}
```

### 常用配置解释

| 配置项 | 说明 |
| --- | --- |
| `quick-ops.general.mockDir` | Mock YAML 接口文件默认存放目录 |
| `quick-ops.general.debug` | 是否开启调试模式 |
| `quick-ops.general.use.ElementUI` | 是否开启 Element UI 智能提示 |
| `quick-ops.general.use.ElementPlus` | 是否开启 Element Plus 智能提示 |
| `quick-ops.general.use.Vant` | 是否开启 Vant 智能提示 |
| `quick-ops.general.use.AntDesignVue` | 是否开启 Ant Design Vue 智能提示 |
| `quick-ops.general.inlineConstantHints` | 是否开启代码内联常量幽灵文字提示 |
| `quick-ops.general.anchorViewMode` | 锚点视图展示模式，支持 `mindmap` / `menu` |
| `quick-ops.general.mindMapPosition` | 思维导图打开位置，支持 `left` / `right` |
| `quick-ops.git.githubToken` | GitHub Token，用于提升远程分支等信息读取稳定性 |
| `quick-ops.git.userName` | Git 提交用户名 |
| `quick-ops.git.userEmail` | Git 提交邮箱 |
| `quick-ops.git.defaultSkipVerify` | 提交时默认是否跳过 hook 校验 |
| `quick-ops.git.ignoreList` | Quick Ops 内部忽略列表 |
| `quick-ops.logger.template` | 日志生成模板 |
| `quick-ops.logger.dateFormat` | 日志时间格式 |
| `quick-ops.utils.uuidLength` | UUID / ID 生成长度 |
| `quick-ops.shells` | 自定义快捷 Shell 脚本 |
| `quick-ops.project.alias` | 项目路径别名映射，用于文件跳转解析 |

---

## 本地开发

### 项目结构

```txt
quick-ops
├─ src/                 # VS Code 扩展主进程代码
├─ webview-ui/          # React Webview UI
├─ resources/           # 图标、Schema、内置配置等资源
├─ .quickopsrc          # Quick Ops 示例配置
├─ package.json         # 扩展声明、命令、配置、构建脚本
└─ README.md
```

### 开发命令

| 命令 | 说明 |
| --- | --- |
| `npm run compile` | 开发模式编译扩展 |
| `npm run watch:ext` | 监听扩展代码变更 |
| `npm run watch:ui` | 监听 Webview UI 变更 |
| `npm run watch:all` | 同时监听扩展和 Webview UI |
| `npm run build:ext` | 生产模式构建扩展 |
| `npm run build:ui` | 构建 Webview UI |
| `npm run build:all` | 同时构建扩展和 Webview UI |
| `npm run build` | 构建并打包 VSIX |
| `npm run lint` | 执行 ESLint |
| `npm run test` | 执行测试 |

### 环境要求

- VS Code：`^1.73.0`
- Node：建议使用仓库 Volta 配置版本
- 主要技术栈：TypeScript、React、VS Code Extension API

---

## 常见问题

### 1. 为什么 UI 组件没有提示？

请检查：

- 当前文件类型是否为 Vue / HTML / JSX / TSX。
- 项目是否安装对应 UI 框架。
- Settings 中是否开启对应框架提示。
- `.quickopsrc` 是否覆盖了相关配置。

### 2. 为什么 Git 管理器没有显示仓库？

请检查：

- 当前 VS Code 是否打开了工作区。
- 当前目录是否是 Git 仓库。
- 系统是否安装 Git。
- 仓库路径是否可以被 VS Code 访问。

### 3. 为什么远程分支读取不稳定？

GitHub API 有频率限制。可以配置：

```json
{
  "quick-ops.git.githubToken": "your_github_token"
}
```

### 4. 为什么“与旧代码对比”只在当前项目出现？

因为该功能需要右侧使用当前工作区真实文件，保证可以编辑和保存。历史项目、远程项目、只读项目无法稳定作为当前工作区可编辑文件，所以不会显示该操作。

### 5. 为什么放弃更改前需要确认？

放弃更改可能删除未跟踪文件或重置本地修改，属于不可恢复操作，所以会使用 VS Code 原生弹窗进行确认。

### 6. 如何临时隐藏某些文件？

使用 QuickOps 忽略列表：

```json
{
  "quick-ops.git.ignoreList": ["dist", "coverage"]
}
```

这样不会修改项目 `.gitignore`。

---

## License

MIT License
