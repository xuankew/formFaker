import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE,
  imageTextPlacement,
  requiredImageSize,
  requiredMaxBytes,
  resolveImageSize,
} from '../src/core/fill/files';
import { scanDocument } from '../src/core/scan';

const sizeIn = (hint: string, inner = '<div class="el-upload"><input type="file" accept="image/*" /></div>') => {
  document.body.innerHTML = `<div class="el-form-item"><label class="el-form-item__label">商品主图</label>${inner}<div class="tip">${hint}</div></div>`;
  return requiredImageSize(document.querySelector('input') as HTMLElement);
};

describe('requiredImageSize', () => {
  it('reads the px size from the field hint', () => {
    expect(sizeIn('支持jpg/png/gif，建议单张50KB以内，尺寸大小为：480*480px')).toEqual({ width: 480, height: 480 });
  });

  it('accepts × / x separators and whitespace', () => {
    expect(sizeIn('尺寸大小为：750 × 564 px')).toEqual({ width: 750, height: 564 });
    expect(sizeIn('图片 800x600PX')).toEqual({ width: 800, height: 600 });
  });

  it('accepts a bare 尺寸 hint without a px unit', () => {
    expect(sizeIn('尺寸要求 1200*900')).toEqual({ width: 1200, height: 900 });
  });

  it('ignores hints that carry no dimensions', () => {
    expect(sizeIn('支持图片格式jpg/png/gif，建议单张图片50KB以内')).toBeNull();
    expect(sizeIn('')).toBeNull();
  });

  it('caps absurd dimensions so the canvas stays allocatable', () => {
    expect(sizeIn('尺寸大小为：9000*9000px')).toEqual({ width: 2000, height: 2000 });
  });
});

const bytesIn = (hint: string, inner = '<div class="el-upload"><input type="file" accept="image/*" /></div>') => {
  document.body.innerHTML = `<div class="el-form-item"><label class="el-form-item__label">商品主图</label>${inner}<div class="tip">${hint}</div></div>`;
  return requiredMaxBytes(document.querySelector('input') as HTMLElement);
};

describe('requiredMaxBytes', () => {
  it('reads suffix-style limits', () => {
    expect(bytesIn('支持jpg/png/gif，建议单张50KB以内，尺寸大小为：480*480px')).toBe(50 * 1024);
  });

  it('reads prefix-style limits', () => {
    expect(bytesIn('支持 pdf 格式，单个不超过 10MB')).toBe(10 * 1024 * 1024);
    expect(bytesIn('图片小于500KB')).toBe(500 * 1024);
    expect(bytesIn('大小限制为 1M')).toBe(1024 * 1024);
  });

  it('returns null when the hint carries no byte limit', () => {
    expect(bytesIn('尺寸大小为：480*480px')).toBeNull();
    expect(bytesIn('')).toBeNull();
  });
});

describe('resolveImageSize', () => {
  it('keeps the field-declared size even when a custom default is set', () => {
    expect(resolveImageSize({ width: 480, height: 480 }, { ...DEFAULT_IMAGE, width: 300, height: 300 })).toEqual({
      width: 480,
      height: 480,
    });
  });

  it('falls back to 240×160 when nothing is configured', () => {
    expect(resolveImageSize(null, DEFAULT_IMAGE)).toEqual({ width: 240, height: 160 });
  });

  it('uses the configured size and clamps out-of-range values', () => {
    expect(resolveImageSize(null, { ...DEFAULT_IMAGE, width: 300, height: 200 })).toEqual({ width: 300, height: 200 });
    expect(resolveImageSize(null, { ...DEFAULT_IMAGE, width: 0, height: 5000 })).toEqual({ width: 1, height: 2000 });
  });
});

describe('imageTextPlacement', () => {
  it('anchors text in corners and the center', () => {
    expect(imageTextPlacement('top-left', 400, 200)).toEqual({
      x: 16,
      y: 16,
      align: 'left',
      baseline: 'top',
      maxWidth: 368,
    });
    expect(imageTextPlacement('center', 400, 200)).toEqual({
      x: 200,
      y: 100,
      align: 'center',
      baseline: 'middle',
      maxWidth: 368,
    });
    expect(imageTextPlacement('bottom-right', 400, 200)).toEqual({
      x: 384,
      y: 184,
      align: 'right',
      baseline: 'bottom',
      maxWidth: 368,
    });
  });

  it('centers edge positions on the other axis', () => {
    expect(imageTextPlacement('top', 400, 200)).toMatchObject({ x: 200, y: 16, align: 'center', baseline: 'top' });
    expect(imageTextPlacement('right', 400, 200)).toMatchObject({ x: 384, y: 100, align: 'right', baseline: 'middle' });
  });
});

describe('upload scan', () => {
  it('keeps a display:none file input fillable instead of skipping it as invisible', () => {
    document.body.innerHTML = `
      <div class="uploader">
        <button type="button">上传图片</button>
        <input type="file" style="display:none" />
      </div>`;
    const input = document.querySelector('input') as HTMLInputElement;
    const cand = scanDocument(document).find((c) => c.root === input);
    expect(cand?.kind).toBe('upload-image');
    expect(cand?.skipped).toBeUndefined();
    expect(cand?.targets).toEqual([input]);
  });

  it('corrects an accept-less upload widget to upload-image from the field hint', () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <label class="el-form-item__label">商品详情图片</label>
        <div class="el-upload"><button type="button">上传图片</button><input type="file" style="display:none" /></div>
        <div class="tip">支持图片格式jpg/png/gif，建议单张图片100KB以内，尺寸大小为：750*564px</div>
      </div>`;
    const root = document.querySelector('.el-upload') as HTMLElement;
    const cand = scanDocument(document).find((c) => c.root === root);
    expect(cand?.kind).toBe('upload-image');
  });

  it('keeps a pdf-only field as upload-file', () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <label class="el-form-item__label">营业执照附件</label>
        <div class="el-upload"><button type="button">上传附件</button><input type="file" style="display:none" /></div>
        <div class="tip">支持 pdf 格式，单个不超过 10MB</div>
      </div>`;
    const root = document.querySelector('.el-upload') as HTMLElement;
    const cand = scanDocument(document).find((c) => c.root === root);
    expect(cand?.kind).toBe('upload-file');
  });
});
