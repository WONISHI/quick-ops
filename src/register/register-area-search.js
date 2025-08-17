"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAreaSearch = exports.decorationType = void 0;
const vscode = __importStar(require("vscode"));
exports.decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 255, 0, 0.3)',
    borderRadius: '2px',
});
const registerAreaSearch = (context) => {
    // 监听搜索打开前清除高亮（通过命令拦截）
    const resetBeforeFindCommand = vscode.commands.registerCommand('scope-search.resetBeforeFind', () => {
        resetHighlight();
        // 调用原生搜索命令打开搜索面板
        vscode.commands.executeCommand('actions.find');
    });
    // 1. 注册搜索命令-区域搜索指令
    const searchCommand = vscode.commands.registerCommand('scope-search.search', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('没有激活的编辑器');
            return;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showWarningMessage('请先选中文本');
            return;
        }
        const text = editor.document.getText(selection);
        const result = await vscode.window.showInputBox({
            prompt: '请输入正则表达式（无需加 //，默认全局匹配）',
            placeHolder: '例如 foo|bar',
            validateInput: (input) => (input.trim() === '' ? '输入不能为空' : null),
        });
        if (result === undefined) {
            vscode.window.showInformationMessage('用户取消输入');
            return;
        }
        let regex;
        try {
            regex = new RegExp(result, 'g');
        }
        catch {
            vscode.window.showErrorMessage('无效的正则表达式');
            return;
        }
        const startOffset = editor.document.offsetAt(selection.start);
        const decorationsArray = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const matchStart = startOffset + match.index;
            const matchEnd = matchStart + match[0].length;
            const startPos = editor.document.positionAt(matchStart);
            const endPos = editor.document.positionAt(matchEnd);
            decorationsArray.push({
                range: new vscode.Range(startPos, endPos),
                hoverMessage: `匹配关键字: **${match[0]}**`,
            });
            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
        }
        editor.setDecorations(exports.decorationType, decorationsArray);
        vscode.window.showInformationMessage(`匹配到 ${decorationsArray.length} 处，输入的正则：${result}`);
    });
    // 2. 注册重置高亮命令
    const resetCommand = vscode.commands.registerCommand('scope-search.resetHighlight', () => {
        resetHighlight();
    });
    function resetHighlight() {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.setDecorations(exports.decorationType, []);
            // vscode.window.showInformationMessage("已清除搜索高亮"); // 可选
        }
    }
    context.subscriptions.push(searchCommand, resetCommand, resetBeforeFindCommand);
};
exports.registerAreaSearch = registerAreaSearch;
//# sourceMappingURL=register-area-search.js.map