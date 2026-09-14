import { describe, expect, it } from 'vitest';
import { pickPoolFile, poolEntryToFile } from '../src/core/fill/filepool';
import type { PoolEntry } from '../src/shared/types';

const entry = (name: string, type: string, data = 'AAA='): PoolEntry => ({ name, type, size: data.length, data });

const pdf = entry('report.pdf', 'application/pdf');
const png = entry('logo.png', 'image/png');
const jpg = entry('photo.jpg', 'image/jpeg');

describe('pickPoolFile', () => {
  it('matches by extension token', () => {
    expect(pickPoolFile([png, pdf], 'upload-file', '.pdf')?.name).toBe('report.pdf');
  });
  it('matches by wildcard mime', () => {
    expect(pickPoolFile([pdf, png], 'upload-image', 'image/*')?.name).toBe('logo.png');
  });
  it('matches by exact mime', () => {
    expect(pickPoolFile([png, jpg], 'upload-image', 'image/jpeg')?.name).toBe('photo.jpg');
  });
  it('accepts multiple comma-separated tokens', () => {
    expect(pickPoolFile([pdf, png], 'upload-file', '.doc,.pdf')?.name).toBe('report.pdf');
  });
  it('empty accept returns the first entry', () => {
    expect(pickPoolFile([pdf, png], 'upload-file', '')?.name).toBe('report.pdf');
  });
  it('empty accept prefers an image for upload-image', () => {
    expect(pickPoolFile([pdf, png], 'upload-image', '')?.name).toBe('logo.png');
  });
  it('returns null when nothing matches', () => {
    expect(pickPoolFile([png], 'upload-file', '.pdf')).toBeNull();
  });
  it('returns null for an empty pool', () => {
    expect(pickPoolFile([], 'upload-file', '')).toBeNull();
  });
});

describe('poolEntryToFile', () => {
  it('decodes base64 to a File with the original name and type', async () => {
    const file = poolEntryToFile(entry('a.txt', 'text/plain', btoa('hello')));
    expect(file.name).toBe('a.txt');
    expect(file.type).toBe('text/plain');
    expect(file.size).toBe(5);
    const text = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
    expect(text).toBe('hello');
  });
  it('falls back to octet-stream when the type is empty', () => {
    expect(poolEntryToFile(entry('b.bin', '', btoa('x'))).type).toBe('application/octet-stream');
  });
});
