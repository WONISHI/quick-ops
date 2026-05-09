export const isImageFile = (filePath: string) => {
  return /\.(png|jpe?g|gif|svg|webp|ico|bmp|tiff)$/i.test(filePath);
};

export const isExcelFile = (filePath: string) => {
  return /\.(xlsx|xls|csv)$/i.test(filePath);
};

export const isPdfFile = (filePath: string) => {
  return /\.pdf$/i.test(filePath);
};

export const isMarkdownFile = (filePath: string) => {
  return /\.(md|markdown)$/i.test(filePath);
};