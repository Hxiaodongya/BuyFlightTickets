import assert from "node:assert/strict";
import test from "node:test";
import { createCollector } from "../src/background/collector.js";

const plans = [
  {
    id: "plan-1",
    originCityId: "city-hgh",
    originCityName: "杭州",
    destinationCityId: "city-cgq",
    destinationCityName: "长春",
    travelDates: ["2027-02-04", "2027-02-05"],
    airlineCodes: ["CA", "CZ"],
    enabled: true,
  },
  {
    id: "disabled-plan",
    originCityId: "city-hgh",
    originCityName: "杭州",
    destinationCityId: "city-pek",
    destinationCityName: "北京",
    travelDates: ["2027-02-04"],
    airlineCodes: ["CA"],
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
      return structuredClone([...runs.values()]);
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

function createSessionArea() {
  const values = {};
  return {
    async get(key) {
      return Object.hasOwn(values, key) ? { [key]: structuredClone(values[key]) } : {};
    },
    async set(entries) {
      Object.assign(values, structuredClone(entries));
    },
    async remove(key) {
      delete values[key];
    },
  };
}

function collectionResult(message) {
  return {
    type: "COLLECTION_RESULT",
    requestId: message.requestId,
    airlineCode: message.airlineCode,
    rows: [{
      flightNo: message.airlineCode === "CA" ? "CA123" : "CZ321",
      listedFareCny: 1200,
      cabin: "economy",
      stopCount: 0,
    }],
  };
}

function verificationRequired(message) {
  return {
    type: "COLLECTION_PAUSED",
    requestId: message.requestId,
    airlineCode: message.airlineCode,
    reason: "human-verification",
  };
}

function createTabsApi({ sendMessage } = {}) {
  let nextTabId = 1;
  const created = [];
  const removed = [];
  const activated = [];
  const sentMessages = [];
  const verificationWatches = [];

  return {
    created,
    removed,
    activated,
    sentMessages,
    verificationWatches,
    async create(options) {
      const tab = { id: nextTabId++, status: "complete", ...options };
      created.push(tab);
      return tab;
    },
    async get(tabId) {
      const tab = created.find(({ id }) => id === tabId);
      if (!tab || removed.includes(tabId)) throw new Error(`No tab with ID ${tabId}`);
      return tab;
    },
    async update(tabId, { active }) {
      const tab = await this.get(tabId);
      if (active) activated.push(tabId);
      return tab;
    },
    async sendMessage(tabId, message) {
      if (message.type === "WATCH_VERIFICATION_RESULTS") {
        verificationWatches.push({ tabId, ...structuredClone(message) });
        return { watching: true };
      }
      sentMessages.push(structuredClone(message));
      if (sendMessage) {
        return sendMessage(tabId, message);
      }
      return collectionResult(message);
    },
    async remove(tabId) {
      await this.get(tabId);
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
  assert.deepEqual(
    tabsApi.sentMessages.map(({ searchUrl }) => searchUrl),
    tabsApi.created.map(({ url }) => url),
  );
  assert.deepEqual(tabsApi.removed, [1, 2, 3, 4]);
  assert.equal(storage.observations.size, 4);
  assert.equal(
    tabsApi.sentMessages.every(
      ({ plan }) =>
        plan.adultCount === 1 &&
        plan.cabin === "economy" &&
        plan.originCityName === "杭州" &&
        plan.destinationCityName === "长春",
    ),
    true,
  );
  assert.equal(Object.hasOwn(plans[0], "adultCount"), false);
  assert.equal(Object.hasOwn(plans[0], "cabin"), false);
});

test("pauses for verification and resumes the same tab after the worker restarts", async () => {
  const sessionArea = createSessionArea();
  const storage = createStorage({ plans: [{ ...plans[0], airlineCodes: ["CZ", "CA"] }] });
  const attempts = [];
  let verified = false;
  const tabsApi = createTabsApi({
    async sendMessage(tabId, message) {
      attempts.push({ tabId, searchUrl: message.searchUrl });
      return !verified && message.airlineCode === "CA" ? verificationRequired(message) : collectionResult(message);
    },
  });
  const dependencies = { tabsApi, storage, sessionArea, adapters: createAdapters() };

  const paused = await createCollector(dependencies).startRun();

  assert.equal(paused.status, "paused");
  assert.deepEqual(paused.manualVerification, { taskIndex: 1 });
  assert.deepEqual(paused.tasks.map(({ status }) => status), ["complete", "awaiting-manual", "pending", "pending"]);
  assert.equal(paused.successCount, 1);
  assert.equal(paused.failureCount, 0);
  assert.equal(storage.observations.size, 1);
  assert.deepEqual(tabsApi.activated, [2]);
  assert.deepEqual(tabsApi.removed, [1]);
  assert.equal(attempts.length, 2);

  const restarted = createCollector(dependencies);
  assert.deepEqual(await restarted.getStatus(), paused);
  await assert.rejects(restarted.startRun("scheduled"), { code: "RUN_ALREADY_ACTIVE" });
  await assert.rejects(restarted.restoreWhileIdle(() => assert.fail("restore must not start")), { code: "RUN_ALREADY_ACTIVE" });
  await restarted.openVerificationTab(paused.id, 1);
  assert.deepEqual(tabsApi.activated, [2, 2]);

  const stillPaused = await restarted.resumeRun(paused.id, 1);
  assert.equal(stillPaused.status, "paused");
  assert.equal(stillPaused.failureCount, 0);
  assert.deepEqual(tabsApi.removed, [1]);
  assert.deepEqual(attempts[2], attempts[1]);

  verified = true;
  const completed = await restarted.resumeRun(paused.id, 1);

  assert.equal(completed.id, paused.id);
  assert.equal(completed.status, "complete");
  assert.equal(completed.successCount, 4);
  assert.equal(completed.failureCount, 0);
  assert.equal(Object.hasOwn(completed, "manualVerification"), false);
  assert.equal(storage.observations.size, 4);
  assert.deepEqual(attempts[3], attempts[1]);
  assert.deepEqual(attempts.map(({ tabId }) => tabId), [1, 2, 2, 2, 3, 4]);
  assert.deepEqual(tabsApi.removed, [1, 2, 3, 4]);
});

test("only accepts stable price results reported by the original verification tab and resumes once", async () => {
  const sessionArea = createSessionArea();
  const storage = createStorage();
  const tabsApi = createTabsApi({
    async sendMessage(tabId, message) {
      return tabId === 1 ? verificationRequired(message) : collectionResult(message);
    },
  });
  const dependencies = { tabsApi, storage, sessionArea, adapters: createAdapters() };
  const paused = await createCollector(dependencies).startRun();
  const requestId = `${paused.id}:0`;
  const searchUrl = tabsApi.created[0].url;
  const sender = { tab: { id: 1 }, frameId: 0, url: `${searchUrl}?extra=legitimate` };
  const result = { ...collectionResult({ requestId, airlineCode: "CA" }), type: "VERIFICATION_RESULTS_READY" };
  const collector = createCollector(dependencies);

  assert.deepEqual(tabsApi.verificationWatches, [{
    tabId: 1,
    type: "WATCH_VERIFICATION_RESULTS",
    requestId,
    airlineCode: "CA",
    searchUrl,
  }]);
  assert.deepEqual(await collector.getVerificationWatch(sender), { requestId, airlineCode: "CA", searchUrl });
  assert.equal(await collector.getVerificationWatch({ ...sender, tab: { id: 9 } }), null);
  assert.equal((await collector.resumeFromVerifiedResults(result, { ...sender, tab: { id: 9 } })).accepted, false);
  assert.equal((await collector.resumeFromVerifiedResults(result, { ...sender, frameId: 3 })).accepted, false);
  assert.equal((await collector.resumeFromVerifiedResults({ ...result, requestId: "stale:0" }, sender)).accepted, false);
  assert.equal((await collector.resumeFromVerifiedResults({ ...result, airlineCode: "CZ" }, sender)).accepted, false);
  assert.equal((await collector.resumeFromVerifiedResults(result, { ...sender, url: searchUrl.replace("2027-02-04", "2027-02-05") })).accepted, false);
  assert.equal((await collector.resumeFromVerifiedResults(result, { ...sender, url: searchUrl.replace("airchina", "other") })).accepted, false);
  assert.equal((await collector.resumeFromVerifiedResults({ ...result, rows: [{ flightNo: "CA123", listedFareCny: 0, stopCount: 0 }] }, sender)).accepted, false);
  assert.equal((await collector.resumeFromVerifiedResults({ ...result, rows: result.rows.map((row) => ({ ...row, travelDate: "2027-02-05" })) }, sender)).accepted, false);
  assert.equal((await collector.getStatus()).status, "paused");
  assert.equal(storage.observations.size, 0);

  const [accepted, duplicate] = await Promise.all([
    collector.resumeFromVerifiedResults(result, sender),
    collector.resumeFromVerifiedResults(result, sender),
  ]);
  const completed = await collector.getStatus();
  assert.equal(accepted.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(completed.id, paused.id);
  assert.equal(completed.status, "complete");
  assert.equal(completed.successCount, 4);
  assert.equal(completed.failureCount, 0);
  assert.deepEqual(tabsApi.removed, [1, 2, 3, 4]);
  assert.equal(tabsApi.sentMessages.filter(({ requestId: sentId }) => sentId === requestId).length, 1);
  assert.equal((await collector.resumeFromVerifiedResults(result, sender)).accepted, false);
  assert.equal([...storage.observations.values()].find(({ sourceUrl }) => sourceUrl === sender.url)?.flightNo, "CA123");
});

test("skips only the selected verification task and rejects actions for an older pause", async () => {
  const storage = createStorage({ plans: [{ ...plans[0], airlineCodes: ["CA"] }] });
  const tabsApi = createTabsApi({ sendMessage: (tabId, message) => verificationRequired(message) });
  const collector = createCollector({ tabsApi, storage, sessionArea: createSessionArea(), adapters: createAdapters() });
  const firstPause = await collector.startRun();

  assert.equal(firstPause.status, "paused");
  const secondPause = await collector.skipVerificationTask(firstPause.id, 0);

  assert.equal(secondPause.status, "paused");
  assert.deepEqual(secondPause.manualVerification, { taskIndex: 1 });
  assert.equal(secondPause.failureCount, 1);
  assert.match(secondPause.tasks[0].error, /已跳过/);
  assert.deepEqual(tabsApi.removed, [1]);
  await assert.rejects(collector.skipVerificationTask(firstPause.id, 0), { code: "NO_VERIFICATION_PENDING" });
  assert.deepEqual(tabsApi.removed, [1]);

  const completed = await collector.skipVerificationTask(firstPause.id, 1);
  assert.equal(completed.status, "failed");
  assert.equal(completed.failureCount, 2);
  assert.deepEqual(tabsApi.removed, [1, 2]);
  assert.equal(tabsApi.sentMessages.length, 2);
});

test("does not reopen a closed verification tab and continues the rest of the run", async () => {
  const storage = createStorage({ plans: [{ ...plans[0], travelDates: ["2027-02-04"] }] });
  const tabsApi = createTabsApi({
    sendMessage: (tabId, message) => message.airlineCode === "CA" ? verificationRequired(message) : collectionResult(message),
  });
  const collector = createCollector({ tabsApi, storage, sessionArea: createSessionArea(), adapters: createAdapters() });
  const paused = await collector.startRun();

  assert.equal(paused.status, "paused");
  await tabsApi.remove(1);
  const completed = await collector.resumeRun(paused.id, 0);

  assert.equal(completed.status, "partial");
  assert.match(completed.tasks[0].error, /验证标签页已关闭/);
  assert.equal(completed.tasks[1].status, "complete");
  assert.deepEqual(tabsApi.sentMessages.map(({ airlineCode }) => airlineCode), ["CA", "CZ"]);
  assert.equal(tabsApi.created.length, 2);
});

test("keeps the original tab paused when it is not ready to receive the resume request", async () => {
  const storage = createStorage({ plans: [{ ...plans[0], travelDates: ["2027-02-04"], airlineCodes: ["CA"] }] });
  let page = "verification";
  const tabsApi = createTabsApi({
    async sendMessage(tabId, message) {
      if (page === "redirecting") throw new Error("Receiving end does not exist");
      return page === "verification" ? verificationRequired(message) : collectionResult(message);
    },
  });
  const collector = createCollector({ tabsApi, storage, sessionArea: createSessionArea(), adapters: createAdapters() });
  const paused = await collector.startRun();

  page = "redirecting";
  const stillPaused = await collector.resumeRun(paused.id, 0);

  assert.equal(stillPaused.status, "paused");
  assert.match(stillPaused.manualVerification.message, /返回本次航班列表/);
  assert.equal(stillPaused.failureCount, 0);
  assert.deepEqual(tabsApi.removed, []);
  assert.equal(storage.observations.size, 0);

  page = "results";
  const completed = await collector.resumeRun(paused.id, 0);
  assert.equal(completed.status, "complete");
  assert.equal(tabsApi.created.length, 1);
  assert.deepEqual(tabsApi.removed, [1]);
});

test("cannot resume verification without the original browser session", async () => {
  const storage = createStorage({ plans: [{ ...plans[0], travelDates: ["2027-02-04"], airlineCodes: ["CA"] }] });
  const tabsApi = createTabsApi({ sendMessage: (tabId, message) => verificationRequired(message) });
  const dependencies = { tabsApi, storage, adapters: createAdapters() };
  const paused = await createCollector({ ...dependencies, sessionArea: createSessionArea() }).startRun();

  assert.equal(paused.status, "paused");
  const restarted = createCollector({ ...dependencies, sessionArea: createSessionArea() });
  await assert.rejects(restarted.resumeRun(paused.id, 0), { code: "NO_VERIFICATION_PENDING" });
  assert.equal(tabsApi.sentMessages.length, 1);
});

test("rejects a verification pause that does not match the requested job", async () => {
  const storage = createStorage({ plans: [{ ...plans[0], travelDates: ["2027-02-04"], airlineCodes: ["CA"] }] });
  const tabsApi = createTabsApi({
    sendMessage: (tabId, message) => verificationRequired({ ...message, requestId: "other-run" }),
  });
  const collector = createCollector({ tabsApi, storage, sessionArea: createSessionArea(), adapters: createAdapters() });

  const run = await collector.startRun();

  assert.equal(run.status, "failed");
  assert.deepEqual(tabsApi.removed, [1]);
  assert.deepEqual(tabsApi.activated, []);
});

test("preserves result diagnostics on successful and failed collection tasks", async () => {
  const diagnostics = {
    candidateCount: 7,
    visibleCardCount: 7,
    flightNumberCardCount: 7,
    economyFareCardCount: 2,
    parsedRowCount: 2,
  };
  const storage = createStorage({
    plans: [{ ...plans[0], travelDates: ["2027-02-04"], airlineCodes: ["CZ"] }],
  });
  const tabsApi = createTabsApi({
    sendMessage: async (tabId, message) => ({
      type: "COLLECTION_RESULT",
      requestId: message.requestId,
      airlineCode: message.airlineCode,
      rows: [{ flightNo: "CZ321", listedFareCny: 1200, stopCount: 0 }],
      diagnostics,
    }),
  });
  const collector = createCollector({
    tabsApi,
    storage,
    adapters: createAdapters(),
    now: () => new Date("2026-11-18T01:00:00.000Z"),
  });

  const run = await collector.startRun("manual");

  assert.equal(run.tasks[0].status, "complete");
  assert.deepEqual(run.tasks[0].diagnostics, diagnostics);
});

test("preserves result diagnostics when an airline page reports an error", async () => {
  const diagnostics = {
    visibleNoticeLabels: ["我知道了"],
    noticeClickCount: 1,
  };
  const storage = createStorage({
    plans: [{ ...plans[0], travelDates: ["2027-02-04"], airlineCodes: ["CA"] }],
  });
  const tabsApi = createTabsApi({
    sendMessage: async (tabId, message) => ({
      type: "COLLECTION_RESULT",
      requestId: message.requestId,
      airlineCode: message.airlineCode,
      rows: [],
      diagnostics,
      error: "国航官网提示未关闭，未保存价格",
    }),
  });
  const collector = createCollector({
    tabsApi,
    storage,
    adapters: createAdapters(),
    now: () => new Date("2026-11-18T01:00:00.000Z"),
  });

  const run = await collector.startRun("manual");

  assert.equal(run.tasks[0].status, "failed");
  assert.deepEqual(run.tasks[0].diagnostics, diagnostics);
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
  try {
    await assert.rejects(collector.startRun("manual"), { code: "RUN_ALREADY_ACTIVE" });
    await assert.rejects(collector.restoreWhileIdle(() => assert.fail("restore must not start")), { code: "RUN_ALREADY_ACTIVE" });
  } finally {
    releaseMessage();
  }
  const result = await firstRun;

  assert.equal(result.status, "complete");
});

test("data restore excludes new collection and invalidates the cached status", async () => {
  const storage = createStorage({ plans: [] });
  const collector = createCollector({ tabsApi: createTabsApi(), storage, adapters: createAdapters() });
  await collector.startRun();
  const entered = Promise.withResolvers();
  const releaseRestore = Promise.withResolvers();
  const restore = collector.restoreWhileIdle(async () => {
    entered.resolve();
    await releaseRestore.promise;
    storage.runs.clear();
    return { runs: 0 };
  });
  await entered.promise;
  try {
    await assert.rejects(collector.startRun("scheduled"), { code: "RUN_ALREADY_ACTIVE" });
  } finally {
    releaseRestore.resolve();
  }
  assert.deepEqual(await restore, { runs: 0 });
  assert.equal(await collector.getStatus(), null);
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
