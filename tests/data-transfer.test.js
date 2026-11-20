import assert from "node:assert/strict";
import test from "node:test";
import { createBackup, parseBackup } from "../src/shared/backup.js";
import { formatQuoteCsv, getBackupFilename, getQuoteCsvFilename } from "../src/dashboard/data-download.js";

const localDate = new Date(2026, 10, 20, 9, 40);
const quote = {
  originCityName: "杭州",
  destinationCityName: "长春",
  airlineName: "长龙航空",
  flightNo: "GJ8567",
  travelDate: "2027-02-04",
  captureDate: "2026-11-20",
  stopCount: 0,
  listedFareCny: 1650,
};

test("rejects malformed JSON, unrelated files, unsupported versions and duplicate record IDs", () => {
  const backup = createBackup({ plans: [], observations: [], runs: [] }, localDate);
  const record = { id: "run-1", status: "complete", startedAt: localDate.toISOString() };
  assert.throws(() => parseBackup("{"), /JSON/);
  assert.throws(() => parseBackup("[]"), /航班价格追踪/);
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, version: 2 })), /版本/);
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, runs: [record, record] })), /重复/);
  assert.deepEqual(parseBackup(`\uFEFF${JSON.stringify(backup)}`), backup);
});

test("backs up paused runs as historical records without retaining a verification session", () => {
  const task = { planId: "plan-1", travelDate: quote.travelDate, airlineCode: "CA" };
  const run = {
    id: "paused-run",
    startedAt: "2026-11-20T01:30:00.000Z",
    status: "paused",
    successCount: 1,
    failureCount: 0,
    manualVerification: { taskIndex: 1 },
    tasks: [
      { ...task, status: "complete" },
      { ...task, status: "awaiting-manual" },
      { ...task, status: "pending" },
    ],
  };
  const backup = createBackup({ plans: [], observations: [], runs: [run] }, localDate);
  const [saved] = parseBackup(JSON.stringify(backup)).runs;
  assert.equal(saved.status, "partial");
  assert.equal(saved.endedAt, backup.exportedAt);
  assert.equal(saved.failureCount, 1);
  assert.equal(saved.manualVerification, undefined);
  assert.deepEqual(saved.tasks.map(({ status }) => status), ["complete", "failed", "pending"]);
  assert.equal(run.status, "paused");
});

test("quote CSV retains input order, preserves Chinese, and escapes spreadsheet cells", () => {
  const csv = formatQuoteCsv([
    {
      ...quote, departureTime: "23:00", arrivalTime: "03:25", arrivalDate: "2027-02-05", durationMinutes: 265,
      hasStopover: true, stopoverName: "潍坊", stopCount: 1, listedFareCny: 1780,
    },
    { ...quote, flightNo: " =1+1", airlineName: '长,龙"航空', stopCount: 1 },
  ]);
  assert.ok(csv.startsWith("\uFEFF出发城市,到达城市,航司,航班号"));
  assert.match(csv, /起飞日期与时间,到达日期与时间,是否经停,总用时,采集日期/);
  assert.match(csv, /价格（CNY，未含税费）\r\n/);
  assert.deepEqual(csv.split("\r\n").slice(1, 3), [
    "杭州,长春,长龙航空,GJ8567,2027-02-04 23:00,2027-02-05 03:25,经停·潍坊,4时25分,2026-11-20,1780",
    `杭州,长春,"长,龙""航空",' =1+1,2027-02-04,,,,2026-11-20,1650`,
  ]);
});

test("round-trips new quote schedule fields alongside older backups and validates the new values", () => {
  const legacy = { ...quote, id: "old-quote", planId: "plan", airlineCode: "GJ", capturedAt: localDate.toISOString() };
  const enriched = {
    ...legacy, id: "new-quote", departureTime: "23:00", arrivalTime: "03:25", arrivalDate: "2027-02-05",
    stopCount: 1, transferCount: 0, hasStopover: true, stopoverName: "潍坊", durationMinutes: 265,
  };
  const backup = createBackup({ plans: [], observations: [legacy, enriched], runs: [] }, localDate);
  assert.deepEqual(parseBackup(JSON.stringify(backup)).observations, [legacy, enriched]);
  for (const overrides of [
    { arrivalDate: "2027-02-30" }, { arrivalDate: "2027-02-03" }, { arrivalTime: "25:00" },
    { durationMinutes: -1 }, { hasStopover: "是" },
  ]) {
    assert.throws(() => createBackup({ plans: [], observations: [{ ...enriched, ...overrides }], runs: [] }, localDate), /航班报价格式无效/);
  }
});

test("filenames include a local date and the route of the exported rows", () => {
  assert.equal(getBackupFilename(localDate), "flight-tracker-backup-2026-11-20.json");
  assert.equal(getQuoteCsvFilename([quote], localDate), "杭州-长春-航班报价-2026-11-20.csv");
  assert.equal(getQuoteCsvFilename([quote, { ...quote, destinationCityName: "上海" }], localDate), "多航线-航班报价-2026-11-20.csv");
});
