import * as vscode from 'vscode';
import { AnchorConfig, AnchorData } from '../core/types/anchor';
import { debounce } from 'lodash-es';

export class AnchorService {
  private static instance: AnchorService;
  private anchors: AnchorData[] = [];
  private flotAnchors: AnchorData[] = [];
  private groups: string[] = ['Default'];
  private itemGroups: string[] = [];

  // 🌟 核心修改：改为保存 VS Code 上下文，不再保存物理文件 URI
  private context: vscode.ExtensionContext | undefined;
  private readonly stateKey = 'quickOps.workspaceAnchors'; // 工作区存储的 Key

  private _onDidChangeAnchors = new vscode.EventEmitter<void>();
  public readonly onDidChangeAnchors = this._onDidChangeAnchors.event;

  private debouncedSave: () => void;

  private constructor() {
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

  // 🌟 核心修改：接收 context 而不是 rootPath
  public init(context: vscode.ExtensionContext) {
    this.context = context;
    this.load();
  }

  private load() {
    if (!this.context) return;

    try {
      // 🌟 核心修改：直接从当前工作区的内部状态中读取数据，速度极快，不触碰硬盘文件
      const data = this.context.workspaceState.get<AnchorConfig>(this.stateKey);

      if (data) {
        this.anchors = data.anchors || [];
        this.groups = data.groups || ['Default'];
        this.itemGroups = data.children || [];
      } else {
        this.anchors = [];
        this.groups = ['Default'];
        this.itemGroups = [];
      }

      this.refreshFlotAnchors();
      this._onDidChangeAnchors.fire();
    } catch (e: any) {
      console.error('Failed to load anchors from workspace state', e);
    }
  }

  private save() {
    this.refreshFlotAnchors();
    this._onDidChangeAnchors.fire();
    this.debouncedSave();
  }

  private async persist() {
    if (!this.context) return;

    const data: AnchorConfig = {
      groups: this.groups,
      children: this.itemGroups,
      anchors: this.anchors,
    };

    try {
      // 🌟 核心修改：将数据保存到 VS Code 的工作区内部状态中
      await this.context.workspaceState.update(this.stateKey, data);
    } catch (error: any) {
      vscode.window.showErrorMessage('无法保存锚点到工作区状态: ' + error.message);
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