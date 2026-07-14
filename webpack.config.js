//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const TerserPlugin = require('terser-webpack-plugin');

/**
 * @param {Record<string, unknown>} _env
 * @param {{ mode?: 'none' | 'development' | 'production' }} argv
 * @returns {import('webpack').Configuration[]}
 */
module.exports = (_env, argv = {}) => {
  /**
   * 直接使用 webpack CLI 传入的 --mode 判断环境。
   *
   * 例如：
   * webpack --mode production
   * webpack --mode development
   */
  const isProduction = argv.mode === 'production' || process.env.NODE_ENV === 'production';

  const isAnalyze = process.env.ANALYZE === 'true';

  /** @type {any[]} */
  const plugins = [
    new webpack.IgnorePlugin({
      resourceRegExp:
        /^(atpl|bracket-template|dot|dust|eco|ect|haml|hamlet|haml-coffee|hogan\.js|htmling|jade|jazz|jqtpl|just|liquor|marko|mote|mustache|nunjucks|plates|pug|qejs|ractive|razor-tmpl|react|react-dom|react-dom\/server|slm|squirrelly|swig|swig-templates|teacup|teacup\/lib\/express|templayed|then-jade|then-pug|toffee|twig|twing|tinyliquid|liquid-node|dustjs-helpers|dustjs-linkedin|ejs|hamljs|handlebars|babel-core|coffee-script|underscore|vash|velocityjs|walrus|whiskers|arc-templates\/dist\/es5|kerberos|proxy-agent)$/,
    }),

    /**
     * 将所有异步 Chunk 合并到 extension.js。
     *
     * 最终不会再生成：
     * 353.js
     * 461.js
     * vendors-xxx.js
     * node_modules_xxx.js
     */
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1,
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

    /**
     * webpack --mode production 时使用生产模式。
     */
    mode: isProduction ? 'production' : 'development',

    entry: {
      extension: './src/extension.ts',
    },

    output: {
      path: path.resolve(__dirname, 'dist'),

      filename: '[name].js',

      libraryTarget: 'commonjs',

      /**
       * 每次重新构建前清理 dist。
       *
       * 删除之前遗留的 Chunk 和 dist/resources。
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

    /**
     * 生产环境生成隐藏 Source Map，
     * 开发环境生成普通 Source Map。
     */
    devtool: isProduction ? 'hidden-source-map' : 'source-map',

    optimization: {
      /**
       * 关闭自动公共模块拆包。
       */
      splitChunks: false,

      /**
       * 不单独生成 runtime 文件。
       */
      runtimeChunk: false,

      /**
       * 生产环境开启模块合并。
       */
      concatenateModules: isProduction,

      /**
       * 生产环境开启 Terser 压缩。
       */
      minimize: isProduction,

      /**
       * 生产环境开启 Tree Shaking。
       */
      usedExports: isProduction,

      moduleIds: isProduction ? 'deterministic' : 'named',

      chunkIds: isProduction ? 'deterministic' : 'named',

      minimizer: [
        new TerserPlugin({
          parallel: true,

          /**
           * 不生成 extension.js.LICENSE.txt。
           */
          extractComments: false,

          terserOptions: {
            /**
             * 保留类名和函数名，便于排查 DI 错误。
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

            /**
             * 删除构建产物里的注释和格式化空格。
             */
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

  console.log(`[Webpack] mode=${extensionConfig.mode}, minimize=${isProduction}`);

  return [extensionConfig];
};
