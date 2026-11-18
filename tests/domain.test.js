import assert from "node:assert/strict";
import test from "node:test";
import {
  getSeriesKey,
  normalizeObservations,
  normalizePlan,
  validatePlan,
} from "../src/shared/domain.js";

const validPlan = {
  originCode: "HGH",
  destinationCode: "CGQ",
  travelDates: ["2027-02-04", "2027-02-05"],
  airlineCodes: ["CA", "CZ"],
};

test("requires three-letter origin and destination airport codes", () => {
  const errors = validatePlan({
    ...validPlan,
    originCode: "",
    destinationCode: "Changchun",
  });

  assert.ok(errors.originCode);
  assert.ok(errors.destinationCode);
});

test("requires at least one valid travel date", () => {
  assert.ok(validatePlan({ ...validPlan, travelDates: [] }).travelDates);
  assert.ok(
    validatePlan({ ...validPlan, travelDates: ["2027-02-30"] }).travelDates,
  );
});

test("requires at least one supported airline", () => {
  assert.ok(validatePlan({ ...validPlan, airlineCodes: [] }).airlineCodes);
  assert.ok(
    validatePlan({ ...validPlan, airlineCodes: ["XX"] }).airlineCodes,
  );
});

test("normalizes the example plan with one adult and economy defaults", () => {
  const plan = normalizePlan({
    ...validPlan,
    originName: "杭州萧山",
    destinationName: "长春龙嘉",
  });

  assert.equal(plan.adultCount, 1);
  assert.equal(plan.cabin, "economy");
  assert.equal(plan.collectionTime, "09:00");
  assert.equal(plan.originName, "杭州萧山");
  assert.equal(plan.destinationName, "长春龙嘉");
  assert.deepEqual(plan.travelDates, ["2027-02-04", "2027-02-05"]);
  assert.deepEqual(plan.airlineCodes, ["CA", "CZ"]);
});

test("builds a stable series key with an unknown fare product fallback", () => {
  assert.equal(
    getSeriesKey({
      planId: "plan-1",
      travelDate: "2027-02-04",
      airlineCode: "CA",
      flightNo: "CA1234",
      cabin: "economy",
    }),
    "plan-1|2027-02-04|CA|CA1234|economy|unknown",
  );
});

test("discards rows without a positive finite displayed fare", () => {
  const plan = normalizePlan({ ...validPlan, id: "plan-1" });
  const rows = [
    { flightNo: "CA123", listedFareCny: null, stopCount: 0 },
    { flightNo: "CA124", listedFareCny: 0, stopCount: 0 },
    { flightNo: "CA125", listedFareCny: -10, stopCount: 1 },
    { flightNo: "CA126", listedFareCny: Number.NaN, stopCount: 0 },
  ];

  assert.deepEqual(
    normalizeObservations(plan, "CA", rows, "2026-11-18T09:00:00+08:00"),
    [],
  );
});

test("stores the listed fare without copying tax or total fields", () => {
  const plan = normalizePlan({ ...validPlan, id: "plan-1" });
  const [observation] = normalizeObservations(
    plan,
    "CA",
    [
      {
        travelDate: "2027-02-04",
        flightNo: "CA123",
        listedFareCny: "1,280",
        stopCount: 0,
        cabin: "economy",
        fareProduct: "standard",
        taxCny: 50,
        totalPriceCny: 1_330,
      },
    ],
    "2026-11-18T09:00:00+08:00",
  );

  assert.equal(observation.listedFareCny, 1280);
  assert.equal(observation.currency, "CNY");
  assert.equal(observation.captureDate, "2026-11-18");
  assert.equal(Object.hasOwn(observation, "taxCny"), false);
  assert.equal(Object.hasOwn(observation, "totalPriceCny"), false);
});
