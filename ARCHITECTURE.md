src
├─ extension.ts
│
├─ app
│  ├─ app.module.ts
│  └─ quick-ops.application.ts
│
├─ core
│  ├─ container
│  │  ├─ container.ts
│  │  ├─ container.type.ts
│  │  └─ token.ts
│  │
│  ├─ module
│  │  ├─ module-runner.ts
│  │  └─ quick-ops-module.interface.ts
│  │
│  └─ lifecycle
│     └─ lifecycle.interface.ts
│
├─ common
│  ├─ common.module.ts
│  │
│  ├─ services
│  │  ├─ configuration.service.ts
│  │  ├─ workspace-state.service.ts
│  │  ├─ editor-context.service.ts
│  │  └─ terminal-executor.service.ts
│  │
│  ├─ providers
│  │  └─ extension-context.provider.ts
│  │
│  ├─ types
│  │  └─ common.type.ts
│  │
│  └─ utils
│     └─ common.util.ts
│
├─ modules
│  ├─ config-management
│  │  ├─ config-management.module.ts
│  │  ├─ config-management.controller.ts
│  │  └─ config-management.type.ts
│  │
│  ├─ file-navigation
│  │  ├─ file-navigation.module.ts
│  │  ├─ file-navigation.controller.ts
│  │  ├─ file-navigation.service.ts
│  │  └─ file-navigation.type.ts
│  │
│  ├─ smart-scroll
│  │  ├─ smart-scroll.module.ts
│  │  ├─ smart-scroll.controller.ts
│  │  └─ smart-scroll.service.ts
│  │
│  ├─ clipboard-transform
│  │  ├─ clipboard-transform.module.ts
│  │  ├─ clipboard-transform.controller.ts
│  │  └─ clipboard-transform.service.ts
│  │
│  ├─ log-enhancer
│  │  ├─ log-enhancer.module.ts
│  │  ├─ log-enhancer.controller.ts
│  │  └─ log-enhancer.service.ts
│  │
│  ├─ editor-history
│  │  ├─ editor-history.module.ts
│  │  ├─ editor-history.controller.ts
│  │  ├─ editor-history.service.ts
│  │  └─ editor-history.type.ts
│  │
│  ├─ mark-decoration
│  │  ├─ mark-decoration.module.ts
│  │  ├─ mark-decoration.controller.ts
│  │  └─ mark-decoration.service.ts
│  │
│  ├─ debug-console
│  │  ├─ debug-console.module.ts
│  │  ├─ debug-console.controller.ts
│  │  └─ debug-console.service.ts
│  │
│  ├─ anchor
│  │  ├─ anchor.module.ts
│  │  ├─ anchor.controller.ts
│  │  ├─ anchor.service.ts
│  │  └─ anchor.type.ts
│  │
│  ├─ mock-server
│  │  ├─ mock-server.module.ts
│  │  ├─ mock-server.controller.ts
│  │  ├─ mock-server.service.ts
│  │  └─ mock-server.type.ts
│  │
│  ├─ package-scripts
│  │  ├─ package-scripts.module.ts
│  │  ├─ package-scripts.controller.ts
│  │  ├─ package-scripts.service.ts
│  │  └─ package-scripts.type.ts
│  │
│  ├─ style-generator
│  │  ├─ style-generator.module.ts
│  │  ├─ style-generator.controller.ts
│  │  └─ style-generator.service.ts
│  │
│  ├─ project-export
│  │  ├─ project-export.module.ts
│  │  ├─ project-export.controller.ts
│  │  └─ project-export.service.ts
│  │
│  ├─ code-snippet
│  │  ├─ code-snippet.module.ts
│  │  ├─ code-snippet.controller.ts
│  │  ├─ code-snippet.service.ts
│  │  └─ code-snippet.type.ts
│  │
│  ├─ snippet-generator
│  │  ├─ snippet-generator.module.ts
│  │  ├─ snippet-generator.controller.ts
│  │  └─ snippet-generator.service.ts
│  │
│  ├─ live-preview
│  │  ├─ live-preview.module.ts
│  │  ├─ live-preview.controller.ts
│  │  ├─ live-preview.service.ts
│  │  ├─ providers
│  │  │  └─ live-preview.provider.ts
│  │  └─ webviews
│  │     └─ live-preview-app
│  │
│  ├─ recent-projects
│  │  ├─ recent-projects.module.ts
│  │  ├─ recent-projects.controller.ts
│  │  ├─ recent-projects.service.ts
│  │  ├─ recent-projects.type.ts
│  │  ├─ providers
│  │  │  ├─ recent-projects.provider.ts
│  │  │  └─ read-only-file-system.provider.ts
│  │  └─ webviews
│  │     └─ recent-projects-app
│  │
│  ├─ component-intellisense
│  │  ├─ component-intellisense.module.ts
│  │  ├─ component-intellisense.controller.ts
│  │  ├─ component-intellisense.service.ts
│  │  ├─ component-intellisense.type.ts
│  │  └─ providers
│  │     └─ component-completion.provider.ts
│  │
│  ├─ text-compare
│  │  ├─ text-compare.module.ts
│  │  ├─ text-compare.controller.ts
│  │  └─ text-compare.service.ts
│  │
│  ├─ git
│  │  ├─ git.module.ts
│  │  ├─ git.controller.ts
│  │  ├─ git.service.ts
│  │  ├─ git.type.ts
│  │  ├─ git.constant.ts
│  │  ├─ providers
│  │  │  ├─ git-webview.provider.ts
│  │  │  └─ git-detail-webview.provider.ts
│  │  └─ webviews
│  │     ├─ git-app
│  │     └─ git-detail-app
│  │
│  ├─ inline-constant-hint
│  │  ├─ inline-constant-hint.module.ts
│  │  ├─ inline-constant-hint.controller.ts
│  │  ├─ inline-constant-hint.service.ts
│  │  └─ providers
│  │     └─ inline-constant-hint.provider.ts
│  │
│  └─ focus-history
│     ├─ focus-history.module.ts
│     ├─ focus-history.controller.ts
│     └─ focus-history.service.ts
│
├─ shared
│  ├─ constants
│  │  ├─ command.constant.ts
│  │  ├─ view.constant.ts
│  │  └─ storage-key.constant.ts
│  │
│  ├─ types
│  │  ├─ command.type.ts
│  │  ├─ view.type.ts
│  │  └─ disposable.type.ts
│  │
│  └─ utils
│     ├─ path.util.ts
│     ├─ file.util.ts
│     ├─ vscode.util.ts
│     └─ color-log.util.ts
│
└─ assets
   ├─ icons
   └─ templates



# Container 依赖注入容器说明

`Container` 是 QuickOps 自定义模块系统中的核心依赖注入容器，作用类似 NestJS 的 IoC Container。

它主要负责：

1. 注册 `provider`
2. 根据 token 查找 provider
3. 自动创建 service / controller / provider 实例
4. 根据 `static inject` 自动注入构造函数依赖
5. 缓存实例，保证默认单例
6. 统一调用 `dispose()` 释放资源
7. 检查 `undefined` 依赖
8. 检查循环依赖

---

## 1. 基本作用

在没有容器之前，如果一个类依赖另一个类，需要手动创建：

```ts
const extensionContextProvider = new ExtensionContextProvider(context);
const gitService = new GitService(extensionContextProvider);
const gitController = new GitController(extensionContextProvider, gitService);
```

使用 `Container` 后，只需要注册 provider：

```ts
container.registerProvider(ExtensionContextProvider);
container.registerProvider(GitService);
container.registerProvider(GitController);
```

然后直接解析：

```ts
const gitController = container.resolve(GitController);
```

容器会自动读取：

```ts
public static inject = [ExtensionContextProvider, GitService];
```

并自动创建依赖实例。

---

## 2. Provider 注册

`Container` 支持 4 种 provider 形式。

### 2.1 类 Provider

```ts
providers: [GitService]
```

等价于：

```ts
container.registerProvider(GitService);
```

容器会使用：

```ts
new GitService(...deps)
```

创建实例。

---

### 2.2 useClass Provider

```ts
{
  provide: GitService,
  useClass: GitService,
}
```

表示当需要 `GitService` 时，使用 `GitService` 这个类创建实例。

---

### 2.3 useValue Provider

```ts
{
  provide: ConfigurationService,
  useValue: ConfigurationService.getInstance(),
}
```

表示当需要 `ConfigurationService` 时，直接返回这个现成实例。

适合已经自己实现单例的服务，例如：

```ts
ConfigurationService.getInstance()
WorkspaceStateService.getInstance()
WorkspaceContextService.getInstance()
```

---

### 2.4 useFactory Provider

```ts
{
  provide: SomeService,
  useFactory: (configService) => {
    return new SomeService(configService);
  },
  inject: [ConfigurationService],
}
```

表示通过工厂函数创建实例。

容器会先解析 `inject` 里的依赖，再调用 `useFactory`。

---

## 3. static inject 依赖声明

每个需要依赖注入的类，都可以通过 `static inject` 声明构造函数依赖。

```ts
export class GitService {
  public static inject = [ExtensionContextProvider];

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
  ) {}
}
```

容器解析 `GitService` 时，会自动转换成：

```ts
const extensionContextProvider = container.resolve(ExtensionContextProvider);
const gitService = new GitService(extensionContextProvider);
```

---

## 4. 实例缓存

容器内部使用：

```ts
private readonly instances = new Map<InjectionToken, any>();
```

缓存已经创建过的实例。

所以同一个 token 默认只会创建一次：

```ts
const a = container.resolve(GitService);
const b = container.resolve(GitService);

console.log(a === b); // true
```

这意味着 service / controller / provider 默认都是单例。

---

## 5. dispose 资源释放

容器会自动收集带有 `dispose()` 方法的实例。

```ts
export class GitWebviewProvider {
  public dispose(): void {
    // 清理资源
  }
}
```

当应用关闭时，调用：

```ts
await container.dispose();
```

容器会倒序调用所有实例的 `dispose()` 方法。

这样可以统一清理：

```txt
WebviewPanel
EventEmitter
FileSystemProvider
监听器
缓存数据
定时器
```

---

## 6. undefined 依赖检查

如果某个依赖 import 错误，或者循环引用导致运行时为 `undefined`，容器会抛出明确错误：

```txt
[Container] GitVirtualContentProvider 的第 1 个 inject 依赖是 undefined。
inject=[undefined]
请检查对应 import 是否写错、是否忘记 export、或者是否存在循环引用。
```

常见原因：

```ts
import { GitService } from '../git.service';
```

但实际文件中只有：

```ts
export default GitService;
```

或者存在循环引用：

```txt
GitService -> GitVirtualContentProvider -> GitService
```

---

## 7. 循环依赖检查

容器内部使用：

```ts
private readonly resolvingStack: string[] = [];
```

记录当前正在解析的依赖链。

如果出现：

```txt
A -> B -> C -> A
```

会抛出：

```txt
[Container] 检测到循环依赖: A -> B -> C -> A
```

这可以帮助快速定位模块重构后的循环引用问题。

---

## 8. 常见错误和修复方式

### 8.1 inject 依赖是 undefined

错误：

```txt
[Container] XXX 的第 1 个 inject 依赖是 undefined
```

检查：

```ts
public static inject = [SomeService];
```

确认 `SomeService` 是否正确导出：

```ts
export class SomeService {}
```

并正确导入：

```ts
import { SomeService } from './some.service';
```

---

### 8.2 provider 是 undefined

错误：

```txt
[Container] 注册 provider 失败：provider 是 undefined
```

检查 module 里的 providers：

```ts
providers: [
  SomeService,
  SomeProvider,
]
```

确认所有类都已经正确 import。

---

### 8.3 循环依赖

错误：

```txt
[Container] 检测到循环依赖: A -> B -> A
```

解决方式：

1. 把公共方法抽到 `xxx.util.ts`
2. 把类型改成 `import type`
3. 避免 service 和 provider 互相 import
4. 必要时改成 controller 手动注入实例

例如：

```ts
// 不推荐
GitService import GitVirtualContentProvider
GitVirtualContentProvider import GitService
```

改成：

```ts
GitService import createGitVirtualContentUri
GitVirtualContentProvider import type GitService
GitController 手动调用 setGitService(...)
```

---

## 9. 在模块系统中的位置

模块结构：

```ts
export const GitModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [GitController],
  providers: [
    GitService,
    GitWebviewProvider,
    GitDetailWebviewProvider,
  ],
  exports: [GitService],
};
```

启动流程大致是：

```txt
QuickOpsApplication
  ↓
ModuleRunner
  ↓
读取 AppModule
  ↓
注册 CommonModule providers
  ↓
注册 GitModule providers
  ↓
resolve GitController
  ↓
自动注入 GitService / Provider
  ↓
调用 controller.onModuleInit()
```

---

## 10. 一句话总结

`Container` 是 QuickOps 模块化架构的依赖注入核心。

它让项目可以像 NestJS 一样写：

```ts
export class GitController {
  public static inject = [
    ExtensionContextProvider,
    GitService,
    GitWebviewProvider,
  ];

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly gitService: GitService,
    private readonly gitWebviewProvider: GitWebviewProvider,
  ) {}
}
```

而不需要在各个地方手动 `new`。

它主要解决：

```txt
依赖创建
依赖注入
单例缓存
生命周期释放
错误定位
循环依赖检查
```
