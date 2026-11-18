import assert from "node:assert/strict";
import test from "node:test";
import { createStorage } from "../src/shared/storage.js";

function createMemoryArea(initial = {}) {
  const values = new Map(Object.entries(structuredClone(initial)));

  return {
    async get(keys) {
      const requestedKeys = keys === null ? [...values.keys()] : [].concat(keys);
      return Object.fromEntries(
        requestedKeys
          .filter((key) => values.has(key))
          .map((key) => [key, structuredClone(values.get(key))]),
      );
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        values.set(key, structuredClone(value));
      }
    },
    async remove(keys) {
      for (const key of [].concat(keys)) {
        values.delete(key);
      }
    },
  };
}

const basePlan = {
  id: "plan-1",
  originCityId: "city-hgh",
  destinationCityId: "city-cgq",
  travelDates: ["2027-02-04"],
  airlineCodes: ["CA"],
};

test("upserts a plan by ID", async () => {
  const storage = createStorage(createMemoryArea());
  await storage.savePlan({ ...basePlan, collectionTime: "08:00" });
  await storage.savePlan({ ...basePlan, collectionTime: "10:00" });

  const plans = await storage.listPlans();
  assert.equal(plans.length, 1);
  assert.equal(plans[0].collectionTime, "10:00");
});

test("migrates a known legacy airport route to canonical city fields", async () => {
  const area = createMemoryArea({
    "plan:legacy": {
      id: "legacy",
      name: "杭州 - 长春",
      originName: "杭州萧山",
      originCode: "HGH",
      destinationName: "长春龙嘉",
      destinationCode: "CGQ",
      travelDates: ["2027-02-04"],
      airlineCodes: ["CA"],
      adultCount: 2,
      cabin: "business",
      collectionTime: "09:00",
      enabled: true,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-02T00:00:00.000Z",
    },
  });
  const storage = createStorage(area);

  const [plan] = await storage.listPlans();
  const [savedPlan] = Object.values(await area.get(null));

  assert.equal(plan.id, "legacy");
  assert.equal(plan.originCityName, "杭州");
  assert.equal(plan.destinationCityName, "长春");
  assert.equal(plan.originCityId, "city-hgh");
  assert.equal(plan.destinationCityId, "city-cgq");
  assert.equal(plan.createdAt, "2026-11-01T00:00:00.000Z");
  assert.equal(plan.updatedAt, "2026-11-02T00:00:00.000Z");
  assert.equal(Object.hasOwn(savedPlan, "originCode"), false);
  assert.equal(Object.hasOwn(savedPlan, "name"), false);
  assert.equal(Object.hasOwn(savedPlan, "adultCount"), false);
  assert.equal(Object.hasOwn(savedPlan, "cabin"), false);
});

test("retains unknown legacy routes disabled until the user selects cities", async () => {
  const original = {
    id: "legacy-unknown",
    name: "旧路线",
    originCode: "ZZZ",
    destinationCode: "YYY",
    travelDates: ["2027-02-04"],
    airlineCodes: ["CA"],
    enabled: true,
  };
  const storage = createStorage(createMemoryArea({ "plan:legacy-unknown": original }));

  const [plan] = await storage.listPlans();

  assert.equal(plan.id, "legacy-unknown");
  assert.equal(plan.enabled, false);
  assert.equal(plan.migrationStatus, "needs-city-selection");
  assert.equal(plan.originCityId, "");
  assert.equal(plan.destinationCityId, "");
  assert.equal(plan.originCode, original.originCode);
  assert.equal(plan.travelDates[0], original.travelDates[0]);
});

test("deletes a plan and its observations", async () => {
  const storage = createStorage(createMemoryArea());
  await storage.savePlan(basePlan);
  await storage.saveObservations([
    { id: "obs-1", planId: basePlan.id, listedFareCny: 1200 },
    { id: "obs-2", planId: "another-plan", listedFareCny: 1300 },
  ]);

  await storage.deletePlan(basePlan.id);

  assert.deepEqual(await storage.listPlans(), []);
  assert.deepEqual(
    (await storage.listObservations()).map((item) => item.id),
    ["obs-2"],
  );
});

test("lists runs newest first", async () => {
  const storage = createStorage(createMemoryArea());
  await storage.saveRun({ id: "old", startedAt: "2026-11-17T09:00:00Z" });
  await storage.saveRun({ id: "new", startedAt: "2026-11-18T09:00:00Z" });

  assert.deepEqual(
    (await storage.listRuns()).map((run) => run.id),
    ["new", "old"],
  );
});

test("deduplicates observations by ID and retains earlier partial results", async () => {
  const storage = createStorage(createMemoryArea());
  await storage.saveObservations([
    { id: "flight-day-1", planId: basePlan.id, listedFareCny: 1200 },
    { id: "flight-day-2", planId: basePlan.id, listedFareCny: 1250 },
  ]);
  await storage.saveObservations([
    { id: "flight-day-1", planId: basePlan.id, listedFareCny: 1180 },
  ]);

  const observations = await storage.listObservations();
  assert.equal(observations.length, 2);
  assert.equal(
    observations.find((item) => item.id === "flight-day-1").listedFareCny,
    1180,
  );
  assert.equal(
    observations.find((item) => item.id === "flight-day-2").listedFareCny,
    1250,
  );
});

test("propagates storage quota errors", async () => {
  const area = createMemoryArea();
  area.set = async () => {
    throw new Error("QUOTA_BYTES_PER_ITEM quota exceeded");
  };
  const storage = createStorage(area);

  await assert.rejects(
    storage.saveRun({ id: "run-1", startedAt: "2026-11-18T09:00:00Z" }),
    /quota exceeded/,
  );
});
