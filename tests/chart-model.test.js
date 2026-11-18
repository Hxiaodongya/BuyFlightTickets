import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChartModel,
  filterObservations,
} from "../src/shared/chart-model.js";

const observations = [
  {
    id: "a-1",
    planId: "hgh-cgq",
    travelDate: "2027-02-04",
    captureDate: "2026-11-18",
    capturedAt: "2026-11-18T01:00:00.000Z",
    airlineCode: "CA",
    flightNo: "CA123",
    cabin: "economy",
    stopCount: 0,
    listedFareCny: 1200,
  },
  {
    id: "a-2",
    planId: "hgh-cgq",
    travelDate: "2027-02-04",
    captureDate: "2026-11-17",
    capturedAt: "2026-11-17T01:00:00.000Z",
    airlineCode: "CA",
    flightNo: "CA123",
    cabin: "economy",
    stopCount: 0,
    listedFareCny: 1250,
  },
  {
    id: "b-1",
    planId: "hgh-cgq",
    travelDate: "2027-02-04",
    captureDate: "2026-11-18",
    capturedAt: "2026-11-18T02:00:00.000Z",
    airlineCode: "CZ",
    flightNo: "CZ321",
    cabin: "economy",
    stopCount: 1,
    listedFareCny: 1100,
  },
  {
    id: "c-1",
    planId: "other-route",
    travelDate: "2027-02-05",
    captureDate: "2026-11-18",
    capturedAt: "2026-11-18T03:00:00.000Z",
    airlineCode: "CA",
    flightNo: "CA456",
    cabin: "business",
    stopCount: 0,
    listedFareCny: 2400,
  },
];

test("intersects route, travel date, and trip type filters", () => {
  const filtered = filterObservations(observations, {
    planId: "hgh-cgq",
    travelDate: "2027-02-04",
    tripType: "direct",
  });

  assert.deepEqual(filtered.map((item) => item.flightNo), ["CA123", "CA123"]);
});

test("filters connecting flights only", () => {
  const filtered = filterObservations(observations, { tripType: "transfer" });

  assert.deepEqual(filtered.map((item) => item.flightNo), ["CZ321"]);
});

test("supports airline and flight selection modes", () => {
  assert.deepEqual(
    filterObservations(observations, {
      filterMode: "airline",
      selectedValues: ["CZ"],
    }).map((item) => item.flightNo),
    ["CZ321"],
  );
  assert.deepEqual(
    filterObservations(observations, {
      filterMode: "flight",
      selectedValues: ["CA123"],
    }).map((item) => item.id),
    ["a-1", "a-2"],
  );
});

test("returns no rows when an explicitly selected value has no matches", () => {
  assert.deepEqual(
    filterObservations(observations, {
      filterMode: "airline",
      selectedValues: ["XX"],
    }),
    [],
  );
});

test("sorts capture dates and keeps flights in separate series", () => {
  const model = buildChartModel(observations);

  assert.deepEqual(model.captureDates, ["2026-11-17", "2026-11-18"]);
  assert.equal(model.series.length, 3);
  assert.deepEqual(model.series[0].points, [
    { captureDate: "2026-11-17", capturedAt: "2026-11-17T01:00:00.000Z", listedFareCny: 1250 },
    { captureDate: "2026-11-18", capturedAt: "2026-11-18T01:00:00.000Z", listedFareCny: 1200 },
  ]);
});

test("leaves missing dates absent and keeps fares before tax additions", () => {
  const model = buildChartModel(observations.filter((item) => item.id !== "a-2"));
  const series = model.series.find((item) => item.flightNo === "CA123");

  assert.deepEqual(series.points, [
    { captureDate: "2026-11-18", capturedAt: "2026-11-18T01:00:00.000Z", listedFareCny: 1200 },
  ]);
});

test("keeps collection dates with no observations so lines show a gap", () => {
  const gapObservations = [
    {
      ...observations[0],
      id: "gap-before",
      captureDate: "2026-11-17",
      capturedAt: "2026-11-17T01:00:00.000Z",
    },
    {
      ...observations[0],
      id: "gap-after",
      captureDate: "2026-11-19",
      capturedAt: "2026-11-19T01:00:00.000Z",
    },
  ];
  const model = buildChartModel(gapObservations, ["2026-11-18"]);

  assert.deepEqual(model.captureDates, ["2026-11-17", "2026-11-18", "2026-11-19"]);
  assert.equal(model.series[0].points.length, 2);
  assert.equal(
    model.series[0].points.some((point) => point.captureDate === "2026-11-18"),
    false,
  );
});
