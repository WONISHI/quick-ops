module.exports = {
  extends: ["@commitlint/config-conventional"],

  rules: {
    /**
     * 允许的提交类型。
     */
    "type-enum": [
      2,
      "always",
      [
        "feat", // 新功能
        "fix", // 修复 bug
        "docs", // 文档变更
        "style", // 代码格式，不影响运行逻辑
        "refactor", // 代码重构
        "perf", // 性能优化
        "test", // 测试相关
        "chore", // 构建过程或辅助工具调整
        "revert", // 回退提交
        "build", // 打包或构建系统调整
        "ci", // CI 配置调整
      ],
    ],

    /**
     * 不限制 type 大小写。
     */
    "type-case": [0],

    /**
     * 不限制标题结尾标点。
     */
    "subject-full-stop": [0],

    /**
     * 允许提交标题使用中文。
     */
    "subject-case": [0],
  },
};