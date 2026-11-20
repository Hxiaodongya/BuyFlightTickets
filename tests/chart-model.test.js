import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChartModel,
  buildPriceChartView,
  filterObservations,
  selectChartDateLabels,
  sortPriceHistoryRows,
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
    transferCount: 1,
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

function chartQuote(id, captureDate, airlineCode, listedFareCny) {
  return {
    ...observations[0], id, captureDate, capturedAt: `${captureDate}T09:00:00Z`,
    airlineCode, listedFareCny, flightNo: `${airlineCode}${id}`,
  };
}

test("uses an airline distribution for up to two days with quotes and keeps same-airline overlaps together", () => {
  const early = "2026-11-18";
  const late = "2026-11-20";
  const model = buildChartModel([
    chartQuote("1", early, "CA", 1650),
    chartQuote("2", early, "CA", 1650),
    chartQuote("3", early, "CZ", 1650),
    chartQuote("4", late, "CA", 1650),
  ], ["2026-11-19", "2026-11-21"]);
  const chart = buildPriceChartView(model);
  assert.equal(chart.mode, "distribution");
  assert.deepEqual(chart.dataDates, [early, late]);
  assert.deepEqual(chart.airlines, ["CA", "CZ"]);
  assert.notEqual(chart.pointGroups.find((group) => group.observationIds.includes("1")).key,
    chart.pointGroups.find((group) => group.observationIds.includes("4")).key);
  assert.deepEqual(chart.pointGroups.map(({ observationIds }) => observationIds), [["1", "2"], ["3"], ["4"]]);
});

test("uses a timeline for three populated dates and preserves gaps in attempted dates", () => {
  const model = buildChartModel([
    chartQuote("1", "2026-11-17", "CA", 1800),
    chartQuote("2", "2026-11-19", "CA", 1650),
    chartQuote("3", "2026-11-19", "CZ", 1650),
    chartQuote("4", "2026-11-20", "CA", 1800),
  ], ["2026-11-18"]);
  const chart = buildPriceChartView(model);
  assert.equal(chart.mode, "trend");
  assert.deepEqual(chart.captureDates, ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  assert.deepEqual(chart.pointGroups.find((group) => group.observationIds.includes("2")).observationIds, ["2", "3"]);
});

test("focuses the axis on the lower fare cluster without removing quotes from the source model", () => {
  const fares = [1650, 1700, 1900, 5300, 5900];
  const model = buildChartModel(fares.map((fare, index) => chartQuote(String(index), "2026-11-20", "GJ", fare)));
  const focused = buildPriceChartView(model);
  assert.equal(focused.hiddenQuoteCount, 2);
  assert.deepEqual(focused.pointGroups.map(({ listedFareCny }) => listedFareCny), fares.slice(0, 3));
  assert.ok(focused.scale.max >= 1900 && focused.scale.max < 5300);
  assert.ok(focused.scale.ticks.every((tick, index, ticks) => index === 0 || tick < ticks[index - 1]));
  const full = buildPriceChartView(model, { focusLowPrices: false });
  assert.equal(full.hiddenQuoteCount, 0);
  assert.deepEqual(full.pointGroups.map(({ listedFareCny }) => listedFareCny), fares);
  assert.ok(full.scale.max >= 5900);
  assert.equal(model.pointGroups.length, 5);
});

test("does not hide gradual price variation or half of a two-quote sample", () => {
  for (const fares of [[1650, 5900], [1650, 1750, 1900, 2100, 2250]]) {
    const model = buildChartModel(fares.map((fare, index) => chartQuote(String(index), "2026-11-20", "GJ", fare)));
    assert.equal(buildPriceChartView(model).hiddenQuoteCount, 0);
  }
});

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

test("keeps confirmed stopovers separate from transfers and ambiguous historical quotes", () => {
  const historical = { ...observations[2], transferCount: undefined };
  const stopover = { ...historical, flightNo: "CZ322", transferCount: 0, hasStopover: true };
  const mixed = { ...historical, flightNo: "CZ323", transferCount: 1, hasStopover: true };
  const rows = [historical, stopover, mixed];

  assert.deepEqual(filterObservations(rows, { tripType: "transfer" }), [mixed]);
  assert.deepEqual(filterObservations(rows, { tripType: "stopover" }), [stopover, mixed]);
  assert.deepEqual(filterObservations(rows, { tripType: "direct" }), []);
  assert.deepEqual(filterObservations(rows), rows);
});

test("keeps fares with an unknown stop count only when trip type is unrestricted", () => {
  const unknown = { ...observations[0], stopCount: null };

  assert.deepEqual(filterObservations([unknown]), [unknown]);
  assert.deepEqual(filterObservations([unknown], { tripType: "direct" }), []);
  assert.deepEqual(filterObservations([unknown], { tripType: "transfer" }), []);
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
    { observationId: "a-2", captureDate: "2026-11-17", capturedAt: "2026-11-17T01:00:00.000Z", listedFareCny: 1250 },
    { observationId: "a-1", captureDate: "2026-11-18", capturedAt: "2026-11-18T01:00:00.000Z", listedFareCny: 1200 },
  ]);
});

test("leaves missing dates absent and keeps fares before tax additions", () => {
  const model = buildChartModel(observations.filter((item) => item.id !== "a-2"));
  const series = model.series.find((item) => item.flightNo === "CA123");

  assert.deepEqual(series.points, [
    { observationId: "a-1", captureDate: "2026-11-18", capturedAt: "2026-11-18T01:00:00.000Z", listedFareCny: 1200 },
  ]);
});

test("fits more capture date labels on wider axes without crowding the endpoints", () => {
  const dates = Array.from({ length: 20 }, (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`);

  for (const [width, expectedCount] of [[520, 5], [1240, 10], [1710, 20]]) {
    const labels = selectChartDateLabels(dates, width);
    assert.equal(labels.length, expectedCount);
    assert.equal(labels[0], dates[0]);
    assert.equal(labels.at(-1), dates.at(-1));
    const gapPerDate = width / (dates.length - 1);
    for (let index = 1; index < labels.length; index += 1) {
      assert.ok((dates.indexOf(labels[index]) - dates.indexOf(labels[index - 1])) * gapPerDate >= 90);
    }
  }
});

test("uses the latest date label when there is only room for one", () => {
  const date = "2026-11-19";

  assert.deepEqual(selectChartDateLabels([], 60), []);
  assert.deepEqual(selectChartDateLabels([date], 60), [date]);
  assert.deepEqual(selectChartDateLabels(["2026-11-18", date], 60), [date]);
});

test("groups only the latest observations at the exact same date and price", () => {
  const earlierPrice = { ...observations[0], id: "earlier", listedFareCny: 990, capturedAt: "2026-11-18T00:00:00.000Z" };
  const previousDay = { ...observations[1], listedFareCny: 1200 };
  const sameFlightOtherTravelDate = { ...observations[0], id: "next-flight", travelDate: "2027-02-05" };
  const equalPrice = { ...observations[2], listedFareCny: 1200 };
  const closePrice = { ...observations[3], listedFareCny: 1200.01 };
  const model = buildChartModel([earlierPrice, observations[0], previousDay, sameFlightOtherTravelDate, equalPrice, closePrice]);

  assert.equal(model.pointGroups?.length, 3);
  assert.deepEqual(
    model.pointGroups.find((group) => group.captureDate === "2026-11-17").observationIds,
    ["a-2"],
  );
  assert.deepEqual(model.lowestFareGroup, {
    key: "2026-11-18|1200",
    captureDate: "2026-11-18",
    listedFareCny: 1200,
    observationIds: ["a-1", "next-flight", "b-1"],
    airlineCode: null,
  });
  assert.deepEqual(model.pointGroups.find((group) => group.listedFareCny === 1200.01).observationIds, ["c-1"]);
});

test("identifies the lowest single flight after filters are applied", () => {
  const filtered = filterObservations(observations, { filterMode: "airline", selectedValues: ["CZ"] });
  const { lowestFareGroup } = buildChartModel(filtered);

  assert.equal(lowestFareGroup?.listedFareCny, 1100);
  assert.equal(lowestFareGroup.airlineCode, "CZ");
  assert.deepEqual(lowestFareGroup.observationIds, ["b-1"]);
  assert.equal(buildChartModel([]).lowestFareGroup, null);
});

test("sorts numeric fares in both directions without mutating observations", () => {
  const records = [
    { ...observations[0], listedFareCny: 1200.05 },
    { ...observations[1], listedFareCny: 980 },
    { ...observations[2], listedFareCny: 1200.05 },
    { ...observations[3], listedFareCny: 1200.01 },
  ];

  assert.deepEqual(sortPriceHistoryRows(records).map(({ id }) => id), ["a-1", "b-1", "c-1", "a-2"]);
  assert.deepEqual(sortPriceHistoryRows(records, "ascending").map(({ id }) => id), ["a-2", "c-1", "a-1", "b-1"]);
  assert.deepEqual(sortPriceHistoryRows(records, "descending").map(({ id }) => id), ["a-1", "b-1", "c-1", "a-2"]);
  assert.deepEqual(records.map(({ id }) => id), ["a-1", "a-2", "b-1", "c-1"]);
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
