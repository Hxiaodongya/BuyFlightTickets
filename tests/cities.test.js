import assert from "node:assert/strict";
import test from "node:test";
import {
  findCityByAirportCode,
  getCityById,
  listCities,
} from "../src/shared/cities.js";

test("lists unique domestic flight cities as display-safe options", () => {
  const cities = listCities();

  assert.ok(cities.length > 300);
  assert.equal(new Set(cities.map((city) => city.id)).size, cities.length);
  assert.equal(new Set(cities.map((city) => city.name)).size, cities.length);
  assert.ok(cities.every((city) => city.name && city.pinyin));
  assert.ok(cities.every((city) => !("cityCode" in city) && !("airportCodes" in city)));
  assert.ok(cities.some((city) => city.name === "杭州"));
  assert.ok(cities.some((city) => city.name === "长春"));
});

test("resolves internal city details without exposing them in picker options", () => {
  const hangzhou = getCityById("city-hgh");

  assert.equal(hangzhou.name, "杭州");
  assert.equal(hangzhou.cityCode, "HGH");
  assert.equal(getCityById("unknown-city"), null);
});

test("maps unique airports in a multi-airport city to one city", () => {
  assert.equal(findCityByAirportCode("PVG").name, "上海");
  assert.equal(findCityByAirportCode("PEK").name, "北京");
  assert.equal(findCityByAirportCode("PKX").name, "北京");
});

test("does not guess when a legacy airport code maps to multiple cities", () => {
  assert.equal(findCityByAirportCode("HYN"), null);
  assert.equal(findCityByAirportCode("ZZZ"), null);
});
