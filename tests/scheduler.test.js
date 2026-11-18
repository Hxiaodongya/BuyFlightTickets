import assert from "node:assert/strict";
import test from "node:test";
import {
  createScheduler,
  getNextDailyRun,
  getTodayCollectionStatus,
  markInterruptedRuns,
} from "../src/background/scheduler.js";

test("schedules for today when the local time has not arrived", () => {
  const now = new Date(2026, 10, 18, 8, 30, 0);
  const expected = new Date(2026, 10, 18, 9, 0, 0).getTime();

  assert.equal(getNextDailyRun(now, 9, 0), expected);
});

test("rolls the next run to tomorrow at or after the scheduled time", () => {
  const now = new Date(2026, 10, 18, 9, 0, 0);
  const expected = new Date(2026, 10, 19, 9, 0, 0).getTime();

  assert.equal(getNextDailyRun(now, 9, 0), expected);
  assert.equal(getNextDailyRun(new Date(2026, 10, 18, 9, 1), 9, 0), expected);
});

test("uses local 09:00 as the default schedule", () => {
  const now = new Date(2026, 10, 18, 8, 0, 0);
  const expected = new Date(2026, 10, 18, 9, 0, 0).getTime();

  assert.equal(getNextDailyRun(now), expected);
});

test("reports whether today's latest run is missing, complete, or partial", () => {
  const now = new Date(2026, 10, 18, 12, 0, 0);

  assert.equal(getTodayCollectionStatus([], now), "not-collected");
  assert.equal(
    getTodayCollectionStatus(
      [{ startedAt: "2026-11-18T02:00:00.000Z", status: "complete" }],
      now,
    ),
    "complete",
  );
  assert.equal(
    getTodayCollectionStatus(
      [{ startedAt: "2026-11-18T02:00:00.000Z", status: "partial" }],
      now,
    ),
    "partial",
  );
});

test("marks persisted running jobs as interrupted after Chrome restarts", async () => {
  const runs = [
    {
      id: "run-partial",
      startedAt: "2026-11-18T02:00:00.000Z",
      status: "running",
      successCount: 1,
      failureCount: 0,
    },
    {
      id: "run-old",
      startedAt: "2026-11-17T02:00:00.000Z",
      status: "complete",
      successCount: 2,
      failureCount: 0,
    },
  ];
  const saved = [];
  const storage = {
    async listRuns() {
      return runs;
    },
    async saveRun(run) {
      saved.push(structuredClone(run));
    },
  };

  await markInterruptedRuns(storage, new Date("2026-11-18T04:00:00.000Z"));

  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, "partial");
  assert.equal(saved[0].endedAt, "2026-11-18T04:00:00.000Z");
});

test("recreates enabled plan alarms and removes stale alarms", async () => {
  const created = [];
  const removed = [];
  const alarmsApi = {
    async getAll() {
      return [
        { name: "daily-collection:deleted-plan" },
        { name: "another-extension-alarm" },
      ];
    },
    async create(name, options) {
      created.push({ name, options });
    },
    async clear(name) {
      removed.push(name);
    },
  };
  const storage = {
    async listPlans() {
      return [
        { id: "enabled", enabled: true, collectionTime: "09:00" },
        { id: "disabled", enabled: false, collectionTime: "09:00" },
      ];
    },
  };
  const scheduler = createScheduler({
    alarmsApi,
    storage,
    now: () => new Date(2026, 10, 18, 8, 0),
  });

  await scheduler.rescheduleAll();

  assert.deepEqual(created, [
    {
      name: "daily-collection:enabled",
      options: { when: new Date(2026, 10, 18, 9, 0).getTime() },
    },
  ]);
  assert.deepEqual(removed, [
    "daily-collection:deleted-plan",
    "daily-collection:disabled",
  ]);
});

test("runs only the alarm plan and schedules its next occurrence", async () => {
  const calls = [];
  const scheduler = createScheduler({
    alarmsApi: {
      async getAll() {
        return [];
      },
      async create(name, options) {
        calls.push({ name, options });
      },
      async clear(name) {
        calls.push({ name, cleared: true });
      },
    },
    storage: {
      async listPlans() {
        return [{ id: "p1", enabled: true, collectionTime: "09:00" }];
      },
    },
    onScheduledRun: async (planId) => calls.push({ planId }),
    now: () => new Date(2026, 10, 18, 9, 0),
  });

  assert.equal(await scheduler.handleAlarm({ name: "daily-collection:p1" }), true);
  assert.equal(await scheduler.handleAlarm({ name: "other-alarm" }), false);
  assert.deepEqual(calls, [
    { planId: "p1" },
    {
      name: "daily-collection:p1",
      options: { when: new Date(2026, 10, 19, 9, 0).getTime() },
    },
  ]);
});
