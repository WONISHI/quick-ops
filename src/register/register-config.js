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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerConfig = registerConfig;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readLogrcConfig_1 = require("../utils/readLogrcConfig");
const mergeClone_1 = __importDefault(require("../utils/mergeClone"));
function registerConfig(context) {
    let configContext = null;
    const pkgPath = path.join(context.extensionPath, 'package.json');
    if (!fs.existsSync(pkgPath))
        return;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const id = `${pkg.publisher}.${pkg.name}`;
    const extensionPath = vscode.extensions.getExtension(id)?.extensionPath;
    (0, readLogrcConfig_1.registerLogrcConfig)(context);
    return new Promise(async (resolve) => {
        if (extensionPath) {
            const pluginConfig = path.join(extensionPath, '.logrc');
            if (fs.existsSync(pluginConfig)) {
                const document = await vscode.workspace.openTextDocument(pluginConfig);
                configContext = JSON.parse(document.getText());
                resolve(configContext);
            }
        }
        (0, readLogrcConfig_1.onDidChangeLogrcConfig)((cfg) => {
            resolve((0, mergeClone_1.default)(configContext, cfg));
        });
    });
}
//# sourceMappingURL=register-config.js.map