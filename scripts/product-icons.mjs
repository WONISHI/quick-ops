import path from 'node:path';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createSVG, createTTF, createWOFF } from 'svgtofont/lib/utils';

const src = path.resolve(process.cwd(), 'resources/view-icon/svg');
const dist = path.resolve(process.cwd(), 'resources/view-icon/font');

const fontName = 'quickops-icons';
const startUnicode = 0xea01;

// 修改生成规则时手动 +1，让缓存自动失效
const generatorVersion = 1;

const woffPath = path.join(dist, `${fontName}.woff`);
const infoPath = path.join(dist, 'info.json');

const tempSvgPath = path.join(dist, `${fontName}.svg`);
const tempTtfPath = path.join(dist, `${fontName}.ttf`);

const fontOptions = {
  fontName,
  startUnicode,
  svgicons2svgfont: {
    fontHeight: 1000,
    normalize: true,
  },
};

/**
 * 判断文件是否存在
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取所有 SVG
 */
async function getSvgFiles() {
  const files = await readdir(src, {
    withFileTypes: true,
  });

  return files
    .filter((file) => file.isFile() && path.extname(file.name).toLowerCase() === '.svg')
    .map((file) => file.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * 计算当前字体源 Hash
 *
 * SVG 文件名、SVG 内容、字体配置发生变化都会重新生成
 */
async function createSourceHash(svgFiles) {
  const hash = createHash('sha256');

  hash.update(
    JSON.stringify({
      generatorVersion,
      fontName,
      startUnicode,
      svgicons2svgfont: fontOptions.svgicons2svgfont,
    }),
  );

  for (const fileName of svgFiles) {
    const filePath = path.join(src, fileName);
    const content = await readFile(filePath);

    hash.update(fileName);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  return hash.digest('hex');
}

/**
 * 读取之前生成的 info.json
 */
async function readPreviousInfo() {
  if (!(await fileExists(infoPath))) {
    return null;
  }

  try {
    return JSON.parse(await readFile(infoPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * \\ea01 -> 0xea01
 */
function encodedCodeToNumber(encodedCode) {
  if (typeof encodedCode !== 'string') {
    return null;
  }

  const match = encodedCode.match(/^\\([0-9a-f]+)$/i);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 16);
}

/**
 * 0xea01 -> \\ea01
 */
function numberToEncodedCode(code) {
  return `\\${code.toString(16)}`;
}

/**
 * 创建稳定的 Unicode 映射
 *
 * 已存在图标：
 * 保留原 fontCharacter
 *
 * 新增图标：
 * 从当前最大 Unicode 后继续分配
 */
function createUnicodeMap(svgFiles, previousInfo) {
  const currentNames = svgFiles.map((fileName) => path.basename(fileName, '.svg'));

  /**
   * 保存历史映射。
   *
   * 即使某个 SVG 删除了，也暂时保留它使用过的 Unicode，
   * 避免后续新图标占用旧 Unicode。
   */
  const persistentMap = {
    ...(previousInfo?.__meta?.unicodeMap || {}),
  };

  /**
   * 兼容第一次升级到这个生成逻辑：
   * 如果旧 info.json 没有 __meta.unicodeMap，
   * 从原来的 icon 信息恢复。
   */
  if (!previousInfo?.__meta?.unicodeMap && previousInfo) {
    for (const [name, data] of Object.entries(previousInfo)) {
      if (name === '__meta') {
        continue;
      }

      if (data?.encodedCode) {
        persistentMap[name] = data.encodedCode;
      }
    }
  }

  const usedCodes = new Set();

  for (const encodedCode of Object.values(persistentMap)) {
    const code = encodedCodeToNumber(encodedCode);

    if (code !== null) {
      usedCodes.add(code);
    }
  }

  let nextUnicode = startUnicode;

  if (usedCodes.size > 0) {
    nextUnicode = Math.max(startUnicode, Math.max(...usedCodes) + 1);
  }

  for (const name of currentNames) {
    if (persistentMap[name]) {
      continue;
    }

    while (usedCodes.has(nextUnicode)) {
      nextUnicode += 1;
    }

    persistentMap[name] = numberToEncodedCode(nextUnicode);

    usedCodes.add(nextUnicode);

    nextUnicode += 1;
  }

  return {
    currentNames,
    persistentMap,
  };
}

/**
 * 生成 info.json
 */
function createInfoData({ currentNames, persistentMap, sourceHash }) {
  const info = {};

  for (const name of currentNames) {
    const encodedCode = persistentMap[name];
    const code = encodedCodeToNumber(encodedCode);

    info[name] = {
      encodedCode,
      prefix: fontName,
      className: `${fontName}-${name}`,
      unicode: `&#${code};`,
    };
  }

  /**
   * 自己增加缓存和历史 Unicode 映射。
   *
   * VS Code 不读取这个文件，
   * 所以可以安全保存这些额外信息。
   */
  info.__meta = {
    hash: sourceHash,
    generatorVersion,
    fontName,
    unicodeMap: persistentMap,
  };

  return info;
}

/**
 * 删除字体生成过程中产生的临时文件
 */
async function clearTempFiles() {
  await Promise.allSettled([unlink(tempSvgPath), unlink(tempTtfPath)]);
}

async function generate() {
  await mkdir(dist, {
    recursive: true,
  });

  const svgFiles = await getSvgFiles();

  if (svgFiles.length === 0) {
    throw new Error(`No SVG icons found in: ${src}`);
  }

  const sourceHash = await createSourceHash(svgFiles);

  const previousInfo = await readPreviousInfo();

  const woffExists = await fileExists(woffPath);

  /**
   * SVG 和配置都没有发生变化，
   * 并且 WOFF 已存在，直接跳过。
   */
  if (woffExists && previousInfo?.__meta?.hash === sourceHash) {
    console.log('QuickOps icons unchanged, skip generation.');

    return;
  }

  const { currentNames, persistentMap } = createUnicodeMap(svgFiles, previousInfo);

  try {
    /**
     * SVG -> SVG Font
     *
     * getIconUnicode 固定每一个图标的 Unicode，
     * 不再依赖文件读取顺序。
     */
    await createSVG({
      ...fontOptions,

      src,
      dist,

      getIconUnicode(name) {
        const encodedCode = persistentMap[name];

        const code = encodedCodeToNumber(encodedCode);

        if (code === null) {
          throw new Error(`Unicode not found for icon: ${name}`);
        }

        return [String.fromCodePoint(code)];
      },
    });

    /**
     * SVG Font -> TTF
     */
    const ttf = await createTTF({
      ...fontOptions,
      src,
      dist,
    });

    /**
     * TTF -> WOFF
     */
    await createWOFF(
      {
        ...fontOptions,
        src,
        dist,
      },
      ttf,
    );

    /**
     * 自己生成 info.json
     */
    const info = createInfoData({
      currentNames,
      persistentMap,
      sourceHash,
    });

    await writeFile(infoPath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');

    console.log('QuickOps icons generated');
    console.log(`Icons: ${currentNames.length}`);
  } finally {
    /**
     * 最终只留下：
     *
     * quickops-icons.woff
     * info.json
     */
    await clearTempFiles();
  }
}

await generate();
