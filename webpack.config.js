//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const TerserPlugin = require('terser-webpack-plugin');

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const npm_lifecycle_script = process.env.npm_lifecycle_script || '';
const isBuild = npm_lifecycle_script.includes('production');

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
      lodash: 'lodash-es',
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
  devtool: process.env.NODE_ENV === 'production' ? false : 'source-map',
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
    // 3. 只有在 build 时才启用分析器
    // @ts-ignore
    ...(!isBuild
      ? [
          new BundleAnalyzerPlugin({
            analyzerMode: 'static',
            openAnalyzer: false,
            reportFilename: 'bundle-report.html',
            logLevel: 'error',
          }),
        ]
      : []),
    // @ts-ignore
    new webpack.IgnorePlugin({
      resourceRegExp:
        /^(atpl|bracket-template|dot|dust|eco|ect|haml|hamlet|haml-coffee|hogan\.js|htmling|jade|jazz|jqtpl|just|liquor|marko|mote|mustache|nunjucks|plates|pug|qejs|ractive|razor-tmpl|react|react-dom|react-dom\/server|slm|squirrelly|swig|swig-templates|teacup|teacup\/lib\/express|templayed|then-jade|then-pug|toffee|twig|twing|tinyliquid|liquid-node|dustjs-helpers|dustjs-linkedin|ejs|hamljs|handlebars|babel-core|coffee-script|underscore|vash|velocityjs|walrus|whiskers|arc-templates\/dist\/es5)$/,
    }),
    // @ts-ignore: 同样加上忽略，防止 CopyPlugin 类型报错
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
                return JSON.stringify(JSON.parse(jsonStr));
              } catch (e) {
                // @ts-ignore
                console.error(`[Minify Failed] ${path.basename(absoluteFrom)}: ${e.message}`);
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
