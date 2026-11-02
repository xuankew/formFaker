export type DateUnit = 'd' | 'm' | 'y';

const pad = (n: number): string => String(n).padStart(2, '0');

const TOKEN_RE = /YYYY|MM|DD|HH|mm|ss/g;

// 日期令牌：YYYY MM DD HH mm ss。空格式回退 YYYY-MM-DD，避免用户清空后生成空串。
export function formatDate(d: Date, fmt: string): string {
  const pattern = fmt.trim() || 'YYYY-MM-DD';
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return pattern.replace(TOKEN_RE, (t) => map[t]);
}

export function shiftDate(d: Date, amount: number, unit: DateUnit): Date {
  const out = new Date(d.getTime());
  if (unit === 'd') out.setDate(out.getDate() + amount);
  else if (unit === 'm') out.setMonth(out.getMonth() + amount);
  else out.setFullYear(out.getFullYear() + amount);
  return out;
}
