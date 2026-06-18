import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';

import { SmartScrollFeature } from '../../features/SmartScrollFeature';
import { CodeSnippetFeature } from '../../features/CodeSnippetFeature';
import { ProjectExportFeature } from '../../features/ProjectExportFeature';
import { FileNavigationFeature } from '../../features/FileNavigationFeature';
import { ConfigManagementFeature } from '../../features/ConfigManagementFeature';
import { LogEnhancerFeature } from '../../features/LogEnhancerFeature';
import { PackageScriptsFeature } from '../../features/PackageScriptsFeature';
import { MarkDecorationFeature } from '../../features/MarkDecorationFeature';
import { StyleGeneratorFeature } from '../../features/StyleGeneratorFeature';
import { AnchorFeature } from '../../features/AnchorFeature';
import { SnippetGeneratorFeature } from '../../features/SnippetGeneratorFeature';
import { ClipboardTransformFeature } from '../../features/ClipboardTransformFeature';
import { EditorHistoryFeature } from '../../features/EditorHistoryFeature';
import { MockServerFeature } from '../../features/MockServerFeature';
import { DebugConsoleFeature } from '../../features/DebugConsoleFeature';
import { LivePreviewFeature } from '../../features/LivePreviewFeature';
import { RecentProjectsFeature } from '../../features/RecentProjectsFeature';
import { ComponentIntellisenseFeature } from '../../features/ComponentIntellisenseFeature';
import { TextCompareFeature } from '../../features/TextCompareFeature';
import { GitFeature } from '../../features/GitFeature';
import { InlineConstantHintFeature } from '../../features/InlineConstantHintFeature';
import { FocusHistoryFeature } from '../../features/FocusHistoryFeature';

export const LegacyFeaturesModule: QuickOpsModule = {
  features: [
    ConfigManagementFeature,
    FileNavigationFeature,
    SmartScrollFeature,
    ClipboardTransformFeature,
    LogEnhancerFeature,
    EditorHistoryFeature,
    MarkDecorationFeature,
    DebugConsoleFeature,
    AnchorFeature,
    MockServerFeature,
    PackageScriptsFeature,
    StyleGeneratorFeature,
    ProjectExportFeature,
    CodeSnippetFeature,
    SnippetGeneratorFeature,
    LivePreviewFeature,
    RecentProjectsFeature,
    ComponentIntellisenseFeature,
    TextCompareFeature,
    GitFeature,
    InlineConstantHintFeature,
    FocusHistoryFeature,
  ],
};