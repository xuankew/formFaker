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

export function randomRegionPath(): RegionPath {
  const province = pick(PROVINCES);
  const cities = citiesByProvince.get(province[0]) ?? [];
  const city = cities.length ? pick(cities) : province;
  const areas = areasByCity.get(city[0]) ?? [];
  const hasArea = areas.length > 0;
  const area = hasArea ? pick(areas) : city;
  return { province: province[1], city: city[1], area: area[1], areaCode: area[0], hasArea };
}

export function randomAreaCode(): string {
  return pick(AREAS)[0];
}

export function randomCityName(): string {
  return pick(CITIES)[1];
}
