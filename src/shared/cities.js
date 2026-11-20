import cityRows from "./china-cities.js";

const cities = Object.freeze(
  cityRows.map((city) =>
    Object.freeze({ ...city, airportCodes: Object.freeze([...city.airportCodes]) }),
  ),
);
const citiesById = new Map(cities.map((city) => [city.id, city]));
const citiesByCode = new Map(cities.map((city) => [city.cityCode, city]));
const airportsByCode = new Map();

for (const city of cities) {
  for (const airportCode of city.airportCodes) {
    const matches = airportsByCode.get(airportCode) ?? new Set();
    matches.add(city.id);
    airportsByCode.set(airportCode, matches);
  }
}

export function listCities() {
  return cities.map(({ id, name, pinyin }) => ({ id, name, pinyin }));
}

export function getCityById(id) {
  return citiesById.get(String(id ?? "").trim()) ?? null;
}

export function findCityByAirportCode(code) {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  const airportMatches = airportsByCode.get(normalizedCode);

  if (airportMatches) {
    return airportMatches.size === 1
      ? citiesById.get(airportMatches.values().next().value)
      : null;
  }

  return citiesByCode.get(normalizedCode) ?? null;
}
