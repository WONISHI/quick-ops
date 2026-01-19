import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AnchorConfig, AnchorData } from '../core/types/anchor';

export class AnchorService {
  private static instance: AnchorService;
  private anchors: AnchorData[] = [];
  private groups: string[] = ['Default']; // 默认分组
  private storagePath: string = '';

  // 用于通知 CodeLens 更新
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
    // 🔥 修改：直接在根目录下创建 anchors.json，不再放入 .vscode 文件夹
    this.storagePath = path.join(rootPath, 'anchors.json');
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

  private save() {
    if (!this.storagePath) return;
    const data: AnchorConfig = {
      groups: this.groups,
      anchors: this.anchors,
    };
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
      this._onDidChangeAnchors.fire(); // 触发更新
    } catch (error) {
      vscode.window.showErrorMessage('无法保存锚点文件: ' + error);
    }
  }

  public getAnchors(filePath?: string): AnchorData[] {
    if (filePath) {
      // 统一路径分隔符对比，防止 Windows/Mac 路径差异
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

  public addAnchor(anchor: Omit<AnchorData, 'id' | 'timestamp'>) {
    // 移除同一行已存在的锚点（避免重叠）
    this.anchors = this.anchors.filter((a) => !(a.filePath === anchor.filePath && a.line === anchor.line));

    const newAnchor: AnchorData = {
      ...anchor,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
    };
    this.anchors.push(newAnchor);

    // 按文件和行号排序
    this.anchors.sort((a, b) => {
      if (a.filePath === b.filePath) return a.line - b.line;
      return a.filePath.localeCompare(b.filePath);
    });
    this.save();
  }

  public removeAnchor(id: string) {
    this.anchors = this.anchors.filter((a) => a.id !== id);
    this.save();
  }

  public getAnchorById(id: string) {
    return this.anchors.find((a) => a.id === id);
  }

  // 获取同一文件中的上一个/下一个锚点
  // 获取全局的上一个/下一个锚点 (支持跨文件跳转)
  public getNeighborAnchor(currentId: string, direction: 'prev' | 'next'): AnchorData | undefined {
    const current = this.getAnchorById(currentId);
    if (!current) return undefined;

    // 🔥 核心修改 1: 获取所有锚点，不再只获取当前文件的锚点
    // const fileAnchors = this.getAnchors(current.filePath)... // 旧代码(删除)

    // 复制一份所有锚点数组
    const allAnchors = [...this.anchors];

    // 🔥 核心修改 2: 全局排序
    // 规则: 先按文件路径字母顺序排，如果文件相同，则按行号排
    allAnchors.sort((a, b) => {
      if (a.filePath === b.filePath) {
        return a.line - b.line;
      }
      return a.filePath.localeCompare(b.filePath);
    });

    // 3. 在全局列表中找索引
    const index = allAnchors.findIndex((a) => a.id === currentId);

    if (direction === 'prev') {
      //如果是第一个，且你想循环跳转(可选)，可以返回最后一个：allAnchors[allAnchors.length - 1]
      return index > 0 ? allAnchors[index - 1] : undefined;
    } else {
      //如果是最后一个，且你想循环跳转(可选)，可以返回第一个：allAnchors[0]
      return index < allAnchors.length - 1 ? allAnchors[index + 1] : undefined;
    }
  }

  public updateAnchorLine(id: string, newLine: number) {
    const anchor = this.anchors.find((a) => a.id === id);
    if (anchor && anchor.line !== newLine) {
      anchor.line = newLine;
      this.save(); // 保存到 json
    }
  }
}
