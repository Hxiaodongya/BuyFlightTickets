import { normalizeObservations } from "../shared/domain.js";

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function waitForTabComplete(tabsApi, tab, timeoutMs) {
  if (tab.status === "complete") {
    return Promise.resolve(tab);
  }
  if (!tabsApi.onUpdated) {
    return Promise.reject(new Error("Tab update events are unavailable"));
  }

  let listener;
  const loaded = new Promise((resolve, reject) => {
    listener = (tabId, changeInfo, updatedTab) => {
      if (tabId !== tab.id) {
        return;
      }
      if (changeInfo.status === "complete") {
        resolve(updatedTab);
      } else if (changeInfo.status === "error") {
        reject(new Error("Airline page failed to load"));
      }
    };
    tabsApi.onUpdated.addListener(listener);
  });

  return withTimeout(
    loaded,
    timeoutMs,
    "Airline page load",
  ).finally(() => {
    if (listener && tabsApi.onUpdated?.removeListener) {
      tabsApi.onUpdated.removeListener(listener);
    }
  });
}

function createRuntimeResultWaiter(runtimeApi, requestId, airlineCode, timeoutMs) {
  if (!runtimeApi?.onMessage) {
    return null;
  }

  let listener;
  let timer;
  let settled = false;
  let resolvePromise;
  let rejectPromise;
  const cleanup = () => {
    clearTimeout(timer);
    if (listener) {
      runtimeApi.onMessage.removeListener(listener);
    }
  };
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    listener = (message) => {
      if (
        message?.type !== "COLLECTION_RESULT_PUSH" ||
        message.requestId !== requestId
      ) {
        return;
      }
      if (message.airlineCode !== airlineCode) {
        settled = true;
        cleanup();
        rejectPromise(new Error("Pushed result airline does not match the request"));
        return;
      }
      settled = true;
      cleanup();
      resolvePromise({ ...message, type: "COLLECTION_RESULT" });
    };
    runtimeApi.onMessage.addListener(listener);
    timer = setTimeout(() => {
      settled = true;
      cleanup();
      rejectPromise(new Error("Airline result timed out"));
    }, timeoutMs);
  });

  return {
    promise,
    cancel() {
      if (!settled) {
        settled = true;
        cleanup();
        resolvePromise(null);
      }
    },
  };
}

function makeRunActiveError() {
  const error = new Error("A collection run is already active");
  error.code = "RUN_ALREADY_ACTIVE";
  return error;
}

export function createCollector({
  tabsApi,
  runtimeApi,
  storage,
  adapters,
  timeoutMs = 45_000,
  now = () => new Date(),
}) {
  if (!tabsApi || !storage || !adapters) {
    throw new TypeError("Tabs, storage, and airline adapters are required");
  }

  let activeRun = null;
  let lastRun = null;

  function currentTimestamp() {
    return new Date(now()).toISOString();
  }

  async function collectJob(run, task, plan) {
    const adapter = adapters[task.airlineCode];
    if (!adapter?.buildSearchUrl) {
      throw new Error(`No collector is available for ${task.airlineCode}`);
    }

    const travelPlan = {
      ...plan,
      travelDates: [task.travelDate],
      adultCount: 1,
      cabin: "economy",
    };
    const url = adapter.buildSearchUrl({ plan: travelPlan, travelDate: task.travelDate });
    if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new Error("Airline adapter returned an invalid HTTPS URL");
    }

    let tab;
    try {
      tab = await tabsApi.create({ url, active: false });
      if (!tab?.id) {
        throw new Error("Chrome did not create an airline tab");
      }
      await waitForTabComplete(tabsApi, tab, timeoutMs);

      const requestId = `${run.id}:${run.tasks.indexOf(task)}`;
      const resultWaiter = adapter.pushResult
        ? createRuntimeResultWaiter(runtimeApi, requestId, task.airlineCode, timeoutMs)
        : null;
      let response;
      try {
        response = await withTimeout(
        tabsApi.sendMessage(tab.id, {
          type: "GET_COLLECTION_REQUEST",
          requestId,
          airlineCode: task.airlineCode,
          plan: travelPlan,
          travelDate: task.travelDate,
          trigger: run.trigger,
        }),
        timeoutMs,
        "Airline response",
        );
      } catch (error) {
        resultWaiter?.cancel();
        throw error;
      }

      if (response?.type === "COLLECTION_PENDING") {
        if (!resultWaiter) {
          throw new Error("The airline page continued without a result channel");
        }
        response = await resultWaiter.promise;
      } else {
        resultWaiter?.cancel();
      }

      if (response?.error) {
        throw new Error(response.error);
      }
      if (
        response?.type !== "COLLECTION_RESULT" ||
        response.requestId !== requestId ||
        response.airlineCode !== task.airlineCode
      ) {
        throw new Error("Airline page returned an invalid collection response");
      }

      const observations = normalizeObservations(
        travelPlan,
        task.airlineCode,
        response.rows,
        currentTimestamp(),
        run.trigger,
      );
      if (observations.length === 0) {
        throw new Error("No valid listed fares were found on the result page");
      }

      await storage.saveObservations(observations);
      task.observationCount = observations.length;
    } finally {
      if (tab?.id) {
        try {
          await tabsApi.remove(tab.id);
        } catch {
          // A closed tab needs no additional cleanup.
        }
      }
    }
  }

  async function executeRun(run, options) {
    await storage.saveRun(run);
    const allowedPlanIds = options.planIds ? new Set(options.planIds) : null;
    const plans = (await storage.listPlans()).filter(
      (plan) => plan.enabled && (!allowedPlanIds || allowedPlanIds.has(plan.id)),
    );
    const tasks = plans.flatMap((plan) =>
      plan.travelDates.flatMap((travelDate) =>
        plan.airlineCodes.map((airlineCode) => ({
          planId: plan.id,
          travelDate,
          airlineCode,
          status: "pending",
          observationCount: 0,
        })),
      ),
    );

    for (const task of tasks) {
      run.tasks.push(task);
      task.status = "running";
      task.startedAt = currentTimestamp();
      await storage.saveRun(run);

      const plan = plans.find((candidate) => candidate.id === task.planId);
      try {
        await collectJob(run, task, plan);
        task.status = "complete";
        run.successCount += 1;
      } catch (error) {
        task.status = "failed";
        task.error = asErrorMessage(error);
        run.failureCount += 1;
      }

      task.endedAt = currentTimestamp();
      run.updatedAt = task.endedAt;
      await storage.saveRun(run);
    }

    run.endedAt = currentTimestamp();
    run.updatedAt = run.endedAt;
    run.status =
      run.failureCount === 0
        ? "complete"
        : run.successCount > 0
          ? "partial"
          : "failed";
    await storage.saveRun(run);
    return run;
  }

  return {
    async startRun(trigger = "manual", options = {}) {
      if (activeRun) {
        throw makeRunActiveError();
      }
      if (trigger !== "manual" && trigger !== "scheduled") {
        throw new TypeError("Trigger must be manual or scheduled");
      }

      const startedAt = currentTimestamp();
      const run = {
        id: createId(),
        trigger,
        planIds: options.planIds ? [...options.planIds] : null,
        startedAt,
        updatedAt: startedAt,
        status: "running",
        successCount: 0,
        failureCount: 0,
        tasks: [],
      };
      activeRun = run;

      try {
        const result = await executeRun(run, options);
        lastRun = structuredClone(result);
        return structuredClone(result);
      } catch (error) {
        run.status = "failed";
        run.error = asErrorMessage(error);
        run.endedAt = currentTimestamp();
        try {
          await storage.saveRun(run);
        } catch {
          // Preserve the in-memory error when storage itself is unavailable.
        }
        lastRun = structuredClone(run);
        throw error;
      } finally {
        activeRun = null;
      }
    },

    async getStatus() {
      if (activeRun) {
        return structuredClone(activeRun);
      }
      if (lastRun) {
        return structuredClone(lastRun);
      }
      return (await storage.listRuns())[0] ?? null;
    },
  };
}
