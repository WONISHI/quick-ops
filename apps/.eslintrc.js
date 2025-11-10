module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  extends: [
    "eslint:recommended",
    "plugin:prettier/recommended", // 让 eslint 配合 prettier
  ],
  rules: {
    // 关闭 import 花括号换行限制
    "object-curly-newline": "off",

    // 保证 import 不强制换行
    "prettier/prettier": [
      "error",
      {
        printWidth: 120, // 一行最大长度
        bracketSpacing: true,
        singleQuote: true,
        trailingComma: "all",
      },
    ],
  },
};
