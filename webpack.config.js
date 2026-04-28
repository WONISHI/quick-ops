//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const TerserPlugin = require('terser-webpack-plugin');

const npm_lifecycle_script = process.env.npm_lifecycle_script || '';
const isProduction = process.env.NODE_ENV === 'production' || npm_lifecycle_script.includes('production') || npm_lifecycle_script.includes('build');

// @ts-ignore
function stripJsonComments(jsonString) {
  // @ts-ignore
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
}


/** @type {any[]} */
const plugins = [
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


if (!isProduction) {
  plugins.push(
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      openAnalyzer: false,
      reportFilename: 'bundle-report.html',
      logLevel: 'error',
    })
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
  },
  externalsPresets: { node: true },
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
    }
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
    concatenateModules: true,
    minimize: isProduction,
    usedExports: true,
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
  plugins: plugins,
};

module.exports = [extensionConfig];
