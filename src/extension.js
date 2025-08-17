"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const register_config_1 = require("./register/register-config");
const register_area_search_1 = require("./register/register-area-search");
const register_completion_1 = require("./register/register-completion");
const register_extension_1 = require("./register/register-extension");
function activate(context) {
    // 注册获取配置项
    (0, register_config_1.registerConfig)(context)?.then((res) => {
        console.log('Logrc Config:', res);
    });
    // 注册区域搜索
    (0, register_area_search_1.registerAreaSearch)(context);
    // 注册 console 插入
    (0, register_completion_1.registerCompletion)(context);
    // 注册文件定位
    (0, register_extension_1.registerExtension)(context);
    // tab+a / tab+d 上下切换
}
function deactivate() {
    if (register_area_search_1.decorationType) {
        register_area_search_1.decorationType.dispose();
    }
}
//# sourceMappingURL=extension.js.map