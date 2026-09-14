import { CITIES, PROVINCES } from './region-data';

// Single swap point for real city-level centers: populate CITY_CENTERS from an
// approved dataset and cityCenter() prefers it. Until then coordinates are seeded
// offline from province capitals plus a stable per-city jitter, so a point stays
// inside the address's province but is not district-precise.
const CITY_CENTERS: Record<string, [number, number]> = {};

const PROVINCE_CENTERS: Record<string, [number, number]> = {
  北京市: [116.407, 39.904],
  天津市: [117.201, 39.085],
  河北省: [114.515, 38.042],
  山西省: [112.549, 37.857],
  内蒙古自治区: [111.751, 40.842],
  辽宁省: [123.431, 41.805],
  吉林省: [125.325, 43.886],
  黑龙江省: [126.534, 45.803],
  上海市: [121.474, 31.23],
  江苏省: [118.797, 32.06],
  浙江省: [120.155, 30.274],
  安徽省: [117.283, 31.861],
  福建省: [119.296, 26.074],
  江西省: [115.858, 28.682],
  山东省: [117.0, 36.651],
  河南省: [113.625, 34.746],
  湖北省: [114.305, 30.593],
  湖南省: [112.938, 28.228],
  广东省: [113.264, 23.129],
  广西壮族自治区: [108.366, 22.817],
  海南省: [110.331, 20.031],
  重庆市: [106.551, 29.563],
  四川省: [104.066, 30.572],
  贵州省: [106.63, 26.647],
  云南省: [102.833, 24.88],
  西藏自治区: [91.14, 29.645],
  陕西省: [108.94, 34.341],
  甘肃省: [103.834, 36.061],
  青海省: [101.778, 36.617],
  宁夏回族自治区: [106.23, 38.487],
  新疆维吾尔自治区: [87.617, 43.793],
  台湾省: [121.565, 25.033],
  香港特别行政区: [114.171, 22.32],
  澳门特别行政区: [113.549, 22.199],
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function jitter(seed: number, span: number): number {
  return (((seed % 1000) / 1000) - 0.5) * 2 * span;
}

export function cityCenter(province: string, city: string): [number, number] {
  const exact = CITY_CENTERS[city];
  if (exact) return exact;
  const base = PROVINCE_CENTERS[province] ?? [104.0, 35.0];
  const h = hash(city || province);
  return [base[0] + jitter(h, 1.0), base[1] + jitter(h >> 3, 0.8)];
}

export function formatLngLat(c: [number, number]): string {
  return `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
}

export function parseRegionNames(text: string): { province: string; city: string } | null {
  const prov = PROVINCES.find((p) => text.includes(p[1]));
  if (!prov) return null;
  const city = CITIES.find((c) => c[2] === prov[0] && text.includes(c[1]));
  return { province: prov[1], city: city ? city[1] : '' };
}

// Derives a "lng,lat" string consistent with the region named in an address/region
// value; null when no known province appears in the text.
export function coordForText(text: string): string | null {
  const r = parseRegionNames(text);
  if (!r) return null;
  return formatLngLat(cityCenter(r.province, r.city || r.province));
}
