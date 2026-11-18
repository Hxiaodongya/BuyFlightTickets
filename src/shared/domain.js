const SUPPORTED_AIRLINES = new Set(["CA", "CZ"]);
const SUPPORTED_CABINS = new Set(["economy", "business", "first"]);
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
  const originCode = String(input.originCode ?? "").trim().toUpperCase();
  const destinationCode = String(input.destinationCode ?? "")
    .trim()
    .toUpperCase();
  const travelDates = Array.isArray(input.travelDates) ? input.travelDates : [];
  const airlineCodes = Array.isArray(input.airlineCodes)
    ? input.airlineCodes.map((code) => String(code).trim().toUpperCase())
    : [];
  const adultCount = input.adultCount ?? 1;
  const cabin = input.cabin ?? "economy";
  const collectionTime = input.collectionTime ?? "09:00";

  if (!/^[A-Z]{3}$/.test(originCode)) {
    errors.originCode = "请输入有效的出发机场三字码";
  }

  if (!/^[A-Z]{3}$/.test(destinationCode)) {
    errors.destinationCode = "请输入有效的到达机场三字码";
  } else if (originCode === destinationCode) {
    errors.destinationCode = "出发和到达机场不能相同";
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

  if (!Number.isInteger(adultCount) || adultCount < 1 || adultCount > 9) {
    errors.adultCount = "成人乘客数须为 1 至 9 人";
  }

  if (!SUPPORTED_CABINS.has(cabin)) {
    errors.cabin = "请选择有效舱位";
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

  const originCode = input.originCode.trim().toUpperCase();
  const destinationCode = input.destinationCode.trim().toUpperCase();
  const now = new Date().toISOString();

  return {
    id: input.id || makeId(),
    name: String(input.name ?? "").trim() || `${originCode}-${destinationCode}`,
    originName: String(input.originName ?? "").trim(),
    originCode,
    destinationName: String(input.destinationName ?? "").trim(),
    destinationCode,
    travelDates: [...new Set(input.travelDates)].sort(),
    airlineCodes: [
      ...new Set(input.airlineCodes.map((code) => code.trim().toUpperCase())),
    ],
    adultCount: input.adultCount ?? 1,
    cabin: input.cabin ?? "economy",
    collectionTime: input.collectionTime ?? "09:00",
    enabled: input.enabled ?? true,
    createdAt: input.createdAt || now,
    updatedAt: now,
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
        cabin: row.cabin || plan.cabin || "economy",
        fareProduct: row.fareProduct || null,
      };

      return {
        id: `${captureDate}|${getSeriesKey(observation)}`,
        ...observation,
        capturedAt: capturedDate.toISOString(),
        captureDate,
        originCode: plan.originCode,
        originName: plan.originName || "",
        destinationCode: plan.destinationCode,
        destinationName: plan.destinationName || "",
        stopCount,
        listedFareCny,
        currency: "CNY",
        adultCount: plan.adultCount ?? 1,
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
