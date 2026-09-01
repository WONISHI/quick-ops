import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import htmlMinifier from 'vite-plugin-html-minifier';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

function getPackageVersion(name: string) {
  const packagePath = path.resolve(rootDir, 'node_modules', ...name.split('/'), 'package.json');

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

  return packageJson.version as string;
}

const versions = {
  react: getPackageVersion('react'),
  reactDom: getPackageVersion('react-dom'),
  xyflow: getPackageVersion('@xyflow/react'),
  diff: getPackageVersion('diff'),
  dagre: getPackageVersion('dagre'),
  docxPreview: getPackageVersion('docx-preview'),
  reactPdf: getPackageVersion('react-pdf'),
  reactRouterDom: getPackageVersion('react-router-dom'),
  vditor: getPackageVersion('vditor'),
  xlsx: getPackageVersion('xlsx'),
};

const reactExternals = '?external=react,react-dom';

const cdnImports = {
  react: `https://esm.sh/react@${versions.react}`,

  'react/jsx-runtime': `https://esm.sh/react@${versions.react}/jsx-runtime`,

  'react/jsx-dev-runtime': `https://esm.sh/react@${versions.react}/jsx-dev-runtime`,

  'react-dom': `https://esm.sh/react-dom@${versions.reactDom}?external=react`,

  'react-dom/client': `https://esm.sh/react-dom@${versions.reactDom}/client?external=react`,

  '@xyflow/react': `https://esm.sh/@xyflow/react@${versions.xyflow}${reactExternals}`,

  diff: `https://esm.sh/diff@${versions.diff}`,

  dagre: `https://esm.sh/dagre@${versions.dagre}`,

  'docx-preview': `https://esm.sh/docx-preview@${versions.docxPreview}`,

  'react-pdf': `https://esm.sh/react-pdf@${versions.reactPdf}${reactExternals}`,

  'react-router-dom': `https://esm.sh/react-router-dom@${versions.reactRouterDom}${reactExternals}`,

  vditor: `https://esm.sh/vditor@${versions.vditor}`,

  xlsx: `https://cdn.sheetjs.com/xlsx-${versions.xlsx}/package/xlsx.mjs`,
};

const cdnModules = new Set(['@xyflow/react', 'diff', 'dagre', 'docx-preview', 'react-pdf', 'react-router-dom', 'vditor', 'xlsx']);

function isCdnExternal(id: string) {
  /**
   * React 的子模块也必须 external，
   * 否则 jsx-runtime 又会被打进 bundle。
   */
  if (id === 'react' || id.startsWith('react/')) {
    return true;
  }

  if (id === 'react-dom' || id.startsWith('react-dom/')) {
    return true;
  }

  /**
   * 这里只 external 包入口。
   *
   * 比如：
   *
   * @xyflow/react/dist/style.css
   * vditor/dist/index.css
   *
   * 不会被误 external。
   */
  return cdnModules.has(id);
}

function cdnPlugin(): Plugin {
  return {
    name: 'quick-ops-cdn',

    /**
     * 开发环境继续使用 node_modules，
     * 只有 production build 才使用 CDN。
     */
    apply: 'build',

    transformIndexHtml: {
      order: 'post',

      handler() {
        return [
          {
            tag: 'script',
            attrs: {
              type: 'importmap',

              /**
               * VS Code Webview 加载 HTML 后
               * 替换成真正 nonce。
               */
              nonce: '__QUICK_OPS_NONCE__',
            },
            children: JSON.stringify({
              imports: cdnImports,
            }),
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

export default defineConfig({
  base: './',

  plugins: [
    react(),

    cdnPlugin(),

    htmlMinifier({
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        removeEmptyAttributes: true,
        useShortDoctype: true,
        minifyCSS: true,
        minifyJS: true,
      },
    }),
  ],

  define: {
    __VDITOR_CDN__: JSON.stringify(`https://cdn.jsdelivr.net/npm/vditor@${versions.vditor}`),
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@assets': fileURLToPath(new URL('./src/assets', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@types': fileURLToPath(new URL('./src/types', import.meta.url)),
    },
  },

  build: {
    minify: 'terser',
    cssMinify: true,
    sourcemap: false,
    license: false,

    rollupOptions: {
      external: isCdnExternal,
    },

    terserOptions: {
      compress: {
        passes: 2,
        drop_console: true,
        drop_debugger: true,
      },
      mangle: true,
      format: {
        comments: false,
      },
    },
  },
});
