import * as vscode from 'vscode';
import { readLogrcConfig } from '../utils/readLogrcConfig';

export function registerConfig(context: vscode.ExtensionContext) {
  const config = readLogrcConfig();
}
