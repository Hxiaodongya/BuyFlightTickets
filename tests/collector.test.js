import assert from "node:assert/strict";
import test from "node:test";
import { createCollector } from "../src/background/collector.js";

const plans = [
  {
    id: "plan-1",
    originCode: "HGH",
    destinationCode: "CGQ",
    travelDates: ["2027-02-04", "2027-02-05"],
    airlineCodes: ["CA", "CZ"],
    adultCount: 1,
    cabin: "economy",
    enabled: true,
  },
  {
    id: "disabled-plan",
    originCode: "HGH",
    destinationCode: "PEK",
    travelDates: ["2027-02-04"],
    airlineCodes: ["CA"],
    adultCount: 1,
    cabin: "economy",
    enabled: false,
  },
];

function createStorage(overrides = {}) {
  const runs = new Map();
  const observations = new Map();

  return {
    runs,
    observations,
    async listPlans() {
      return overrides.plans ?? plans;
    },
    async listRuns() {
      return [...runs.values()];
    },
    async saveRun(run) {
      runs.set(run.id, structuredClone(run));
    },
    async saveObservations(rows) {
      if (overrides.saveObservations) {
        await overrides.saveObservations(rows);
      }
      for (const row of rows) {
        observations.set(row.id, row);
      }
    },
  };
}

function createTabsApi({ sendMessage } = {}) {
  let nextTabId = 1;
  const created = [];
  const removed = [];

  return {
    created,
    removed,
    async create(options) {
      const tab = { id: nextTabId++, status: "complete", ...options };
      created.push(tab);
      return tab;
    },
    async sendMessage(tabId, message) {
      if (sendMessage) {
        return sendMessage(tabId, message);
      }
      return {
        type: "COLLECTION_RESULT",
        requestId: message.requestId,
        airlineCode: message.airlineCode,
        rows: [
          {
            flightNo: message.airlineCode === "CA" ? "CA123" : "CZ321",
            listedFareCny: 1200,
            cabin: "economy",
            stopCount: 0,
          },
        ],
      };
    },
    async remove(tabId) {
      removed.push(tabId);
    },
  };
}

function createAdapters() {
  return {
    CA: {
      buildSearchUrl: ({ travelDate }) => `https://airchina.test/${travelDate}`,
    },
    CZ: {
      buildSearchUrl: ({ travelDate }) => `https://csair.test/${travelDate}`,
    },
  };
}

test("runs enabled plan, airline, and date jobs sequentially in inactive tabs", async () => {
  const storage = createStorage();
  const tabsApi = createTabsApi();
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const originalSendMessage = tabsApi.sendMessage;
  tabsApi.sendMessage = async (tabId, message) => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    const result = await originalSendMessage(tabId, message);
    activeRequests -= 1;
    return result;
  };
  const collector = createCollector({
    tabsApi,
    storage,
    adapters: createAdapters(),
    now: () => new Date("2026-11-18T01:00:00.000Z"),
  });

  const run = await collector.startRun("manual");

  assert.equal(run.status, "complete", JSON.stringify(run));
  assert.equal(run.successCount, 4);
  assert.equal(run.failureCount, 0);
  assert.equal(maxActiveRequests, 1);
  assert.equal(tabsApi.created.every((tab) => tab.active === false), true);
  assert.deepEqual(tabsApi.removed, [1, 2, 3, 4]);
  assert.equal(storage.observations.size, 4);
});

test("records adapter timeouts as failures and always removes the tab", async () => {
  const storage = createStorage({
    plans: [{ ...plans[0], travelDates: ["2027-02-04"], airlineCodes: ["CA"] }],
  });
  const tabsApi = createTabsApi({ sendMessage: () => new Promise(() => {}) });
  const collector = createCollector({
    tabsApi,
    storage,
    adapters: createAdapters(),
    timeoutMs: 5,
    now: () => new Date("2026-11-18T01:00:00.000Z"),
  });

  const run = await collector.startRun("manual", { planIds: ["plan-1"] });

  assert.equal(run.status, "failed");
  assert.match(run.tasks[0].error, /timed out/i);
  assert.deepEqual(tabsApi.removed, [1]);
});

test("rejects a second trigger while one run is active", async () => {
  const storage = createStorage({
    plans: [{ ...plans[0], travelDates: ["2027-02-04"], airlineCodes: ["CA"] }],
  });
  let releaseMessage;
  const tabsApi = createTabsApi({
    sendMessage: (tabId, message) =>
      new Promise((resolve) => {
        releaseMessage = () =>
          resolve({
            type: "COLLECTION_RESULT",
            requestId: message.requestId,
            airlineCode: message.airlineCode,
            rows: [
              { flightNo: "CA123", listedFareCny: 1200, stopCount: 0 },
            ],
          });
      }),
  });
  const collector = createCollector({
    tabsApi,
    storage,
    adapters: createAdapters(),
    now: () => new Date("2026-11-18T01:00:00.000Z"),
  });

  const firstRun = collector.startRun("manual", { planIds: ["plan-1"] });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(collector.startRun("manual"), {
    code: "RUN_ALREADY_ACTIVE",
  });
  releaseMessage();
  const result = await firstRun;

  assert.equal(result.status, "complete");
});

test("does not mark a run complete when observation persistence fails", async () => {
  const storage = createStorage({
    saveObservations: async () => {
      throw new Error("storage quota exceeded");
    },
  });
  const collector = createCollector({
    tabsApi: createTabsApi(),
    storage,
    adapters: createAdapters(),
    now: () => new Date("2026-11-18T01:00:00.000Z"),
  });

  const run = await collector.startRun("manual", { planIds: ["plan-1"] });

  assert.equal(run.status, "failed");
  assert.equal(run.failureCount, 4);
  assert.ok([...storage.runs.values()].every((savedRun) => savedRun.status !== "complete"));
});

test("accepts a correlated result pushed after an airline page navigation", async () => {
  const storage = createStorage({
    plans: [{ ...plans[0], travelDates: ["2027-02-04"], airlineCodes: ["CZ"] }],
  });
  const listeners = new Set();
  const runtimeApi = {
    onMessage: {
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
    },
  };
  const tabsApi = createTabsApi({
    sendMessage: async (tabId, message) => {
      setImmediate(() => {
        for (const listener of listeners) {
          listener({
            type: "COLLECTION_RESULT_PUSH",
            requestId: message.requestId,
            airlineCode: "CZ",
            rows: [
              {
                flightNo: "CZ321",
                listedFareCny: 1200,
                stopCount: 0,
                travelDate: message.travelDate,
              },
            ],
          });
        }
      });
      return {
        type: "COLLECTION_PENDING",
        requestId: message.requestId,
        airlineCode: "CZ",
      };
    },
  });
  const adapters = createAdapters();
  adapters.CZ.pushResult = true;
  const collector = createCollector({
    tabsApi,
    runtimeApi,
    storage,
    adapters,
    now: () => new Date("2026-11-18T01:00:00.000Z"),
  });

  const run = await collector.startRun("manual");

  assert.equal(run.status, "complete", JSON.stringify(run));
  assert.equal(storage.observations.size, 1);
  assert.equal(listeners.size, 0);
});
