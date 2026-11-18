import { findCityByAirportCode, getCityById } from "./cities.js";

const SUPPORTED_AIRLINES = new Set(["CA", "CZ"]);
const AIRLINE_NAMES = {
  CA: "中国国际航空",
  CZ: "中国南方航空",
};

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function validatePlan(input = {}) {
  const errors = {};
  const originCityId = String(input.originCityId ?? "").trim();
  const destinationCityId = String(input.destinationCityId ?? "").trim();
  const originCity = getCityById(originCityId);
  const destinationCity = getCityById(destinationCityId);
  const travelDates = Array.isArray(input.travelDates) ? input.travelDates : [];
  const airlineCodes = Array.isArray(input.airlineCodes)
    ? input.airlineCodes.map((code) => String(code).trim().toUpperCase())
    : [];
  const collectionTime = input.collectionTime ?? "09:00";

  if (!originCity) {
    errors.originCityId = "请选择有效的出发城市";
  }

  if (!destinationCity) {
    errors.destinationCityId = "请选择有效的到达城市";
  } else if (originCity && originCity.id === destinationCity.id) {
    errors.destinationCityId = "出发和到达城市不能相同";
  }

  if (travelDates.length === 0 || !travelDates.every(isValidDate)) {
    errors.travelDates = "请至少选择一个有效的出行日期";
  }

  if (
    airlineCodes.length === 0 ||
    airlineCodes.some((code) => !SUPPORTED_AIRLINES.has(code))
  ) {
    errors.airlineCodes = "请选择国航或南航";
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(collectionTime)) {
    errors.collectionTime = "请选择有效的每日采集时间";
  }

  return errors;
}

export function normalizePlan(input = {}) {
  const errors = validatePlan(input);
  if (Object.keys(errors).length > 0) {
    throw new TypeError(`Invalid plan: ${Object.keys(errors).join(", ")}`);
  }

  const originCity = getCityById(input.originCityId);
  const destinationCity = getCityById(input.destinationCityId);
  const now = new Date().toISOString();

  return {
    id: input.id || makeId(),
    originCityId: originCity.id,
    originCityName: originCity.name,
    destinationCityId: destinationCity.id,
    destinationCityName: destinationCity.name,
    travelDates: [...new Set(input.travelDates)].sort(),
    airlineCodes: [
      ...new Set(input.airlineCodes.map((code) => code.trim().toUpperCase())),
    ],
    collectionTime: input.collectionTime ?? "09:00",
    enabled: input.enabled ?? true,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function migrateStoredPlan(input = {}) {
  if (input.migrationStatus === "needs-city-selection") {
    return { ...input, enabled: false };
  }

  const originCity =
    getCityById(input.originCityId) ?? findCityByAirportCode(input.originCode);
  const destinationCity =
    getCityById(input.destinationCityId) ??
    findCityByAirportCode(input.destinationCode);

  if (
    originCity &&
    destinationCity &&
    originCity.id !== destinationCity.id
  ) {
    const normalizedPlan = normalizePlan({
      ...input,
      originCityId: originCity.id,
      destinationCityId: destinationCity.id,
    });
    return {
      ...normalizedPlan,
      createdAt: input.createdAt || normalizedPlan.createdAt,
      updatedAt: input.updatedAt || normalizedPlan.updatedAt,
    };
  }

  return {
    ...input,
    originCityId: originCity?.id ?? "",
    originCityName: originCity?.name ?? "",
    destinationCityId: destinationCity?.id ?? "",
    destinationCityName: destinationCity?.name ?? "",
    enabled: false,
    migrationStatus: "needs-city-selection",
  };
}

export function getSeriesKey(observation) {
  return [
    observation.planId,
    observation.travelDate,
    observation.airlineCode,
    observation.flightNo,
    observation.cabin,
    observation.fareProduct || "unknown",
  ]
    .map((value) => value || "unknown")
    .join("|");
}

export function normalizeObservations(
  plan,
  airlineCode,
  rows,
  capturedAt,
  trigger = "scheduled",
) {
  const code = String(airlineCode ?? "").trim().toUpperCase();
  if (!SUPPORTED_AIRLINES.has(code)) {
    return [];
  }

  const capturedDate = new Date(capturedAt);
  if (Number.isNaN(capturedDate.valueOf())) {
    throw new TypeError("capturedAt must be a valid date");
  }

  const captureDate = [
    capturedDate.getFullYear(),
    String(capturedDate.getMonth() + 1).padStart(2, "0"),
    String(capturedDate.getDate()).padStart(2, "0"),
  ].join("-");
  const allowedTravelDates = new Set(plan.travelDates ?? []);

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const fareText = String(row.listedFareCny ?? "").replaceAll(",", "");
      const listedFareCny = Number(fareText);
      const flightNo = String(row.flightNo ?? "")
        .trim()
        .replaceAll(/\s+/g, "")
        .toUpperCase();
      const stopCount = Number(row.stopCount);
      const travelDate =
        row.travelDate ||
        (allowedTravelDates.size === 1 ? [...allowedTravelDates][0] : "");

      if (
        !flightNo ||
        !Number.isFinite(listedFareCny) ||
        listedFareCny <= 0 ||
        !Number.isInteger(stopCount) ||
        stopCount < 0 ||
        !allowedTravelDates.has(travelDate)
      ) {
        return null;
      }

      const observation = {
        planId: plan.id,
        travelDate,
        airlineCode: code,
        flightNo,
        cabin: "economy",
        fareProduct: row.fareProduct || null,
      };

      return {
        id: `${captureDate}|${getSeriesKey(observation)}`,
        ...observation,
        capturedAt: capturedDate.toISOString(),
        captureDate,
        originCityId: plan.originCityId,
        originCityName: plan.originCityName,
        destinationCityId: plan.destinationCityId,
        destinationCityName: plan.destinationCityName,
        stopCount,
        listedFareCny,
        currency: "CNY",
        adultCount: 1,
        airlineName: AIRLINE_NAMES[code],
        source: row.source || AIRLINE_NAMES[code],
        sourceUrl: row.sourceUrl || null,
        trigger: trigger === "manual" ? "manual" : "scheduled",
        departureTime: row.departureTime || null,
        arrivalTime: row.arrivalTime || null,
      };
    })
    .filter(Boolean);
}
