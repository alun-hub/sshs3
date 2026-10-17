const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);
const RASTER_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico']);
const SVG_EXTENSIONS = new Set(['svg']);
const PDF_EXTENSIONS = new Set(['pdf']);
const CSV_EXTENSIONS = new Set(['csv', 'tsv']);
const JSON_EXTENSIONS = new Set(['json']);

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx === -1) return '';
  return name.slice(idx + 1).toLowerCase();
}

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(getFileExtension(name));
}

export function isHtmlFile(name: string): boolean {
  return HTML_EXTENSIONS.has(getFileExtension(name));
}

export function isRasterImageFile(name: string): boolean {
  return RASTER_IMAGE_EXTENSIONS.has(getFileExtension(name));
}

export function isSvgFile(name: string): boolean {
  return SVG_EXTENSIONS.has(getFileExtension(name));
}

export function isPdfFile(name: string): boolean {
  return PDF_EXTENSIONS.has(getFileExtension(name));
}

export function isCsvFile(name: string): boolean {
  return CSV_EXTENSIONS.has(getFileExtension(name));
}

export function isJsonFile(name: string): boolean {
  return JSON_EXTENSIONS.has(getFileExtension(name));
}

export function isDualModeFile(name: string): boolean {
  const ext = getFileExtension(name);
  return MARKDOWN_EXTENSIONS.has(ext) || HTML_EXTENSIONS.has(ext) || SVG_EXTENSIONS.has(ext) || CSV_EXTENSIONS.has(ext);
}

export function getPreviewLabel(name: string): 'Preview' | 'Table' {
  return isCsvFile(name) ? 'Table' : 'Preview';
}

export function isDirectPreviewFile(name: string): boolean {
  const ext = getFileExtension(name);
  return RASTER_IMAGE_EXTENSIONS.has(ext) || PDF_EXTENSIONS.has(ext);
}
