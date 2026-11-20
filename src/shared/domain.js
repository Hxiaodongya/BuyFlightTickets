import { findCityByAirportCode, getCityById } from "./cities.js";

export const AIRLINE_NAMES = Object.freeze({
  CA: "中国国际航空",
  CZ: "中国南方航空",
  GJ: "长龙航空",
  "3U": "四川航空",
});

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export function isValidClock(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function getStopoverStatus(row) {
  return row.hasStopover ?? (row.stopCount === 0 ? false : null);
}

export function isNonstop(row) {
  return getStopoverStatus(row) === false &&
    (row.transferCount === 0 || (row.transferCount == null && row.stopCount === 0));
}

function normalizeSchedule(row, travelDate) {
  const departureTime = isValidClock(row.departureTime) ? row.departureTime : null;
  const arrivalTime = isValidClock(row.arrivalTime) ? row.arrivalTime : null;
  const clockMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const clockDifference = departureTime && arrivalTime ? clockMinutes(arrivalTime) - clockMinutes(departureTime) : null;
  const departureDay = Date.parse(`${travelDate}T00:00:00Z`);
  const minutesPerDay = 24 * 60;
  const reportedDuration = Number.isSafeInteger(row.durationMinutes) && row.durationMinutes > 0 ? row.durationMinutes : null;
  let arrivalDate = isValidDate(row.arrivalDate) && row.arrivalDate >= travelDate ? row.arrivalDate : null;

  if (!arrivalDate) {
    let daysLater = Number.isSafeInteger(row.arrivalDayOffset) && row.arrivalDayOffset >= 0 ? row.arrivalDayOffset : null;
    if (daysLater === null && clockDifference !== null) {
      const elapsedDays = reportedDuration === null ? null : (reportedDuration - clockDifference) / minutesPerDay;
      daysLater = Number.isInteger(elapsedDays) && elapsedDays >= 0 ? elapsedDays : Number(clockDifference < 0);
    }
    if (daysLater !== null) {
      const arrivalDay = new Date(departureDay + daysLater * minutesPerDay * 60_000);
      if (Number.isFinite(arrivalDay.valueOf())) {
        const date = arrivalDay.toISOString().split("T")[0];
        if (isValidDate(date)) arrivalDate = date;
      }
    }
  }

  let durationMinutes = reportedDuration;
  if (durationMinutes === null && arrivalDate && clockDifference !== null) {
    const elapsed = (Date.parse(`${arrivalDate}T00:00:00Z`) - departureDay) / 60_000 + clockDifference;
    if (elapsed > 0) durationMinutes = elapsed;
  }

  return { departureTime, arrivalTime, arrivalDate, durationMinutes };
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
    airlineCodes.some((code) => !Object.hasOwn(AIRLINE_NAMES, code))
  ) {
    errors.airlineCodes = "请至少选择一家支持的航司";
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
  if (!Object.hasOwn(AIRLINE_NAMES, code)) {
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
      const stopCount = row.stopCount == null ? null : Number(row.stopCount);
      const travelDate =
        row.travelDate ||
        (allowedTravelDates.size === 1 ? [...allowedTravelDates][0] : "");

      if (
        !flightNo ||
        !Number.isFinite(listedFareCny) ||
        listedFareCny <= 0 ||
        (stopCount !== null && (!Number.isInteger(stopCount) || stopCount < 0)) ||
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
        transferCount: Number.isInteger(row.transferCount) && row.transferCount >= 0 ? row.transferCount : null,
        hasStopover: typeof row.hasStopover === "boolean" ? row.hasStopover : null,
        stopoverName: row.hasStopover === true && typeof row.stopoverName === "string" ? row.stopoverName.trim() || null : null,
        listedFareCny,
        currency: "CNY",
        adultCount: 1,
        airlineName: AIRLINE_NAMES[code],
        source: row.source || AIRLINE_NAMES[code],
        sourceUrl: row.sourceUrl || null,
        trigger: trigger === "manual" ? "manual" : "scheduled",
        ...normalizeSchedule(row, travelDate),
      };
    })
    .filter(Boolean);
}
