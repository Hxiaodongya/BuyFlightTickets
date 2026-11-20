import { findCityByAirportCode, getCityById } from "../shared/cities.js";
import { isValidDate } from "../shared/domain.js";

const sichuanAirHome = "https://www.sichuanair.com";
const sichuanAirBooking = "https://flights.sichuanair.com";
const airportRoutePattern = /^[A-Z]{3}-[A-Z]{3}$/;

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

function airportRoutes(origin, destination) {
  return origin.airportRange.split("-").flatMap((from) =>
    destination.airportRange.split("-").filter((to) => from !== to).map((to) => `${from}-${to}`),
  );
}

function buildSichuanAirSearchUrl(route, travelDate) {
  if (!airportRoutePattern.test(route) || !isValidDate(travelDate)) return null;
  const [from, to] = route.split("-");
  const url = new URL(sichuanAirHome);
  url.search = new URLSearchParams({
    flightTrackerFrom: from,
    flightTrackerTo: to,
    flightTrackerDate: travelDate,
  }).toString();
  return url.href;
}

export function buildSichuanAirResultUrl(searchUrl) {
  const url = new URL(searchUrl);
  const route = `${url.searchParams.get("flightTrackerFrom")}-${url.searchParams.get("flightTrackerTo")}`;
  if (url.origin !== sichuanAirHome || !airportRoutePattern.test(route)) {
    throw new Error("四川航空缺少有效的机场航线");
  }
  return `${sichuanAirBooking}/3uair/ibe/ticket/${route.toLowerCase()}.html`;
}

function getSichuanAirSearchRoutes({ plan }) {
  const { origin, destination } = getRouteCities(plan);
  return airportRoutes(getCitySearchLocation(origin), getCitySearchLocation(destination));
}

function getSichuanAirSourceRoute(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (url.origin !== sichuanAirBooking) return null;
    return url.pathname.match(/^\/3uair\/ibe\/ticket\/([a-z]{3}-[a-z]{3})\.html$/i)?.[1].toUpperCase() ?? null;
  } catch {
    return null;
  }
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
  "3U": Object.freeze({
    buildSearchRoutes: getSichuanAirSearchRoutes,
    buildSearchUrl({ plan, travelDate, airportRoute }) {
      return buildSichuanAirSearchUrl(airportRoute ?? getSichuanAirSearchRoutes({ plan })[0], travelDate);
    },
    buildRouteSearchUrl({ origin, destination, travelDate, sourceUrl }) {
      const routes = airportRoutes(origin, destination);
      const sourceRoute = getSichuanAirSourceRoute(sourceUrl);
      return buildSichuanAirSearchUrl(routes.includes(sourceRoute) ? sourceRoute : routes[0], travelDate);
    },
  }),
});

export function buildQuoteSearchUrl(quote) {
  const { airlineCode, travelDate, sourceUrl } = quote;
  if (!Object.hasOwn(airlineAdapters, airlineCode) || !isValidDate(travelDate)) {
    return null;
  }

  const origin = getQuoteSearchLocation(quote.originCityId, quote.originCode);
  const destination = getQuoteSearchLocation(quote.destinationCityId, quote.destinationCode);
  if (!origin || !destination || origin.routeCode === destination.routeCode) {
    return null;
  }

  return airlineAdapters[airlineCode].buildRouteSearchUrl({ origin, destination, travelDate, sourceUrl });
}
