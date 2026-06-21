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
 * 你可以通过 NODE_ENV=production 或 npm run package / production 来启用生产压缩。
 */
const isProduction = process.env.NODE_ENV === 'production' || npm_lifecycle_script.includes('production') || npm_lifecycle_script.includes('package');

const isAnalyze = process.env.ANALYZE === 'true';

// @ts-ignore
function stripJsonComments(jsonString) {
  // @ts-ignore
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
}

/** @type {any[]} */
const plugins = [
  new webpack.IgnorePlugin({
    resourceRegExp:
      /^(atpl|bracket-template|dot|dust|eco|ect|haml|hamlet|haml-coffee|hogan\.js|htmling|jade|jazz|jqtpl|just|liquor|marko|mote|mustache|nunjucks|plates|pug|qejs|ractive|razor-tmpl|react|react-dom|react-dom\/server|slm|squirrelly|swig|swig-templates|teacup|teacup\/lib\/express|templayed|then-jade|then-pug|toffee|twig|twing|tinyliquid|liquid-node|dustjs-helpers|dustjs-linkedin|ejs|hamljs|handlebars|babel-core|coffee-script|underscore|vash|velocityjs|walrus|whiskers|arc-templates\/dist\/es5|kerberos|proxy-agent)$/,
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
  },

  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
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
    /**
     * 调试时必须关掉，不然类名会变成 l / n / r 这种。
     */
    concatenateModules: isProduction,
    minimize: isProduction,
    usedExports: isProduction,

    /**
     * 调试时让模块名更清楚。
     */
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
