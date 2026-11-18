import assert from "node:assert/strict";
import test from "node:test";
import { createStorage } from "../src/shared/storage.js";

function createMemoryArea() {
  const values = new Map();

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
  originCode: "HGH",
  destinationCode: "CGQ",
  travelDates: ["2027-02-04"],
  airlineCodes: ["CA"],
};

test("upserts a plan by ID", async () => {
  const storage = createStorage(createMemoryArea());
  await storage.savePlan({ ...basePlan, name: "first" });
  await storage.savePlan({ ...basePlan, name: "updated" });

  const plans = await storage.listPlans();
  assert.equal(plans.length, 1);
  assert.equal(plans[0].name, "updated");
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
