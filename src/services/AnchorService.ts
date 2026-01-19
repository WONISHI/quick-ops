import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AnchorConfig, AnchorData } from '../core/types/anchor';

export class AnchorService {
  private static instance: AnchorService;
  private anchors: AnchorData[] = [];
  private groups: string[] = ['Default'];
  private storagePath: string = '';

  // 🔥 修正部分：只需要定义 _onDidChangeAnchors 及其 event
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
      this._onDidChangeAnchors.fire();
    } catch (error) {
      vscode.window.showErrorMessage('无法保存锚点文件: ' + error);
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

  // 普通添加
  public addAnchor(anchor: Omit<AnchorData, 'id' | 'timestamp'>) {
    const newAnchor: AnchorData = {
      ...anchor,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
    };
    this.anchors.push(newAnchor);
    this.save();
  }

  // 插入指定位置 (支持自定义排序)
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

  // 获取相邻锚点 (严格按照数组顺序)
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
      this.save(); // 保存到 json
    }
  }
}
