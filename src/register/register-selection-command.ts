import * as vscode from 'vscode';
import { useEditorSelection } from '../module/hook/useEditorSelection';
import { fireTrigger } from '../module/mixin/mixin-selection-command';

export function registerSelectionCommand(context: vscode.ExtensionContext) {
  useEditorSelection(({context}) => fireTrigger(context));
}
