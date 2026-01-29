import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AnchorConfig, AnchorData } from '../core/types/anchor';

export class AnchorService {
  private static instance: AnchorService;
  private anchors: AnchorData[] = [];
  private flotAnchors: AnchorData[] = []; // 扁平化索引，用于快速查找
  private groups: string[] = ['Default'];
  private itemGroups: string[] = [];
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
        this.itemGroups = data.children || [];

        // 初始化扁平索引
        this.refreshFlotAnchors();
      } catch (e) {
        console.error('Failed to load anchors', e);
      }
    }
  }

  private async save() {
    // 1. 立即刷新内存中的扁平索引，确保后续同步代码（如 UI 刷新）能读到最新数据
    this.refreshFlotAnchors();
    // 2. 立即触发事件，让装饰器等同步更新
    this._onDidChangeAnchors.fire();

    if (!this.storagePath) return;

    const data: AnchorConfig = {
      groups: this.groups,
      children: this.itemGroups,
      anchors: this.anchors,
    };

    try {
      // 3. 然后再执行耗时的文件写入
      await fs.promises.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
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

  /**
   * 移动/交换锚点位置 (支持嵌套)
   */
  public moveAnchor(id: string, direction: 'up' | 'down') {
    // 1. 找到该锚点所在的容器数组
    const container = this.findContainerArray(id, this.anchors);
    if (!container) return;

    const { list, index } = container;

    // 2. 计算目标位置
    let targetIndex = -1;
    if (direction === 'up') {
      if (index > 0) targetIndex = index - 1;
    } else {
      if (index < list.length - 1) targetIndex = index + 1;
    }

    if (targetIndex === -1) return; // 无法移动

    // 3. 交换
    [list[index], list[targetIndex]] = [list[targetIndex], list[index]];

    // 更新sort (如果需要保持sort字段同步)
    list.forEach((item, i) => (item.sort = i + 1));

    this.save();
  }

  public updateAnchor(id: string, updates: { line?: number; content?: string; description?: string }) {
    // 使用 flotAnchors 快速查找引用
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

        // 如果修改了 description，且该节点有子项，同步更新子项的 group
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

  // 修改：优先使用扁平数据查询，支持查找深层嵌套的锚点
  public getAnchors(filePath?: string): AnchorData[] {
    if (filePath) {
      const normalizePath = (p: string) => p.replace(/\\/g, '/');
      const targetPath = normalizePath(filePath);
      return this.flotAnchors.filter((a) => normalizePath(a.filePath) === targetPath);
    }
    return this.flotAnchors; // 返回所有（扁平化）
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

  // 添加到根目录
  public addAnchor(anchor: Omit<AnchorData, 'id' | 'timestamp'>) {
    const newAnchor: AnchorData = {
      ...anchor,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
      items: [],
    };
    // 默认放到最后，更新 sort
    if (this.anchors.length > 0) {
      const lastSort = parseInt(String(this.anchors[this.anchors.length - 1].sort || 0));
      newAnchor.sort = isNaN(lastSort) ? 1 : lastSort + 1;
    } else {
      newAnchor.sort = 1;
    }

    this.anchors.push(newAnchor);
    this.save();
  }

  // 添加为子节点
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

  // 插入到指定节点前后 (支持嵌套)
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

    // 继承父级ID
    const targetItem = list[index];
    if (targetItem.pid) {
      newAnchor.pid = targetItem.pid;
    }

    if (position === 'before') {
      list.splice(index, 0, newAnchor);
    } else {
      list.splice(index + 1, 0, newAnchor);
    }

    // 重算该列表所有项的 sort
    list.forEach((item, idx) => (item.sort = idx + 1));

    this.save();
  }

  // 删除 (支持嵌套)
  public removeAnchor(id: string) {
    const container = this.findContainerArray(id, this.anchors);
    if (container) {
      container.list.splice(container.index, 1);
      container.list.forEach((item, idx) => (item.sort = idx + 1));
      this.save();
    }
  }

  public getAnchorById(id: string) {
    // 优先从缓存取，如果没有则重新刷新一下再取
    let found = this.flotAnchors.find((a) => a.id === id);
    if (!found) {
      this.refreshFlotAnchors();
      found = this.flotAnchors.find((a) => a.id === id);
    }
    return found;
  }

  public getNeighborAnchor(currentId: string, direction: 'prev' | 'next'): AnchorData | undefined {
    const flatList = this.flotAnchors;
    const index = flatList.findIndex((a) => a.id === currentId);
    if (index === -1) return undefined;

    if (direction === 'prev') {
      return index > 0 ? flatList[index - 1] : undefined;
    } else {
      return index < flatList.length - 1 ? flatList[index + 1] : undefined;
    }
  }

  public updateAnchorLine(id: string, newLine: number) {
    this.updateAnchor(id, { line: newLine });
  }
}
