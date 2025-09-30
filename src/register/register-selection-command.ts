import * as vscode from 'vscode';
import { useSelection } from '../module/hook/useEditorSelection';
import { fireTrigger } from '../module/mixin/mixin-selection-command';

export function registerSelectionCommand(context: vscode.ExtensionContext) {
  useSelection(({context}) => fireTrigger(context));
}
