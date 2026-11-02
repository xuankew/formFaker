export interface ImageSize {
  width: number;
  height: number;
}

export type ImageTextPos =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

// 合成上传图的样式，用户可在设置页改；尺寸只在字段没声明尺寸时生效。
export interface ImageStyle {
  text: string;
  pos: ImageTextPos;
  width: number | null;
  height: number | null;
}

export const DEFAULT_IMAGE: ImageStyle = { text: 'FormFaker', pos: 'center', width: null, height: null };

export interface ImageTextPlacement {
  x: number;
  y: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  maxWidth: number;
}

const PAD_RATIO = 0.08;
const FONT_RATIO = 0.09;

export function imageTextPlacement(pos: ImageTextPos, width: number, height: number): ImageTextPlacement {
  const pad = Math.max(4, Math.round(Math.min(width, height) * PAD_RATIO));
  return {
    x: pos.includes('left') ? pad : pos.includes('right') ? width - pad : width / 2,
    y: pos.includes('top') ? pad : pos.includes('bottom') ? height - pad : height / 2,
    align: pos.includes('left') ? 'left' : pos.includes('right') ? 'right' : 'center',
    baseline: pos.includes('top') ? 'top' : pos.includes('bottom') ? 'bottom' : 'middle',
    maxWidth: Math.max(1, width - pad * 2),
  };
}

export function resolveImageSize(hint: ImageSize | null | undefined, style: ImageStyle): ImageSize {
  if (hint) return hint;
  const dim = (v: number | null, fallback: number) =>
    v !== null && Number.isFinite(v) ? Math.min(MAX_DIM, Math.max(1, Math.round(v))) : fallback;
  return { width: dim(style.width, 240), height: dim(style.height, 160) };
}

export function paintImage(
  ctx: CanvasRenderingContext2D,
  size: ImageSize,
  style: ImageStyle,
  background: string,
): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size.width, size.height);
  const text = style.text.trim();
  if (!text) return;
  const place = imageTextPlacement(style.pos, size.width, size.height);
  ctx.fillStyle = '#333';
  ctx.font = `${Math.max(10, Math.round(Math.min(size.width, size.height) * FONT_RATIO))}px sans-serif`;
  ctx.textAlign = place.align;
  ctx.textBaseline = place.baseline;
  ctx.fillText(text, place.x, place.y, place.maxWidth);
}

const SIZE_RE = /(\d{2,5})\s*[*×xX]\s*(\d{2,5})\s*(?:px|像素)/i;
const SIZE_AFTER_HINT_RE = /尺寸[^0-9]{0,16}(\d{2,5})\s*[*×xX]\s*(\d{2,5})/;
const MAX_DIM = 2000;

// 真实页面常在上传控件旁写明「尺寸大小为：480*480px」，并在 before-upload 里按此校验。
// 解析不到就返回 null，沿用默认尺寸。
export function requiredImageSize(root: Element): ImageSize | null {
  const scope =
    root.closest('.el-form-item, .ant-form-item, [class*="form-item"], td, .cell') ?? root.parentElement;
  if (!scope) return null;
  const text = (scope.textContent ?? '').replace(/\s+/g, ' ');
  const m = SIZE_RE.exec(text) ?? SIZE_AFTER_HINT_RE.exec(text);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!width || !height) return null;
  return { width: Math.min(width, MAX_DIM), height: Math.min(height, MAX_DIM) };
}

const BYTES_LIMIT_RE =
  /(?:不超过|不能超过|不大于|不得大于|小于|限(?:制)?(?:为|在)?)\s*(\d+(?:\.\d+)?)\s*(MB|KB|M|K|B)\b|(\d+(?:\.\d+)?)\s*(MB|KB|M|K|B)\s*以[内下]/i;
const UNIT_BYTES: Record<string, number> = { b: 1, k: 1024, kb: 1024, m: 1024 * 1024, mb: 1024 * 1024 };

// 真实页面常同时声明体积门槛（「建议单张50KB以内」「不超过2MB」）。解析不到返回 null，
// 表示页面没提体积要求。
export function requiredMaxBytes(root: Element): number | null {
  const scope =
    root.closest('.el-form-item, .ant-form-item, [class*="form-item"], td, .cell') ?? root.parentElement;
  if (!scope) return null;
  const text = (scope.textContent ?? '').replace(/\s+/g, ' ');
  const m = BYTES_LIMIT_RE.exec(text);
  if (!m) return null;
  const num = Number(m[1] ?? m[3]);
  const unit = (m[2] ?? m[4]).toLowerCase();
  if (!num) return null;
  return Math.round(num * UNIT_BYTES[unit]);
}

export async function makeTestFile(
  kind: 'upload-image' | 'upload-file',
  accept: string,
  size?: ImageSize | null,
  style: ImageStyle = DEFAULT_IMAGE,
): Promise<File> {
  const stamp = Math.floor(Math.random() * 10000);
  if (kind === 'upload-image' || accept.includes('image')) {
    const blob = await makePng(size, style);
    const suffix = size ? `-${size.width}x${size.height}` : '';
    return new File([blob], `test-${stamp}${suffix}.png`, { type: 'image/png' });
  }
  const bytes = makePdf();
  return new File([bytes], `test-${stamp}.pdf`, { type: 'application/pdf' });
}

function makePng(hint: ImageSize | null | undefined, style: ImageStyle): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const size = resolveImageSize(hint, style);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('canvas unsupported'));
    paintImage(ctx, size, style, `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

function makePdf(): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    '<</Length 46>>\nstream\nBT /F1 24 Tf 72 720 Td (FormFaker test file) Tj ET\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
