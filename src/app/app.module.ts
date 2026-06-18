import type { QuickOpsModule } from '../core/module/quick-ops-module.interface';
import { CommonModule } from '../common/common.module';

import { ConfigManagementModule } from '../modules/config-management/config-management.module';
import { FileNavigationModule } from '../modules/file-navigation/file-navigation.module';
import { SmartScrollModule } from '../modules/smart-scroll/smart-scroll.module';
import { ClipboardTransformModule } from '../modules/clipboard-transform/clipboard-transform.module';
import { LogEnhancerModule } from '../modules/log-enhancer/log-enhancer.module';
import { EditorHistoryModule } from '../modules/editor-history/editor-history.module';
import { MarkDecorationModule } from '../modules/mark-decoration/mark-decoration.module';
import { DebugConsoleModule } from '../modules/debug-console/debug-console.module';
import { AnchorModule } from '../modules/anchor/anchor.module';
import { MockServerModule } from '../modules/mock-server/mock-server.module';
import { PackageScriptsModule } from '../modules/package-scripts/package-scripts.module';
import { StyleGeneratorModule } from '../modules/style-generator/style-generator.module';
import { ProjectExportModule } from '../modules/project-export/project-export.module';
import { CodeSnippetModule } from '../modules/code-snippet/code-snippet.module';
import { SnippetGeneratorModule } from '../modules/snippet-generator/snippet-generator.module';
import { LivePreviewModule } from '../modules/live-preview/live-preview.module';
import { RecentProjectsModule } from '../modules/recent-projects/recent-projects.module';
import { ComponentIntellisenseModule } from '../modules/component-intellisense/component-intellisense.module';
import { TextCompareModule } from '../modules/text-compare/text-compare.module';
import { GitModule } from '../modules/git/git.module';
import { InlineConstantHintModule } from '../modules/inline-constant-hint/inline-constant-hint.module';
import { FocusHistoryModule } from '../modules/focus-history/focus-history.module';

export const AppModule: QuickOpsModule = {
  imports: [
    CommonModule,

    ConfigManagementModule,
    FileNavigationModule,
    SmartScrollModule,
    ClipboardTransformModule,
    LogEnhancerModule,
    EditorHistoryModule,
    MarkDecorationModule,
    DebugConsoleModule,
    AnchorModule,
    MockServerModule,
    PackageScriptsModule,
    StyleGeneratorModule,
    ProjectExportModule,
    CodeSnippetModule,
    SnippetGeneratorModule,
    LivePreviewModule,
    RecentProjectsModule,
    ComponentIntellisenseModule,
    TextCompareModule,
    GitModule,
    InlineConstantHintModule,
    FocusHistoryModule,
  ],
};