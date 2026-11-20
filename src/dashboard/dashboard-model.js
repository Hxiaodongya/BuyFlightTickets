import { ALARM_PREFIX } from "../background/scheduler.js";
import { getStopoverStatus, isNonstop } from "../shared/domain.js";

export function getQuoteSummary(observations) {
  let lowest = null;
  let latestRange = null;
  const lowestIds = [];
  const flights = new Set();
  for (const row of observations) {
    const { listedFareCny: fare, captureDate: date } = row;
    flights.add(JSON.stringify([row.planId, row.travelDate, row.airlineCode, row.flightNo]));
    if (!lowest || fare < lowest.listedFareCny) {
      lowest = row;
      lowestIds.length = 0;
    }
    if (fare === lowest.listedFareCny) {
      lowestIds.push(row.id);
      if (row.capturedAt > lowest.capturedAt) lowest = row;
    }

    if (!latestRange || date > latestRange.date) {
      latestRange = { date, min: fare, max: fare, count: 1 };
    } else if (date === latestRange.date) {
      latestRange.min = Math.min(latestRange.min, fare);
      latestRange.max = Math.max(latestRange.max, fare);
      latestRange.count += 1;
    }
  }
  return { lowest, lowestIds, latestRange, flightCount: flights.size, quoteCount: observations.length };
}

export function findNextCollection(plans, alarms, planId, now = Date.now()) {
  const enabledPlans = new Map(plans.filter((plan) => plan.enabled && (!planId || plan.id === planId))
    .map((plan) => [`${ALARM_PREFIX}${plan.id}`, plan.id]));
  let next = null;
  for (const { name, scheduledTime } of alarms) {
    if (!enabledPlans.has(name) || !Number.isFinite(scheduledTime) || scheduledTime <= now) continue;
    if (!next || scheduledTime < next.scheduledTime) next = { planId: enabledPlans.get(name), scheduledTime };
  }
  return next;
}

const airlineColors = { CA: "--dashboard-ca", CZ: "--dashboard-cz", GJ: "--dashboard-gj", "3U": "--dashboard-3u" };
const fareFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function airlineColor(code) {
  return `var(${airlineColors[code] ?? "--tracker-ink"})`;
}

export function formatFare(value) {
  return `¥${fareFormatter.format(value)}`;
}

export function formatStopover(row) {
  const status = getStopoverStatus(row);
  if (status === true) return row.stopoverName ? `经停·${row.stopoverName}` : "经停";
  return status === false ? "无经停" : null;
}

export function formatDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}时${minutes % 60}分` : `${minutes}分`;
}

export function tripLabel(row) {
  const labels = [];
  if (row.transferCount > 0) labels.push(`${row.transferCount} 次中转`);
  if (row.hasStopover === true) labels.push(formatStopover(row));
  if (labels.length) return labels.join(" · ");
  return isNonstop(row) ? "直飞" : "行程未知";
}
