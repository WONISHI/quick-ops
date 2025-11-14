import * as vscode from 'vscode';
import { useRegisterEditorSelection } from '../hook/useEditorSelection';
import { MixinResolveFile } from '../mixin/mixin-config';
import { mergeGlobalVars, properties } from '../../global-object/properties';

export default async function onSetup(context: vscode.ExtensionContext) {
  // 注册生命周期在context绑定方法
  registerHooks(context);
  mergeGlobalVars({ snippets: await MixinResolveFile(context) });
}

export function registerHooks(context: vscode.ExtensionContext) {
  // 注册hook
  useRegisterEditorSelection(context);
}
