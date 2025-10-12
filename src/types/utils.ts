import * as vscode from 'vscode';
import type { ExportResult } from '../utils/parse';
import { Request, Response, Express, NextFunction } from 'express';

export const fileTypes = ['vue', 'jsx', 'tsx', 'css', 'less', 'scss', 'html', 'js', 'ts'] as const;
export const HttpStatusCode = [100, 101, 102, 200, 201, 202, 204, 301, 302, 304, 400, 401, 403, 404, 409, 429, 500, 501, 502, 503, 504] as const;

export type FileType = (typeof fileTypes)[number];
export type HttpCode = (typeof HttpStatusCode)[number];

export type ExportNameType = ExportResult | string;

export interface FileEntry {}

export type ActionTextEditor = vscode.TextEditor | null;

export interface ActionEditorInfoOption {
  editor: vscode.TextEditor;
  document: vscode.TextDocument;
  cursorPos: vscode.Position;
  lineText: string;
  text: string;
  offset: number;
}

export interface HttpTemplate {
  code: HttpCode;
  status: boolean;
  data: any;
  [key: string]: any;
}

export interface HttpOptions {
  template: HttpTemplate;
  structure: any;
}

export interface HttpServiceTemplate {
  key: string;
  type: string;
  value: string;
}

export type MethodType = 'get' | 'post' | 'put' | 'delete' | 'all';

export interface MockRoute {
  path: string;
  method: MethodType;
  handler: (req: Request, res: Response) => void;
  active: boolean; // 是否启用
  middlewares?: Array<(req: Request, res: Response, next: NextFunction) => void>;
  update:number; // 0是完成更新，1是准备更新
}

export interface HttpServiceOptions {
  route?: string;
  template: HttpServiceTemplate[];
  isObject?: boolean;
  code?: HttpCode;
  status?: boolean;
  message?: string;
  port?: number;
  method?: MethodType;
  active?:boolean;
}
