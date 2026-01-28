import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AnchorConfig, AnchorData } from '../core/types/anchor';

export class AnchorService {
  private static instance: AnchorService;
  private anchors: AnchorData[] = [];
  private groups: string[] = ['Default'];
  private storagePath: string = '';

  private _onDidChangeAnchors = new vscode.EventEmitter<void>();
  public readonly onDidChangeAnchors = this._onDidChangeAnchors.event;

  private constructor() {}

  public static getInstance(): AnchorService {
    if (!AnchorService.instance) {
      AnchorService.instance = new AnchorService();
    }
    return AnchorService.instance;
  }

  public init(rootPath: string) {
    this.storagePath = path.join(rootPath, '.telemetryrc');
    this.load();
  }

  private load() {
    if (fs.existsSync(this.storagePath)) {
      try {
        const content = fs.readFileSync(this.storagePath, 'utf-8');
        const data: AnchorConfig = JSON.parse(content);
        this.anchors = data.anchors || [];
        this.groups = data.groups || ['Default'];
      } catch (e) {
        console.error('Failed to load anchors', e);
      }
    }
  }

  private async save() {
    if (!this.storagePath) return;
    const data: AnchorConfig = {
      groups: this.groups,
      anchors: this.anchors,
    };
    try {
      await fs.promises.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
      this._onDidChangeAnchors.fire();
    } catch (error) {
      vscode.window.showErrorMessage('无法保存锚点文件: ' + error);
    }
  }

  /**
   * 生成思维导图数据结构 (D3.js Tree 格式)
   */
  public getMindMapData() {
    const root = { name: 'QuickOps Anchors', children: [] as any[] };

    this.groups.forEach((groupName) => {
      const groupAnchors = this.anchors.filter((a) => a.group === groupName);

      // 只有当分组下有锚点，或者显式存在于 groups 列表中时才显示
      const groupNode = {
        name: groupName,
        children: groupAnchors.map((a) => ({
          name: a.description || path.basename(a.filePath), // 优先显示备注，否则显示文件名
          id: a.id,
          data: a, // 携带完整数据供前端跳转使用
        })),
      };

      // 只有当分组有内容时才加入树，避免空节点过多干扰视图（可根据需求调整）
      if (groupNode.children.length > 0) {
        root.children.push(groupNode);
      }
    });

    return root;
  }

  /**
   * 循环交换顺序：当前项与上一项交换；如果是第一项，则与最后一项交换
   */
  public cycleAnchorOrder(id: string) {
    const anchor = this.getAnchorById(id);
    if (!anchor) return;

    // 获取同组锚点
    const groupAnchors = this.anchors.filter((a) => a.group === anchor.group);
    if (groupAnchors.length < 2) return;

    const indexInGroup = groupAnchors.findIndex((a) => a.id === id);
    let targetIndexInGroup = -1;

    if (indexInGroup === 0) {
      targetIndexInGroup = groupAnchors.length - 1; // 第一项换到最后
    } else {
      targetIndexInGroup = indexInGroup - 1; // 否则跟上一个换
    }

    const targetAnchor = groupAnchors[targetIndexInGroup];

    // 在主数组中交换
    const indexA = this.anchors.indexOf(anchor);
    const indexB = this.anchors.indexOf(targetAnchor);

    if (indexA !== -1 && indexB !== -1) {
      [this.anchors[indexA], this.anchors[indexB]] = [this.anchors[indexB], this.anchors[indexA]];
      this.save();
    }
  }

  /**
   * 移动锚点到指定分组的特定位置 (用于“移动/归档”功能)
   */
  public moveAnchorToGroup(anchorId: string, targetGroupName: string, targetIndexInGroup: number, position: 'before' | 'after') {
    const anchorIndex = this.anchors.findIndex((a) => a.id === anchorId);
    if (anchorIndex === -1) return;

    // 1. 从原位置移除
    const [anchor] = this.anchors.splice(anchorIndex, 1);

    // 2. 更新分组
    anchor.group = targetGroupName;

    // 3. 确定插入位置
    const targetGroupAnchors = this.anchors.filter((a) => a.group === targetGroupName);

    if (targetGroupAnchors.length === 0) {
      // 目标组为空，直接追加
      this.anchors.push(anchor);
    } else {
      // 找到目标锚点在全局数组中的位置
      // 注意：targetIndexInGroup 是基于 targetGroupAnchors 的索引
      // 需要做越界保护
      const safeIndex = Math.min(targetIndexInGroup, targetGroupAnchors.length - 1);
      const targetAnchor = targetGroupAnchors[safeIndex];
      const globalTargetIndex = this.anchors.indexOf(targetAnchor);

      if (globalTargetIndex !== -1) {
        if (position === 'before') {
          this.anchors.splice(globalTargetIndex, 0, anchor);
        } else {
          this.anchors.splice(globalTargetIndex + 1, 0, anchor);
        }
      } else {
        // 兜底：如果找不到目标，加到最后
        this.anchors.push(anchor);
      }
    }

    this.save();
  }

  public updateAnchor(id: string, updates: { line?: number; content?: string; description?: string; group?: string }) {
    const anchor = this.anchors.find((a) => a.id === id);
    if (anchor) {
      let changed = false;
      if (updates.line !== undefined && anchor.line !== updates.line) {
        anchor.line = updates.line;
        changed = true;
      }
      if (updates.content !== undefined && anchor.content !== updates.content) {
        anchor.content = updates.content;
        changed = true;
      }
      if (updates.description !== undefined && anchor.description !== updates.description) {
        anchor.description = updates.description;
        changed = true;
      }
      if (updates.group !== undefined && anchor.group !== updates.group) {
        anchor.group = updates.group;
        changed = true;
      }
      if (changed) {
        this.save();
      }
    }
  }

  public getAnchors(filePath?: string): AnchorData[] {
    if (filePath) {
      const normalizePath = (p: string) => p.replace(/\\/g, '/');
      const targetPath = normalizePath(filePath);
      return this.anchors.filter((a) => normalizePath(a.filePath) === targetPath);
    }
    return this.anchors;
  }

  public getGroups(): string[] {
    return this.groups;
  }

  public addGroup(group: string) {
    if (!this.groups.includes(group)) {
      this.groups.push(group);
      this.save();
    }
  }

  public removeGroup(group: string) {
    this.groups = this.groups.filter((g) => g !== group);
    this.save();
  }

  public addAnchor(anchor: Omit<AnchorData, 'id' | 'timestamp'>) {
    const newAnchor: AnchorData = {
      ...anchor,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
    };
    this.anchors.push(newAnchor);
    this.save();
  }

  public insertAnchor(anchor: Omit<AnchorData, 'id' | 'timestamp'>, targetId: string, position: 'before' | 'after') {
    const targetIndex = this.anchors.findIndex((a) => a.id === targetId);
    if (targetIndex === -1) {
      this.addAnchor(anchor);
      return;
    }

    const newAnchor: AnchorData = {
      ...anchor,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
    };

    if (position === 'before') {
      this.anchors.splice(targetIndex, 0, newAnchor);
    } else {
      this.anchors.splice(targetIndex + 1, 0, newAnchor);
    }

    this.save();
  }

  public removeAnchor(id: string) {
    this.anchors = this.anchors.filter((a) => a.id !== id);
    this.save();
  }

  public getAnchorById(id: string) {
    return this.anchors.find((a) => a.id === id);
  }

  public getNeighborAnchor(currentId: string, direction: 'prev' | 'next'): AnchorData | undefined {
    const current = this.getAnchorById(currentId);
    if (!current) return undefined;

    const groupAnchors = this.anchors.filter((a) => a.group === current.group);
    const index = groupAnchors.findIndex((a) => a.id === currentId);

    if (direction === 'prev') {
      return index > 0 ? groupAnchors[index - 1] : undefined;
    } else {
      return index < groupAnchors.length - 1 ? groupAnchors[index + 1] : undefined;
    }
  }

  public updateAnchorLine(id: string, newLine: number) {
    const anchor = this.anchors.find((a) => a.id === id);
    if (anchor && anchor.line !== newLine) {
      anchor.line = newLine;
      this.save();
    }
  }
}
