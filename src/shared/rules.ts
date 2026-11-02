const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;

// 用户容易把完整邮箱填进「邮箱域名」，直接拼接会产出 faker803@test@example.com
// 这种过不了页面校验的值；这里统一规整成域名，规整不了返回空串（回退内置池）。
export function normalizeEmailDomain(raw: string): string {
  let v = raw.trim().toLowerCase().split('/')[0];
  const at = v.lastIndexOf('@');
  if (at >= 0) v = v.slice(at + 1);
  v = v.replace(/^[.\s]+|[.\s]+$/g, '');
  return DOMAIN_RE.test(v) ? v : '';
}
