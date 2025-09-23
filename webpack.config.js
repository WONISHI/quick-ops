//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const TerserPlugin = require('terser-webpack-plugin');
//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node',
  mode: 'production',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externalsPresets: { node: true },
  externals: { vscode: 'commonjs vscode' },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },
  devtool: process.env.NODE_ENV === 'production' ? false : 'cheap-module-source-map',
  optimization: {
    usedExports: true,
    sideEffects: true,
    minimize: true,
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          compress: {
            drop_console: true,
            pure_funcs: ['console.log'],
          },
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
  },
  infrastructureLogging: {
    level: 'log',
  },
  plugins: [
    // @ts-ignore
    new BundleAnalyzerPlugin({
      analyzerMode: 'server', // 默认是 server，会开一个 http://127.0.0.1:8888
      analyzerPort: 8888, // 可以改端口
      openAnalyzer: true, // 打包完成自动打开浏览器
      reportFilename: 'report.html', // 如果用 static 模式，生成静态文件
    }),
    // 🔑 忽略 consolidate.js 中用到但你项目没用到的模板引擎
    new webpack.IgnorePlugin({
      resourceRegExp:
        /^(atpl|bracket-template|dot|dust|eco|ect|haml|hamlet|haml-coffee|hogan\.js|htmling|jade|jazz|jqtpl|just|liquor|marko|mote|mustache|nunjucks|plates|pug|qejs|ractive|razor-tmpl|react|react-dom|react-dom\/server|slm|squirrelly|swig|swig-templates|teacup|teacup\/lib\/express|templayed|then-jade|then-pug|toffee|twig|twing|tinyliquid|liquid-node|dustjs-helpers|dustjs-linkedin|ejs|hamljs|handlebars|babel-core|coffee-script|underscore|vash|velocityjs|walrus|whiskers|arc-templates\/dist\/es5)$/,
    }),
  ],
};
module.exports = [extensionConfig];
