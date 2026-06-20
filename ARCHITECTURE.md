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