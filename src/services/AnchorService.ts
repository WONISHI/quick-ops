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
    if (!this.storagePath) return;
    const data: AnchorConfig = {
      groups: this.groups,
      children: this.itemGroups,
      anchors: this.anchors,
    };
    try {
      await fs.promises.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
      // 保存成功后刷新扁平索引，确保数据一致
      this.refreshFlotAnchors();
      this._onDidChangeAnchors.fire();
    } catch (error) {
      vscode.window.showErrorMessage('无法保存锚点文件: ' + error);
    }
  }

  // 🔥 核心工具：刷新扁平化列表 (每次增删改后调用)
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

  // 🔥 核心工具：找到某个ID所在的数组及其索引 (用于删除/移动/插入)
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

        // 🔥 关键修正：如果修改了 description，且该节点有子项，且子项的 group 依赖于父节点的 description
        // 注意：这里假设子节点的 group 属性应该等于父节点的 description (作为子分组名)
        if (anchor.items && anchor.items.length > 0) {
          // 递归更新所有子孙节点的 group 属性
          const updateChildrenGroup = (items: AnchorData[], newGroupName: string) => {
            items.forEach((child) => {
              child.group = newGroupName;
              // 如果子节点还有子节点，且逻辑也是继承分组名，则继续递归
              // 但通常子节点的子节点可能属于更深层的分组，这里仅更新直接子级或者根据你的业务逻辑调整
              // 假设所有后代都属于这个父分组名（扁平化分组视角）：
              if (child.items && child.items.length > 0) {
                // 如果这是个纯粹的层级结构，子项的 group 可能是 "ParentDesc/ChildDesc" ?
                // 既然之前的代码是直接赋值，这里保持一致：
                updateChildrenGroup(child.items, newGroupName);
              }
            });
          };
          // 只有当 description 有值时才作为分组名，防止空字符串导致分组丢失
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
      // 简单的自动递增 sort，实际可能需要更复杂的逻辑
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

      // 子节点的 group 通常应该跟随父节点的标识（如 description 或 group）
      // 这里根据上下文假设，如果父节点是作为分组容器，子节点的 group 属性可能需要同步
      // 但你的入参 anchor 中已经包含了 group，所以以入参为准

      parent.items.push(newAnchor);
      this.save();
    }
  }

  // 插入到指定节点前后 (支持嵌套)
  public insertAnchor(anchor: Omit<AnchorData, 'id' | 'timestamp' | 'sort'>, targetId: string, position: 'before' | 'after') {
    // 找到包含 targetId 的数组
    const container = this.findContainerArray(targetId, this.anchors);

    // 如果找不到 (比如 targetId 不存在)，则默认追加到根
    if (!container) {
      // 这里的 sort 逻辑简单处理为 1，或者你可以查找最大值
      this.addAnchor({ ...anchor, sort: 1 });
      return;
    }

    const { list, index } = container;

    const newAnchor: AnchorData = {
      ...anchor,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
      items: [],
      sort: undefined, // 稍后重算
    };

    // 如果插入的是子节点，可能需要继承 pid
    // 获取 targetItem 以检查其 pid
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
      // 删除后也可以选择重算 sort，保持连续性
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
    // 使用扁平列表进行导航
    const flatList = this.flotAnchors; // 假设导航是基于文件扁平顺序，或者是基于 group 扁平顺序
    // 如果你是希望在“同级”导航，应该用 findContainerArray
    // 这里保留你原本意图：在扁平视图中导航
    const index = flatList.findIndex((a) => a.id === currentId);
    if (index === -1) return undefined;

    if (direction === 'prev') {
      return index > 0 ? flatList[index - 1] : undefined;
    } else {
      return index < flatList.length - 1 ? flatList[index + 1] : undefined;
    }
  }

  public updateAnchorLine(id: string, newLine: number) {
    // 复用 updateAnchor
    this.updateAnchor(id, { line: newLine });
  }
}
