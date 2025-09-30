import * as vscode from 'vscode';
import EventBus from '../../utils/emitter';
import { resolveResult } from '../../utils/promiseResolve';
import { execSync } from 'child_process';
import { overwriteIgnoreFilesLocally, isGitTracked } from '../../utils/index';
import { MergeProperties, properties } from '../../global-object/properties';
import NotificationService from '../../utils/notificationService';
import type { ConfigFile } from '../../types/Properties';

export default function onPluginInit(config: ConfigFile ='.logrc') {
  switch (config) {
    case '.gitignore':
      return setIgnoredFiles();
    case '.logrc':
      return setLogrc();
    default:
      return;
  }
}

// 设置忽略文件
function setIgnoredFiles() {
  // 给配置文件设置文件忽略
  const igList = [properties.ignorePluginConfig ? '.logrc' : '', ...(properties?.settings?.git || [])];
  // 通知是否启用标记
  EventBus.fire<{ hint: boolean }>('add-ignore', { hint: !!properties?.settings?.git?.length });
  if (!igList.length || (igList.length === 1 && igList[0] === '')) return;
  let result = overwriteIgnoreFilesLocally(igList, (isGitFile: string[]) => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (isGitFile.length) {
      if (!workspaceRoot) return false;
      if (properties.ignoredChanges?.added.length) {
        const skip = properties.ignoredChanges.added.filter((sk: string) => isGitFile.includes(sk));
        execSync(`git update-index --skip-worktree ${skip.join(' ')}`, { stdio: 'ignore', cwd: workspaceRoot });
      }
    }
    if (properties.ignoredChanges?.remove.length) {
      const skip = properties.ignoredChanges.remove.filter((sk: string) => isGitTracked(sk));
      execSync(`git update-index --no-skip-worktree ${skip.join(' ')}`, { stdio: 'ignore', cwd: workspaceRoot });
    }
  });
  MergeProperties({ isGitTracked: !!result });
  if (result) NotificationService.info(`忽略 ${igList.length > 3 ? igList.slice(0, 3).join(',') + '...' : igList.join(',')}文件跟踪！`);
}

// 设置
function setLogrc() {
  setIgnoredFiles();
  resolveResult(true);
}