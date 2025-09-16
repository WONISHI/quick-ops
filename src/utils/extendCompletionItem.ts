import { CompletionItem } from 'vscode';
import { properties } from '../global-object/properties';

export default class extendCompletionItem extends CompletionItem {
  checkFn: ((dp: typeof properties) => boolean) | null | undefined;
}