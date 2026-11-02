export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const digits = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
export const intBetween = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));
export const shuffled = <T,>(arr: readonly T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

// {s:n} 未配字符集时的兜底，避免整条模板渲染不出来。
export const FALLBACK_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomChars(set: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += set[Math.floor(Math.random() * set.length)];
  return out;
}
