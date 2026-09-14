import type { Semantic } from '../../shared/types';

// Coordinate fields are derived outputs (usually map-filled and disabled/readonly);
// scan whitelists this label pattern so they stay fillable.
export const LNGLAT_RE = /经纬度|坐标|longitude|latitude|lnglat|gps|\blng\b|\blat\b/;

// Ordered: first match wins, so more specific patterns come first.
export const SEMANTIC_RULES: { semantic: Semantic; re: RegExp }[] = [
  { semantic: 'phone', re: /手机|移动电话|mobile|cellphone/ },
  { semantic: 'landline', re: /座机|固定电话|传真|电话|tel|fax|phone/ },
  { semantic: 'email', re: /邮箱|email|e-mail/ },
  { semantic: 'creditCode', re: /信用代码|工商注册号|税号|uscc|credit/ },
  { semantic: 'idNumber', re: /身份证|identity|idcard|id\s*no/ },
  { semantic: 'bankCard', re: /银行卡|银行账号|开户|bank\s*card|account\s*no|账号/ },
  { semantic: 'zipcode', re: /邮编|postal|zip/ },
  { semantic: 'url', re: /网址|官网|网站|website|url|link/ },
  { semantic: 'company', re: /公司|企业名|单位名称|供应商名称|company|vendor|supplier/ },
  { semantic: 'cnName', re: /姓名|联系人|法定代表人|负责人|收货人|name/ },
  { semantic: 'lnglat', re: LNGLAT_RE },
  { semantic: 'region', re: /地区|区域|省市|所在地|region|area|province|city/ },
  { semantic: 'address', re: /地址|address/ },
  { semantic: 'gender', re: /性别|gender/ },
  { semantic: 'education', re: /学历|学位|education/ },
  { semantic: 'amount', re: /金额|资本|资金|价格|费用|单价|总价|amount|price|capital|fee|fund/ },
  { semantic: 'integer', re: /数量|人数|个数|件数|count|qty|quantity/ },
  { semantic: 'paragraph', re: /备注|说明|简介|描述|范围|理由|remark|desc|note|comment/ },
  { semantic: 'date', re: /日期|时间|date|time/ },
];
