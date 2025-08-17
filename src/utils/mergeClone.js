"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = mergeClone;
function mergeClone(obj1, obj2) {
    const result = { ...obj1 };
    for (const key in obj2) {
        if (obj2.hasOwnProperty(key)) {
            const val1 = obj1[key];
            const val2 = obj2[key];
            if (val1 &&
                typeof val1 === 'object' &&
                val1 !== null &&
                !Array.isArray(val1) &&
                val2 &&
                typeof val2 === 'object' &&
                val2 !== null &&
                !Array.isArray(val2)) {
                result[key] = mergeClone(val1, val2);
            }
            else {
                result[key] = val2;
            }
        }
    }
    return result;
}
//# sourceMappingURL=mergeClone.js.map