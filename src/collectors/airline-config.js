import { findCityByAirportCode, getCityById } from "../shared/cities.js";
import { isValidDate } from "../shared/domain.js";

function getRouteCities(plan) {
  const origin = getCityById(plan.originCityId);
  const destination = getCityById(plan.destinationCityId);
  if (!origin || !destination) {
    throw new Error("无法识别查询计划的出发或到达城市");
  }
  return { origin, destination };
}

function getCityAirports(city) {
  const codes = city.airportCodes.filter((code) => findCityByAirportCode(code)?.id === city.id);
  return codes.join("-") || city.cityCode;
}

function getCitySearchLocation(city) {
  return {
    routeCode: city.cityCode,
    cityCode: city.cityCode,
    airportRange: getCityAirports(city),
  };
}

function getQuoteSearchLocation(cityId, legacyCode) {
  const city = getCityById(cityId);
  if (city) return getCitySearchLocation(city);

  const code = String(legacyCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;

  const matchingCity = findCityByAirportCode(code);
  if (matchingCity?.cityCode === code && !matchingCity.airportCodes.includes(code)) {
    return getCitySearchLocation(matchingCity);
  }

  return { routeCode: code, cityCode: matchingCity?.cityCode ?? code, airportRange: code };
}

function createAirlineAdapter(buildRouteSearchUrl) {
  return Object.freeze({
    buildRouteSearchUrl,
    buildSearchUrl({ plan, travelDate }) {
      const { origin, destination } = getRouteCities(plan);
      return buildRouteSearchUrl({
        origin: getCitySearchLocation(origin),
        destination: getCitySearchLocation(destination),
        travelDate,
      });
    },
  });
}

export const airlineAdapters = Object.freeze({
  CA: createAirlineAdapter(({ origin, destination, travelDate }) => {
    const route = `${origin.routeCode.toLowerCase()}-${destination.routeCode.toLowerCase()}`;
    return `https://www.airchina.com.cn/flight/oneway/${route}/${travelDate}`;
  }),
  CZ: createAirlineAdapter(({ origin, destination, travelDate }) => {
    const url = new URL("https://b2c.csair.com/B2C40/newTrips/static/main/page/booking/index.html");
    url.search = new URLSearchParams({
      t: "S",
      c1: origin.cityCode,
      c2: destination.cityCode,
      d1: travelDate,
      at: "1",
      ct: "0",
      it: "0",
      b1: origin.airportRange,
      b2: destination.airportRange,
      orderChannel: "JPSS-YDXC",
    }).toString();
    return url.href;
  }),
  GJ: createAirlineAdapter(({ origin, destination, travelDate }) => {
    const url = new URL("https://www.loongair.cn/#/web/home");
    url.search = new URLSearchParams({
      flightTrackerFrom: origin.routeCode,
      flightTrackerTo: destination.routeCode,
      flightTrackerDate: travelDate,
    }).toString();
    return url.href;
  }),
});

export function buildQuoteSearchUrl(quote) {
  const { airlineCode, travelDate } = quote;
  if (!Object.hasOwn(airlineAdapters, airlineCode) || !isValidDate(travelDate)) {
    return null;
  }

  const origin = getQuoteSearchLocation(quote.originCityId, quote.originCode);
  const destination = getQuoteSearchLocation(quote.destinationCityId, quote.destinationCode);
  if (!origin || !destination || origin.routeCode === destination.routeCode) {
    return null;
  }

  return airlineAdapters[airlineCode].buildRouteSearchUrl({ origin, destination, travelDate });
}
