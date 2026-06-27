import * as vscode from 'vscode';
import { ExtensionContextProvider } from '@/common/providers/extension-context.provider';
import { ColorUtils } from '@/utils/ColorUtils';
import { AnchorService } from '../anchor.service';
import type { AnchorData } from '../anchor.type';

export class AnchorCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  private isInternalUpdate = false;
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly anchorService: AnchorService,
    private readonly extensionContextProvider: ExtensionContextProvider,
  ) {
    /**
     * @description 监听锚点数据变化，并通知 VS Code 重新计算 CodeLens
     *
     * 说明：
     * 1. 用户新增、删除、移动、修改锚点时，会触发 AnchorService.onDidChangeAnchors。
     * 2. CodeLensProvider 监听到变化后，需要调用 changeEmitter.fire() 通知 VS Code 重新拉取 CodeLens。
     * 3. 这里加 200ms 防抖，避免频繁操作时重复刷新。
     * 4. 如果是 CodeLensProvider 内部自动修正锚点行号导致的变化，则通过 isInternalUpdate 跳过本次刷新。
     */
    this.anchorService.onDidChangeAnchors(() => {
      if (this.isInternalUpdate) return;

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.changeEmitter.fire();
      }, 200);
    });
  }

  /**
   * @description 为当前文档生成 CodeLens
   *
   * 处理流程：
   * 1. 获取当前文档相对于工作区的路径
   * 2. 根据相对路径查找该文件下的锚点
   * 3. 校验锚点记录的行号是否仍然匹配原始内容
   * 4. 如果行号偏移，则根据锚点内容重新定位到最近的匹配行
   * 5. 为每个锚点生成父级、当前项、操作按钮 CodeLens
   */
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const relativePath = this.extensionContextProvider.getDocumentRelativePath(document);
    const anchors = this.anchorService.getAnchors(relativePath);
    let contentToLinesMap: Map<string, number[]> | null = null;
    for (const anchor of anchors) {
      let targetLineIndex = Math.max(0, anchor.line - 1);

      if (targetLineIndex >= document.lineCount) {
        continue;
      }
      const currentLineContent = document.lineAt(targetLineIndex).text.trim();
      if (currentLineContent !== anchor.content) {
        if (!contentToLinesMap) {
          contentToLinesMap = this.buildContentToLinesMap(document);
        }
        const candidates = contentToLinesMap.get(anchor.content);
        if (candidates?.length) {
          const foundLineIndex = candidates.reduce((prev, curr) => {
            return Math.abs(curr - targetLineIndex) < Math.abs(prev - targetLineIndex) ? curr : prev;
          });
          targetLineIndex = foundLineIndex;
          try {
            this.isInternalUpdate = true;
            this.anchorService.updateAnchorLine(anchor.id, foundLineIndex + 1);
          } finally {
            this.isInternalUpdate = false;
          }
        } else {
          continue;
        }
      }
      const range = new vscode.Range(targetLineIndex, 0, targetLineIndex, 0);
      this.pushParentCodeLenses(lenses, range, anchor);
      this.pushCurrentCodeLens(lenses, range, anchor);
      this.pushActionCodeLenses(lenses, range, anchor);
    }
    return lenses;
  }

  private buildContentToLinesMap(document: vscode.TextDocument): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const lineText = document.lineAt(lineIndex).text.trim();
      if (!lineText) continue;
      if (!map.has(lineText)) {
        map.set(lineText, []);
      }
      map.get(lineText)?.push(lineIndex);
    }
    return map;
  }

  private pushParentCodeLenses(lenses: vscode.CodeLens[], range: vscode.Range, anchor: AnchorData): void {
    const parents: AnchorData[] = [];
    let currentItem = anchor;
    while (currentItem.pid) {
      const parent = this.anchorService.getAnchorById(currentItem.pid);
      if (!parent) break;
      parents.unshift(parent);
      currentItem = parent;
    }

    parents.forEach((parent) => {
      const emoji = ColorUtils.getEmoji(parent.group);
      lenses.push(
        new vscode.CodeLens(range, {
          title: `${emoji} ${parent.group}:${parent.sort} >`,
          tooltip: `跳转到父分组: ${parent.description || parent.group}`,
          command: 'quick-ops.anchor.listByGroup',
          arguments: [parent.group, parent.id],
        }),
      );
    });
  }

  private pushCurrentCodeLens(lenses: vscode.CodeLens[], range: vscode.Range, anchor: AnchorData): void {
    const emoji = ColorUtils.getEmoji(anchor.group);
    lenses.push(
      new vscode.CodeLens(range, {
        title: `${emoji} ${anchor.group}:${anchor.sort}`,
        tooltip: anchor.description || '查看该组所有锚点',
        command: 'quick-ops.anchor.listByGroup',
        arguments: [anchor.group, anchor.id],
      }),
    );
  }

  private pushActionCodeLenses(lenses: vscode.CodeLens[], range: vscode.Range, anchor: AnchorData): void {
    lenses.push(
      new vscode.CodeLens(range, {
        title: '$(debug-step-out)',
        tooltip: '上一个',
        command: 'quick-ops.anchor.navigate',
        arguments: [anchor.id, 'prev'],
      }),
    );

    lenses.push(
      new vscode.CodeLens(range, {
        title: '$(debug-step-into)',
        tooltip: '下一个',
        command: 'quick-ops.anchor.navigate',
        arguments: [anchor.id, 'next'],
      }),
    );

    lenses.push(
      new vscode.CodeLens(range, {
        title: '$(trash)',
        tooltip: '删除',
        command: 'quick-ops.anchor.delete',
        arguments: [anchor.id],
      }),
    );
  }
}
