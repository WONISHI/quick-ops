import { CompletionItem } from 'vscode';
import { properties } from '../global-object/properties';
import { getLabel } from '../utils/getLable';

class ModuleCompletionItem extends CompletionItem {
  checkFn: ((dp: typeof properties) => boolean) | null | undefined;
}

const cngGen = (position: any) => {
  console.log('cngGen position', position[0], position[1]);
  const cng = new ModuleCompletionItem(getLabel('cng'));
  cng.detail = '自定义console';
  cng.filterText = 'cng';
  cng.insertText = `console.log('hello world');`;
  cng.checkFn = (dp) => {
    return true;
  };
//   console.log('cng', cng);
  return cng;
};

export default [cngGen];
