//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const TerserPlugin = require('terser-webpack-plugin');

const npm_lifecycle_script = process.env.npm_lifecycle_script || '';

/**
 * 注意：
 * 调试时不要因为 script 名称里有 build 就强制 production。
 * 可以通过 NODE_ENV=production 或 npm run package / production
 * 来启用生产压缩。
 */
const isProduction = process.env.NODE_ENV === 'production' || npm_lifecycle_script.includes('production') || npm_lifecycle_script.includes('package');

const isAnalyze = process.env.ANALYZE === 'true';

/**
 * 去除 JSON / JSONC 文件中的注释。
 *
 * @param {string} jsonString
 * @returns {string}
 */
function stripJsonComments(jsonString) {
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, comment) => (comment ? '' : match));
}

/** @type {any[]} */
const plugins = [
  new webpack.IgnorePlugin({
    resourceRegExp:
      /^(atpl|bracket-template|dot|dust|eco|ect|haml|hamlet|haml-coffee|hogan\.js|htmling|jade|jazz|jqtpl|just|liquor|marko|mote|mustache|nunjucks|plates|pug|qejs|ractive|razor-tmpl|react|react-dom|react-dom\/server|slm|squirrelly|swig|swig-templates|teacup|teacup\/lib\/express|templayed|then-jade|then-pug|toffee|twig|twing|tinyliquid|liquid-node|dustjs-helpers|dustjs-linkedin|ejs|hamljs|handlebars|babel-core|coffee-script|underscore|vash|velocityjs|walrus|whiskers|arc-templates\/dist\/es5|kerberos|proxy-agent)$/,
  }),

  /**
   * 将所有异步 Chunk 合并到入口 Chunk。
   *
   * 最终 dist 中只生成：
   * dist/extension.js
   *
   * 不再生成：
   * dist/353.js
   * dist/461.js
   * dist/vendors-xxx.js
   * dist/node_modules_xxx.js
   */
  new webpack.optimize.LimitChunkCountPlugin({
    maxChunks: 1,
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
];

if (isAnalyze) {
  plugins.push(
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      openAnalyzer: false,
      reportFilename: 'bundle-report.html',
      logLevel: 'error',
    }),
  );
}

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node16',
  mode: isProduction ? 'production' : 'development',

  entry: {
    extension: './src/extension.ts',
  },

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs',

    /**
     * 每次构建前清理 dist。
     *
     * 这是必须增加的，否则旧的 353.js、vendors-xxx.js 等文件
     * 即使本次不再生成，也可能继续残留在 dist 中并被 vsce 打包。
     */
    clean: true,

    devtoolModuleFilenameTemplate: (info) => {
      return `webpack://quick-ops/${info.resourcePath.replace(/\\/g, '/')}`;
    },
  },

  externalsPresets: {
    node: true,
  },

  externals: {
    vscode: 'commonjs vscode',
    bufferutil: 'bufferutil',
    'utf-8-validate': 'utf-8-validate',
  },

  cache: {
    type: 'filesystem',

    /**
     * webpack.config.js 变化后让文件缓存正确失效。
     */
    buildDependencies: {
      config: [__filename],
    },
  },

  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@app': path.resolve(__dirname, 'src/app'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@common': path.resolve(__dirname, 'src/common'),
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@workflow': path.resolve(__dirname, 'src/workflow'),
      '@plugins': path.resolve(__dirname, 'src/plugins'),
      lodash: 'lodash-es',
    },
  },

  ignoreWarnings: [
    {
      module: /express[\\/]lib[\\/]view\.js/,
      message: /Critical dependency: the request of a dependency is an expression/,
    },
    {
      module: /@vue[\\/]compiler-sfc/,
      message: /Critical dependency/,
    },
    {
      module: /[\\/]node_modules[\\/](@puppeteer|puppeteer-core|@puppeteer\/browsers)[\\/]/,
      message: /Critical dependency: require function is used in a way/,
    },
  ],

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

  devtool: isProduction ? false : 'source-map',

  optimization: {
    splitChunks: false,
    runtimeChunk: false,

    concatenateModules: isProduction,
    minimize: isProduction,
    usedExports: isProduction,

    moduleIds: isProduction ? 'deterministic' : 'named',
    chunkIds: isProduction ? 'deterministic' : 'named',

    minimizer: [
      new TerserPlugin({
        parallel: true,
        extractComments: false,
        terserOptions: {
          /**
           * 即使生产构建，也尽量保留类名/函数名。
           * 这样 DI 报错时不会只看到 class l。
           */
          keep_classnames: true,
          keep_fnames: true,
          mangle: {
            keep_classnames: true,
            keep_fnames: true,
          },
          compress: {
            keep_fnames: true,
            passes: 2,
          },

          format: {
            comments: false,
            beautify: false,
          },
        },
      }),
    ],
  },

  infrastructureLogging: {
    level: 'log',
  },

  stats: {
    errorDetails: true,
  },

  plugins,
};

module.exports = [extensionConfig];
