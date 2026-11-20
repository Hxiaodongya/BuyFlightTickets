import assert from "node:assert/strict";
import test from "node:test";
import { findNextCollection, getQuoteSummary } from "../src/dashboard/dashboard-model.js";

const origin = {
  planId: "hgh-cgq",
  travelDate: "2027-02-04",
  captureDate: "2026-11-19",
  capturedAt: "2026-11-19T01:00:00Z",
  airlineCode: "GJ",
  flightNo: "GJ8567",
};

test("separates the historical minimum, latest day's range, and distinct monitored flights", () => {
  const rows = [
    { ...origin, id: "old", listedFareCny: 1650 },
    { ...origin, id: "latest", captureDate: "2026-11-20", listedFareCny: 1900 },
    { ...origin, id: "other", captureDate: "2026-11-20", flightNo: "GJ8087", listedFareCny: 5300 },
    { ...origin, id: "tie", travelDate: "2027-02-05", listedFareCny: 1650 },
  ];
  const summary = getQuoteSummary(rows);
  assert.equal(summary.lowest.id, "old");
  assert.deepEqual(summary.lowestIds, ["old", "tie"]);
  assert.deepEqual(summary.latestRange, { date: "2026-11-20", min: 1900, max: 5300, count: 2 });
  assert.equal(summary.flightCount, 3);
  assert.equal(summary.quoteCount, 4);
});

test("leaves the historical price and latest range absent when no quotes match", () => {
  assert.deepEqual(getQuoteSummary([]), {
    lowest: null, lowestIds: [], latestRange: null, flightCount: 0, quoteCount: 0,
  });
});

test("shows the next registered alarm only for eligible plans in the selected route", () => {
  const plans = [
    { id: "hgh-cgq", enabled: true },
    { id: "pek-pvg", enabled: true },
    { id: "disabled", enabled: false },
    { id: "missing", enabled: true },
  ];
  const alarms = [
    { name: "daily-collection:hgh-cgq", scheduledTime: 3000 },
    { name: "daily-collection:pek-pvg", scheduledTime: 2000 },
    { name: "daily-collection:disabled", scheduledTime: 1100 },
    { name: "daily-collection:deleted", scheduledTime: 1150 },
    { name: "unrelated:pek-pvg", scheduledTime: 1200 },
  ];
  assert.deepEqual(findNextCollection(plans, alarms, "", 1000), { planId: "pek-pvg", scheduledTime: 2000 });
  assert.deepEqual(findNextCollection(plans, alarms, "hgh-cgq", 1000), { planId: "hgh-cgq", scheduledTime: 3000 });
  assert.equal(findNextCollection(plans, alarms, "missing", 1000), null);
  assert.equal(findNextCollection(plans, alarms, "disabled", 1000), null);
  assert.equal(findNextCollection(plans, alarms, "pek-pvg", 2500), null);
});
