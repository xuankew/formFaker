import { AREAS, CITIES, PROVINCES } from './region-data';

export interface RegionPath {
  province: string;
  city: string;
  area: string;
  areaCode: string;
  hasArea: boolean;
}

const citiesByProvince = new Map<string, typeof CITIES>();
const areasByCity = new Map<string, typeof AREAS>();

for (const row of CITIES) {
  const list = citiesByProvince.get(row[2]) ?? [];
  list.push(row);
  citiesByProvince.set(row[2], list);
}
for (const row of AREAS) {
  const list = areasByCity.get(row[2]) ?? [];
  list.push(row);
  areasByCity.set(row[2], list);
}

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// 国标数据里直辖市与省直辖县级区划的「市」级行是占位名（北京市下只有「市辖区」），
// 它们不是能拼进企业名/地址的城市名，但区县数据挂在其下，所以只从显示层省掉这一级。
const PLACEHOLDER_CITY_RE = /^(市辖区|县|(?:省|自治区)直辖县级行政区划)$/;

export function isPlaceholderCity(name: string): boolean {
  return PLACEHOLDER_CITY_RE.test(name);
}

const CITY_NAMES = CITIES.filter((c) => !isPlaceholderCity(c[1])).map((c) => c[1]);

export function randomRegionPath(): RegionPath {
  const province = pick(PROVINCES);
  const cities = citiesByProvince.get(province[0]) ?? [];
  const city = cities.length ? pick(cities) : province;
  const areas = areasByCity.get(city[0]) ?? [];
  const hasArea = areas.length > 0;
  const area = hasArea ? pick(areas) : city;
  const cityShown = isPlaceholderCity(city[1]) && hasArea ? '' : city[1];
  return { province: province[1], city: cityShown, area: area[1], areaCode: area[0], hasArea };
}

export function randomAreaCode(): string {
  return pick(AREAS)[0];
}

export function randomCityName(): string {
  return pick(CITY_NAMES);
}
