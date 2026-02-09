import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { AnchorConfig, AnchorData } from '../core/types/anchor';
import { debounce } from 'lodash-es';

export class AnchorService {
  private static instance: AnchorService;
  private anchors: AnchorData[] = [];
  private flotAnchors: AnchorData[] = [];
  private groups: string[] = ['Default'];
  private itemGroups: string[] = [];

  // 使用 Uri 存储配置路径
  private storageUri: vscode.Uri | undefined;

  private _onDidChangeAnchors = new vscode.EventEmitter<void>();
  public readonly onDidChangeAnchors = this._onDidChangeAnchors.event;

  // 防抖保存函数引用
  private debouncedSave: () => void;

  private constructor() {
    // 初始化防抖保存，500ms 内的多次保存请求合并为一次
    this.debouncedSave = debounce(async () => {
      await this.persist();
    }, 500);
  }

  public static getInstance(): AnchorService {
    if (!AnchorService.instance) {
      AnchorService.instance = new AnchorService();
    }
    return AnchorService.instance;
  }

  public init(rootPath: string) {
    const ws = vscode.workspace.workspaceFolders?.find((w) => w.uri.fsPath === rootPath);
    const rootUri = ws ? ws.uri : vscode.Uri.file(rootPath);

    this.storageUri = vscode.Uri.joinPath(rootUri, '.telemetryrc');
    this.load();
  }

  private async load() {
    if (!this.storageUri) return;

    try {
      const contentUint8 = await vscode.workspace.fs.readFile(this.storageUri);
      const content = new TextDecoder('utf-8').decode(contentUint8);
      const data: AnchorConfig = JSON.parse(content);

      this.anchors = data.anchors || [];
      this.groups = data.groups || ['Default'];
      this.itemGroups = data.children || [];

      this.refreshFlotAnchors();
      this._onDidChangeAnchors.fire();
    } catch (e: any) {
      // 文件不存在是正常情况，初始化为空
      if (e.code !== 'FileNotFound' && e.code !== 'ENOENT') {
        console.error('Failed to load anchors', e);
      }
    }
  }

  // 公开的 save 方法只负责更新状态和触发事件，实际写入磁盘交给防抖函数
  private save() {
    this.refreshFlotAnchors();
    this._onDidChangeAnchors.fire();
    this.debouncedSave();
  }

  // 真正的持久化操作
  private async persist() {
    if (!this.storageUri) return;

    const data: AnchorConfig = {
      groups: this.groups,
      children: this.itemGroups,
      anchors: this.anchors,
    };

    try {
      const content = JSON.stringify(data, null, 2);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(this.storageUri, encoder.encode(content));
    } catch (error) {
      vscode.window.showErrorMessage('无法保存锚点文件: ' + error);
    }
  }

  private refreshFlotAnchors() {
    const _anchors = new Set<AnchorData>();
    const traverse = (items: AnchorData[]) => {
      items.forEach((item) => {
        _anchors.add(item);
        if (item.items && item.items.length > 0) {
          traverse(item.items);
        }
      });
    };
    if (this.anchors.length) {
      traverse(this.anchors);
    }
    this.flotAnchors = Array.from(_anchors);
  }

  private findContainerArray(targetId: string, currentList: AnchorData[]): { list: AnchorData[]; index: number } | null {
    const index = currentList.findIndex((a) => a.id === targetId);
    if (index !== -1) {
      return { list: currentList, index };
    }

    for (const item of currentList) {
      if (item.items && item.items.length > 0) {
        const found = this.findContainerArray(targetId, item.items);
        if (found) return found;
      }
    }
    return null;
  }

  public moveAnchor(id: string, direction: 'up' | 'down') {
    const container = this.findContainerArray(id, this.anchors);
    if (!container) return;

    const { list, index } = container;

    let targetIndex = -1;
    if (direction === 'up') {
      if (index > 0) targetIndex = index - 1;
    } else {
      if (index < list.length - 1) targetIndex = index + 1;
    }

    if (targetIndex === -1) return;

    [list[index], list[targetIndex]] = [list[targetIndex], list[index]];

    list.forEach((item, i) => (item.sort = i + 1));

    this.save();
  }

  public updateAnchor(id: string, updates: { line?: number; content?: string; description?: string }) {
    const anchor = this.getAnchorById(id);
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

        if (anchor.items && anchor.items.length > 0) {
          const updateChildrenGroup = (items: AnchorData[], newGroupName: string) => {
            items.forEach((child) => {
              child.group = newGroupName;
              if (child.items && child.items.length > 0) {
                updateChildrenGroup(child.items, newGroupName);
              }
            });
          };
          if (anchor.description) {
            updateChildrenGroup(anchor.items, anchor.description);
          }
        }
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
      return this.flotAnchors.filter((a) => normalizePath(a.filePath) === targetPath);
    }
    return this.flotAnchors;
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

  public addChild(group: string) {
    if (!this.itemGroups.includes(group)) {
      this.itemGroups.push(group);
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
      items: [],
    };

    const groupAnchors = this.anchors.filter((a) => a.group === anchor.group);

    if (groupAnchors.length > 0) {
      const lastAnchor = groupAnchors[groupAnchors.length - 1];
      const lastSort = parseInt(String(lastAnchor.sort || 0));
      newAnchor.sort = isNaN(lastSort) ? 1 : lastSort + 1;
    } else {
      newAnchor.sort = 1;
    }

    this.anchors.push(newAnchor);
    this.save();
  }

  public addChildAnchor(parentId: string, anchor: Omit<AnchorData, 'id' | 'timestamp' | 'sort'>) {
    const newAnchor: AnchorData = {
      ...anchor,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
      pid: parentId,
      items: [],
      sort: undefined,
    };

    const parent = this.getAnchorById(parentId);
    if (parent) {
      if (!parent.items) parent.items = [];
      const sort = parent.items.length + 1;
      newAnchor.sort = sort;
      parent.items.push(newAnchor);
      this.save();
    }
  }

  public insertAnchor(anchor: Omit<AnchorData, 'id' | 'timestamp' | 'sort'>, targetId: string, position: 'before' | 'after') {
    const container = this.findContainerArray(targetId, this.anchors);

    if (!container) {
      this.addAnchor({ ...anchor, sort: 1 });
      return;
    }

    const { list, index } = container;

    const newAnchor: AnchorData = {
      ...anchor,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
      items: [],
      sort: undefined,
    };

    const targetItem = list[index];

    if (targetItem.pid) {
      newAnchor.pid = targetItem.pid;
    }

    if (position === 'before') {
      list.splice(index, 0, newAnchor);
    } else {
      list.splice(index + 1, 0, newAnchor);
    }

    let sortCounter = 1;
    list.forEach((item) => {
      if (item.group === newAnchor.group) {
        item.sort = sortCounter++;
      }
    });

    this.save();
  }

  public removeAnchor(id: string) {
    const container = this.findContainerArray(id, this.anchors);
    if (container) {
      container.list.splice(container.index, 1);
      container.list.forEach((item, idx) => (item.sort = idx + 1));
      this.save();
    }
  }

  public getAnchorById(id: string) {
    let found = this.flotAnchors.find((a) => a.id === id);
    if (!found) {
      this.refreshFlotAnchors();
      found = this.flotAnchors.find((a) => a.id === id);
    }
    return found;
  }

  public getNeighborAnchor(currentId: string, direction: 'prev' | 'next'): AnchorData | undefined {
    const currentAnchor = this.getAnchorById(currentId);
    if (!currentAnchor) return undefined;

    const groupAnchors = this.flotAnchors.filter((a) => a.group === currentAnchor.group);
    const index = groupAnchors.findIndex((a) => a.id === currentId);
    if (index === -1) return undefined;

    if (direction === 'prev') {
      return index > 0 ? groupAnchors[index - 1] : undefined;
    } else {
      return index < groupAnchors.length - 1 ? groupAnchors[index + 1] : undefined;
    }
  }

  public updateAnchorLine(id: string, newLine: number) {
    this.updateAnchor(id, { line: newLine });
  }

  public getMindMapData() {
    const root = { name: 'Anchors', children: [] as any[] };
    this.groups.forEach((groupName) => {
      const groupAnchors = this.anchors.filter((a) => a.group === groupName);
      const transform = (anchor: AnchorData): any => {
        // 在生成展示数据时，由于不再使用 path 模块，这里简单地处理路径显示
        // 如果需要严格的 basename，可以手写 split 逻辑
        const fileName = anchor.filePath.split(/[/\\]/).pop() || anchor.filePath;
        return {
          name: anchor.description || fileName,
          id: anchor.id,
          data: anchor,
          children: anchor.items ? anchor.items.map(transform) : [],
        };
      };
      const groupNode = {
        name: groupName,
        children: groupAnchors.map(transform),
      };

      if (groupNode.children.length > 0) {
        root.children.push(groupNode);
      }
    });

    return root;
  }
}
