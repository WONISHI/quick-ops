//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const TerserPlugin = require('terser-webpack-plugin');
//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

// @ts-ignore
function stripJsonComments(jsonString) {
  // @ts-ignore
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
}

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node16',
  mode: 'production',
  entry: {
    extension: './src/extension.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs',
  },
  externalsPresets: { node: true },
  externals: { vscode: 'commonjs vscode' },
  cache: {
    type: 'filesystem',
  },
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
            options: {
              transpileOnly: true,
            },
          },
        ],
      },
    ],
  },
  devtool: process.env.NODE_ENV === 'production' ? 'hidden-source-map' : 'source-map',
  optimization: {
    concatenateModules: true,
    minimize: true,
    usedExports: true,
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          priority: 10,
          enforce: true,
        },
      },
    },
    minimizer: [
      new TerserPlugin({
        parallel: true,
        extractComments: false,
      }),
    ],
  },
  infrastructureLogging: {
    level: 'log',
  },
  plugins: [
    // @ts-ignore
    // new BundleAnalyzerPlugin({
    //   analyzerMode: 'server', // 默认是 server，会开一个 http://127.0.0.1:8888
    //   analyzerPort: 8888, // 可以改端口
    //   openAnalyzer: true, // 打包完成自动打开浏览器
    //   reportFilename: 'report.html', // 如果用 static 模式，生成静态文件
    // }),
    // 🔑 忽略 consolidate.js 中用到但你项目没用到的模板引擎
    new webpack.IgnorePlugin({
      resourceRegExp:
        /^(atpl|bracket-template|dot|dust|eco|ect|haml|hamlet|haml-coffee|hogan\.js|htmling|jade|jazz|jqtpl|just|liquor|marko|mote|mustache|nunjucks|plates|pug|qejs|ractive|razor-tmpl|react|react-dom|react-dom\/server|slm|squirrelly|swig|swig-templates|teacup|teacup\/lib\/express|templayed|then-jade|then-pug|toffee|twig|twing|tinyliquid|liquid-node|dustjs-helpers|dustjs-linkedin|ejs|hamljs|handlebars|babel-core|coffee-script|underscore|vash|velocityjs|walrus|whiskers|arc-templates\/dist\/es5)$/,
    }),
    new CopyPlugin({
      patterns: [
        {
          from: 'resources',
          to: 'resources',
          globOptions: {
            ignore: ['**/.DS_Store'],
          },
          transform(content, absoluteFrom) {
            if (absoluteFrom.endsWith('.json')) {
              try {
                let jsonStr = content.toString();
                jsonStr = stripJsonComments(jsonStr);
                const jsonObj = JSON.parse(jsonStr);
                const minified = JSON.stringify(jsonObj);
                console.log(`[Minified] ${path.basename(absoluteFrom)}`);
                return minified;
              } catch (e) {
                // @ts-ignore
                console.error(`[Minify Failed] ${absoluteFrom}: ${e.message}`);
                return content;
              }
            }
            return content;
          },
        },
      ],
    }),
  ],
};
module.exports = [extensionConfig];
