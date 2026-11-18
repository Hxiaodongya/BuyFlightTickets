import assert from "node:assert/strict";
import test from "node:test";
import {
  getSeriesKey,
  normalizeObservations,
  normalizePlan,
  validatePlan,
} from "../src/shared/domain.js";

const validPlan = {
  originCityId: "city-hgh",
  destinationCityId: "city-cgq",
  travelDates: ["2027-02-04", "2027-02-05"],
  airlineCodes: ["CA", "CZ"],
};

test("requires known and different origin and destination cities", () => {
  const errors = validatePlan({
    ...validPlan,
    originCityId: "unknown-city",
    destinationCityId: "city-hgh",
  });

  assert.ok(errors.originCityId);
  assert.equal(errors.destinationCityId, undefined);
  assert.ok(
    validatePlan({
      ...validPlan,
      originCityId: "city-hgh",
      destinationCityId: "city-hgh",
    }).destinationCityId,
  );
  assert.ok(validatePlan({ ...validPlan, destinationCityId: "unknown-city" }).destinationCityId);
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

test("normalizes a city-only plan and discards legacy or unsupported fields", () => {
  const plan = normalizePlan({
    ...validPlan,
    originCityName: "错误的出发地",
    destinationCityName: "错误的到达地",
    name: "用户填写名称",
    originCode: "HGH",
    destinationCode: "CGQ",
    adultCount: 7,
    cabin: "business",
  });

  assert.equal(plan.originCityId, "city-hgh");
  assert.equal(plan.destinationCityId, "city-cgq");
  assert.equal(plan.originCityName, "杭州");
  assert.equal(plan.destinationCityName, "长春");
  assert.equal(plan.collectionTime, "09:00");
  assert.deepEqual(plan.travelDates, ["2027-02-04", "2027-02-05"]);
  assert.deepEqual(plan.airlineCodes, ["CA", "CZ"]);
  for (const key of ["name", "originCode", "destinationCode", "adultCount", "cabin"]) {
    assert.equal(Object.hasOwn(plan, key), false);
  }
});

test("stores city fields and fixed economy collection values on observations", () => {
  const plan = normalizePlan({ ...validPlan, id: "plan-1" });
  const [observation] = normalizeObservations(
    plan,
    "CA",
    [{
      travelDate: "2027-02-04",
      flightNo: "CA123",
      listedFareCny: 1280,
      stopCount: 0,
    }],
    "2026-11-18T09:00:00+08:00",
  );

  assert.equal(observation.originCityId, "city-hgh");
  assert.equal(observation.originCityName, "杭州");
  assert.equal(observation.destinationCityId, "city-cgq");
  assert.equal(observation.destinationCityName, "长春");
  assert.equal(observation.adultCount, 1);
  assert.equal(observation.cabin, "economy");
  assert.equal(Object.hasOwn(observation, "originCode"), false);
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
