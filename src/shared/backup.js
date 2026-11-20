import { AIRLINE_NAMES, isValidClock, isValidDate, migrateStoredPlan } from "./domain.js";

const BACKUP_FORMAT = "flight-tracker-backup";
const BACKUP_VERSION = 1;
const RUN_STATUSES = new Set(["running", "paused", "complete", "completed", "partial", "failed"]);
const TASK_STATUSES = new Set(["pending", "running", "awaiting-manual", "complete", "completed", "failed"]);
const ROUTE_FIELDS = ["originCityId", "originCityName", "originName", "originCode", "destinationCityId", "destinationCityName", "destinationName", "destinationCode"];
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isAirline(value) {
  return typeof value === "string" && Object.hasOwn(AIRLINE_NAMES, value);
}

function isTimestamp(value) {
  return typeof value === "string" && value[10] === "T" &&
    isValidDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function optionalFields(record, keys, check) {
  return keys.every((key) => record[key] == null || check(record[key]));
}

function textFields(record, keys) {
  return optionalFields(record, keys, (value) => typeof value === "string");
}

function isPlan(plan) {
  return textFields(plan, ROUTE_FIELDS) &&
    optionalFields(plan, ["createdAt", "updatedAt"], isTimestamp) &&
    (plan.enabled == null || typeof plan.enabled === "boolean") &&
    (plan.migrationStatus == null || plan.migrationStatus === "needs-city-selection") &&
    (plan.collectionTime == null || (typeof plan.collectionTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(plan.collectionTime))) &&
    Array.isArray(plan.travelDates) && plan.travelDates.length > 0 && plan.travelDates.every(isValidDate) &&
    Array.isArray(plan.airlineCodes) && plan.airlineCodes.length > 0 && plan.airlineCodes.every(isAirline);
}

function isObservation(row) {
  return isId(row.planId) && isId(row.flightNo) && isAirline(row.airlineCode) &&
    isValidDate(row.travelDate) && isValidDate(row.captureDate) && isTimestamp(row.capturedAt) &&
    Number.isFinite(row.listedFareCny) && row.listedFareCny > 0 &&
    optionalFields(row, ["stopCount", "transferCount"], isCount) &&
    optionalFields(row, ["arrivalDate"], (value) => isValidDate(value) && value >= row.travelDate) &&
    optionalFields(row, ["departureTime", "arrivalTime"], isValidClock) &&
    optionalFields(row, ["hasStopover"], (value) => typeof value === "boolean") &&
    optionalFields(row, ["durationMinutes"], (value) => isCount(value) && value > 0) &&
    textFields(row, [...ROUTE_FIELDS, "airlineName", "source", "sourceUrl", "stopoverName", "cabin", "fareProduct"]);
}

function isTask(task) {
  if (!isRecord(task) || !isId(task.planId) || !isAirline(task.airlineCode) ||
      !isValidDate(task.travelDate) || !TASK_STATUSES.has(task.status) || !textFields(task, ["error"])) {
    return false;
  }
  const { diagnostics } = task;
  return diagnostics == null || (isRecord(diagnostics) &&
    optionalFields(diagnostics, ["visibleCardCount", "candidateCount", "flightNumberCardCount", "economyFareCardCount", "parsedRowCount", "noticeClickCount"], isCount) &&
    (diagnostics.visibleNoticeLabels == null || (Array.isArray(diagnostics.visibleNoticeLabels) &&
      diagnostics.visibleNoticeLabels.every((label) => typeof label === "string"))));
}

function isRun(run) {
  return RUN_STATUSES.has(run.status) && isTimestamp(run.startedAt) &&
    optionalFields(run, ["endedAt", "updatedAt"], isTimestamp) &&
    optionalFields(run, ["successCount", "failureCount"], isCount) && textFields(run, ["error"]) &&
    (run.planIds == null || (Array.isArray(run.planIds) && run.planIds.every(isId))) &&
    (run.tasks == null || (Array.isArray(run.tasks) && run.tasks.every(isTask)));
}

function checkRecords(records, label, check) {
  if (!Array.isArray(records)) throw new TypeError(`备份的${label}必须是列表。`);

  const ids = new Set();
  for (const [index, record] of records.entries()) {
    if (!isRecord(record) || !isId(record.id) || !check(record)) {
      throw new TypeError(`备份中的第 ${index + 1} 条${label}格式无效。`);
    }
    if (ids.has(record.id)) throw new TypeError(`备份中的${label}有重复的记录编号。`);
    ids.add(record.id);
  }
}

function portableRun(run, exportedAt) {
  const { manualVerification, ...result } = run;
  if (run.status !== "running" && run.status !== "paused") return result;

  const error = "备份时采集尚未结束，此记录仅保留已完成的结果";
  let interruptedCount = 0;
  const tasks = (run.tasks ?? []).map((task) => {
    if (task.status !== "running" && task.status !== "awaiting-manual") return task;
    interruptedCount += 1;
    return { ...task, status: "failed", endedAt: exportedAt, error };
  });
  return {
    ...result,
    status: run.successCount > 0 ? "partial" : "failed",
    failureCount: (run.failureCount ?? 0) + interruptedCount,
    endedAt: exportedAt,
    updatedAt: exportedAt,
    error,
    tasks,
  };
}

export function createBackup({ plans, observations, runs }, now = new Date()) {
  return validateBackup({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    plans,
    observations,
    runs,
  });
}

export function validateBackup(value) {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) {
    throw new TypeError("请选择航班价格追踪导出的 JSON 备份。");
  }
  if (value.version !== BACKUP_VERSION) throw new TypeError("此备份版本暂不支持。");
  if (!isTimestamp(value.exportedAt)) throw new TypeError("备份时间无效。");

  checkRecords(value.plans, "查询计划", isPlan);
  checkRecords(value.observations, "航班报价", isObservation);
  checkRecords(value.runs, "采集记录", isRun);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: value.exportedAt,
    plans: value.plans.map(migrateStoredPlan),
    observations: value.observations,
    runs: value.runs.map((run) => portableRun(run, value.exportedAt)),
  };
}

export function parseBackup(text) {
  let value;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new TypeError("文件不是有效的 JSON 备份。");
  }
  return validateBackup(value);
}
