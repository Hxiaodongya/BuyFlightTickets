import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanPayload,
  getFilterOptions,
  getRouteLabel,
} from "../src/shared/ui-model.js";

const draft = {
  originCityId: "city-hgh",
  destinationCityId: "city-cgq",
  travelDates: ["2027-02-05", "2027-02-04"],
  airlineCodes: ["CA", "CZ"],
  collectionTime: "09:00",
  enabled: true,
};

test("creates canonical city-only plan payloads and preserves edited plan identity", () => {
  const plan = createPlanPayload(
    { ...draft, originCode: "BAD", name: "不应保存" },
    { id: "plan-existing", createdAt: "2026-11-01T00:00:00.000Z" },
  );

  assert.equal(plan.id, "plan-existing");
  assert.equal(plan.originCityName, "杭州");
  assert.equal(plan.destinationCityName, "长春");
  assert.deepEqual(plan.travelDates, ["2027-02-04", "2027-02-05"]);
  assert.equal(Object.hasOwn(plan, "name"), false);
  assert.equal(Object.hasOwn(plan, "originCode"), false);
  assert.equal(Object.hasOwn(plan, "adultCount"), false);
  assert.equal(Object.hasOwn(plan, "cabin"), false);
});

test("rejects same-city and empty-date form drafts", () => {
  assert.throws(() =>
    createPlanPayload({ ...draft, destinationCityId: "city-hgh" }),
  );
  assert.throws(() => createPlanPayload({ ...draft, travelDates: [] }));
});

test("formats routes from city names only", () => {
  assert.equal(
    getRouteLabel({ originCityName: "杭州", destinationCityName: "长春" }),
    "杭州 → 长春",
  );
});

test("derives deduplicated airline and flight filters from observations", () => {
  const observations = [
    { airlineCode: "CZ", airlineName: "中国南方航空", flightNo: "CZ320" },
    { airlineCode: "CA", airlineName: "中国国际航空", flightNo: "CA123" },
    { airlineCode: "CA", airlineName: "中国国际航空", flightNo: "CA123" },
  ];

  assert.deepEqual(getFilterOptions(observations, "airline"), [
    { value: "CA", label: "中国国际航空" },
    { value: "CZ", label: "中国南方航空" },
  ]);
  assert.deepEqual(getFilterOptions(observations, "flight"), [
    { value: "CA123", label: "CA123" },
    { value: "CZ320", label: "CZ320" },
  ]);
});
