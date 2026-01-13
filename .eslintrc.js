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
    "plugin:prettier/recommended",
  ],
  rules: {
    "object-curly-newline": "off",
    "prettier/prettier": [
      "error",
      {
        printWidth: 120,
        bracketSpacing: true,
        singleQuote: true,
        trailingComma: "all",
      },
    ],
  },
};
