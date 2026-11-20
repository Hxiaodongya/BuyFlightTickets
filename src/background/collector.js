import { buildQuoteSearchUrl } from "../collectors/airline-config.js";
import { normalizeObservations } from "../shared/domain.js";

const VERIFICATION_KEY = "pausedCollection";

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

async function sendLoongAirMessage(tabsApi, tabId, request) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await tabsApi.sendMessage(tabId, request, { frameId: 0 });
    } catch (error) {
      if (attempt === 4 || !error.message?.includes("Receiving end does not exist")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export async function openLoongAirQuoteSearch(tabsApi, quote, timeoutMs = 45_000) {
  const searchUrl = quote?.airlineCode === "GJ" ? buildQuoteSearchUrl(quote) : null;
  if (!searchUrl) throw new Error("长龙航空报价缺少可查询的航线或出行日期");

  const tab = await tabsApi.create({ url: searchUrl, active: true });
  if (tab?.id == null) throw new Error("无法打开长龙航空查询标签页");
  await waitForTabComplete(tabsApi, tab, timeoutMs);
  const response = await withTimeout(
    sendLoongAirMessage(tabsApi, tab.id, { type: "OPEN_LOONG_AIR_QUOTE", searchUrl }),
    timeoutMs,
    "Loong Air quote search",
  );
  if (!response?.submitted && response?.pauseReason !== "human-verification") {
    throw new Error(response?.error || "长龙航空没有确认查询，请检查已打开的官网标签页");
  }
  return response;
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

function collectionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function matchesSearchUrl(actualUrl, searchUrl) {
  try {
    const actual = new URL(actualUrl);
    const expected = new URL(searchUrl);
    return actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      [...expected.searchParams].every(([name, value]) => actual.searchParams.get(name) === value);
  } catch {
    return false;
  }
}

export function createCollector({
  tabsApi,
  windowsApi,
  runtimeApi,
  storage,
  sessionArea,
  adapters,
  timeoutMs = 45_000,
  now = () => new Date(),
}) {
  if (!tabsApi || !storage || !adapters) {
    throw new TypeError("Tabs, storage, and airline adapters are required");
  }

  let activeRun = null;
  let lastRun = null;
  let actionInProgress = false;

  function currentTimestamp() {
    return new Date(now()).toISOString();
  }

  async function withRunLock(action) {
    if (actionInProgress) {
      throw collectionError("已有采集操作正在进行", "RUN_ALREADY_ACTIVE");
    }

    actionInProgress = true;
    try {
      return await action();
    } finally {
      actionInProgress = false;
    }
  }

  async function openTab(tabId) {
    const tab = await tabsApi.update(tabId, { active: true });
    if (Number.isInteger(tab?.windowId)) {
      await windowsApi?.update(tab.windowId, { focused: true });
    }
  }

  async function closeTab(tabId) {
    if (tabId != null) await tabsApi.remove(tabId).catch(() => {});
  }

  async function findPausedRun() {
    const checkpoint = (await sessionArea?.get(VERIFICATION_KEY))?.[VERIFICATION_KEY];
    if (!checkpoint) return null;

    const run = (await storage.listRuns()).find(({ id }) => id === checkpoint.runId);
    if (
      run?.status !== "paused" ||
      run.manualVerification?.taskIndex !== checkpoint.taskIndex ||
      run.tasks?.[checkpoint.taskIndex]?.status !== "awaiting-manual"
    ) {
      return null;
    }
    return { run, checkpoint };
  }

  function getRetainedTab(tabId) {
    return tabsApi.get(tabId).catch(() => {
      throw new Error("验证标签页已关闭，本项未保存价格");
    });
  }

  async function pauseForVerification(run, task, tabId, plans, request, message) {
    if (!sessionArea) throw new Error("无法在当前 Chrome 会话中保存待验证任务");

    const taskIndex = run.tasks.indexOf(task);
    const pausedRun = {
      ...run,
      status: "paused",
      updatedAt: currentTimestamp(),
      manualVerification: message ? { taskIndex, message } : { taskIndex },
      tasks: run.tasks.map((entry) => entry === task ? { ...task, status: "awaiting-manual" } : entry),
    };
    const { requestId, airlineCode, searchUrl } = request;
    const watch = { requestId, airlineCode, searchUrl };
    await sessionArea.set({ [VERIFICATION_KEY]: { runId: run.id, taskIndex, tabId, plans, watch } });
    try {
      await storage.saveRun(pausedRun);
    } catch (error) {
      await sessionArea.remove(VERIFICATION_KEY).catch(() => {});
      throw error;
    }
    Object.assign(run, pausedRun);
    await openTab(tabId).catch(() => {});
    void tabsApi.sendMessage(tabId, { type: "WATCH_VERIFICATION_RESULTS", ...watch }, { frameId: 0 }).catch(() => {});
  }

  async function requestResult(tabId, request, adapter) {
    const resultWaiter = adapter.pushResult
      ? createRuntimeResultWaiter(runtimeApi, request.requestId, request.airlineCode, timeoutMs)
      : null;
    try {
      const response = await withTimeout(
        request.airlineCode === "GJ"
          ? sendLoongAirMessage(tabsApi, tabId, request)
          : tabsApi.sendMessage(tabId, request),
        timeoutMs,
        "Airline response",
      );
      if (response?.type === "COLLECTION_PENDING") {
        if (!resultWaiter) {
          throw new Error("The airline page continued without a result channel");
        }
        return await resultWaiter.promise;
      }
      return response;
    } finally {
      resultWaiter?.cancel();
    }
  }

  async function storeCollectedObservations(task, observations) {
    if (observations.length === 0) {
      throw new Error("No valid listed fares were found on the result page");
    }
    await storage.saveObservations(observations);
    task.observationCount = observations.length;
  }

  async function collectJob(run, task, plans, retainedTabId, verifiedResult) {
    let tabId = retainedTabId;
    let keepTab = false;
    try {
      const plan = plans.find(({ id }) => id === task.planId);
      if (!plan) throw new Error("查询计划已删除，本项未采集");
      if (verifiedResult) {
        if (verifiedResult.diagnostics) task.diagnostics = verifiedResult.diagnostics;
        await storeCollectedObservations(task, verifiedResult.observations);
        return;
      }

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
      const searchUrl = adapter.buildSearchUrl({ plan: travelPlan, travelDate: task.travelDate });
      if (typeof searchUrl !== "string" || !searchUrl.startsWith("https://")) {
        throw new Error("Airline adapter returned an invalid HTTPS URL");
      }

      const tab = tabId == null
        ? await tabsApi.create({ url: searchUrl, active: false })
        : await getRetainedTab(tabId);
      tabId = tab?.id;
      if (tabId == null) {
        throw new Error("Chrome did not create an airline tab");
      }
      const requestId = `${run.id}:${run.tasks.indexOf(task)}`;
      const request = {
        type: "GET_COLLECTION_REQUEST",
        requestId,
        airlineCode: task.airlineCode,
        plan: travelPlan,
        travelDate: task.travelDate,
        searchUrl,
        trigger: run.trigger,
      };
      let response;
      try {
        await waitForTabComplete(tabsApi, tab, timeoutMs);
        response = await requestResult(tabId, request, adapter);
      } catch (error) {
        if (retainedTabId == null) throw error;
        await getRetainedTab(tabId);
        await pauseForVerification(run, task, tabId, plans, request, "暂时无法读取原标签页，请确认已返回本次航班列表。");
        keepTab = true;
        return;
      }
      const needsVerification = response?.type === "COLLECTION_PAUSED" && response.reason === "human-verification";
      if (
        (!needsVerification && response?.type !== "COLLECTION_RESULT") ||
        response.requestId !== requestId ||
        response.airlineCode !== task.airlineCode
      ) {
        throw new Error("Airline page returned an invalid collection response");
      }

      if (needsVerification) {
        await pauseForVerification(run, task, tabId, plans, request);
        keepTab = true;
        return;
      }
      if (response.diagnostics) {
        task.diagnostics = response.diagnostics;
      }
      if (response.error) throw new Error(response.error);

      const observations = normalizeObservations(
        travelPlan,
        task.airlineCode,
        response.rows,
        currentTimestamp(),
        run.trigger,
      );
      await storeCollectedObservations(task, observations);
    } finally {
      if (!keepTab) await closeTab(tabId);
    }
  }

  async function executeRun(run, checkpoint, { skipPausedTask = false, verifiedResult } = {}) {
    const savedPlans = await storage.listPlans();
    const plans = checkpoint
      ? checkpoint.plans.filter(({ id }) => savedPlans.some((plan) => plan.id === id))
      : savedPlans.filter((plan) => plan.enabled && (!run.planIds || run.planIds.includes(plan.id)));
    if (!checkpoint) {
      run.tasks = plans.flatMap((plan) =>
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
      await storage.saveRun(run);
    }

    for (const [taskIndex, task] of run.tasks.entries()) {
      const isPausedTask = checkpoint?.taskIndex === taskIndex;
      if (!isPausedTask && task.status !== "pending") continue;

      run.status = "running";
      delete run.manualVerification;
      task.status = "running";
      task.startedAt ??= currentTimestamp();
      run.updatedAt = currentTimestamp();
      await storage.saveRun(run);

      try {
        const retainedTabId = isPausedTask ? checkpoint.tabId : undefined;
        if (isPausedTask && skipPausedTask) {
          await closeTab(retainedTabId);
          throw new Error("已跳过需要人工验证的任务，未保存价格");
        }
        await collectJob(run, task, plans, retainedTabId, isPausedTask ? verifiedResult : undefined);
        if (run.status === "paused") return;

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
  }

  async function runAndRecord(run, checkpoint, verificationAction) {
    activeRun = run;
    try {
      await executeRun(run, checkpoint, verificationAction);
      lastRun = structuredClone(run);
      return structuredClone(lastRun);
    } catch (error) {
      if (checkpoint) await closeTab(checkpoint.tabId);
      delete run.manualVerification;
      run.status = "failed";
      run.error = asErrorMessage(error);
      run.endedAt = currentTimestamp();
      run.updatedAt = run.endedAt;
      try {
        await storage.saveRun(run);
      } catch {}
      lastRun = structuredClone(run);
      throw error;
    } finally {
      activeRun = null;
      if (checkpoint && run.status !== "paused") {
        await sessionArea.remove(VERIFICATION_KEY).catch(() => {});
      }
    }
  }

  function actOnVerification(runId, taskIndex, action) {
    return withRunLock(async () => {
      const paused = await findPausedRun();
      if (!paused || paused.run.id !== runId || paused.checkpoint.taskIndex !== taskIndex) {
        throw collectionError("这项采集已不在等待人工验证，请刷新采集状态", "NO_VERIFICATION_PENDING");
      }
      if (action === "open") {
        try {
          await openTab(paused.checkpoint.tabId);
          return { opened: true };
        } catch {
          throw new Error("无法打开原验证标签页。若已关闭，请跳过本项");
        }
      }
      return runAndRecord(paused.run, paused.checkpoint, { skipPausedTask: action === "skip" });
    });
  }

  async function findVerificationForSender(sender) {
    if (sender?.frameId !== 0 || !Number.isInteger(sender?.tab?.id)) return null;
    const paused = await findPausedRun();
    return paused?.checkpoint.tabId === sender.tab.id ? paused : null;
  }

  async function resumeFromVerifiedResults(message, sender) {
    if (actionInProgress) return { accepted: false, retry: true };

    return withRunLock(async () => {
      const paused = await findVerificationForSender(sender);
      const watch = paused?.checkpoint.watch;
      if (!watch || message.requestId !== watch.requestId || message.airlineCode !== watch.airlineCode) {
        return { accepted: false };
      }
      if (!matchesSearchUrl(sender.url, watch.searchUrl) || !Array.isArray(message.rows)) {
        return { accepted: false, retry: true };
      }

      const { run, checkpoint } = paused;
      const task = run.tasks[checkpoint.taskIndex];
      const plan = checkpoint.plans.find(({ id }) => id === task.planId);
      if (!plan) return { accepted: false };
      const rows = message.rows.filter((row) => row && typeof row === "object")
        .map((row) => ({ ...row, sourceUrl: sender.url }));
      const observations = normalizeObservations(
        { ...plan, travelDates: [task.travelDate] },
        task.airlineCode,
        rows,
        currentTimestamp(),
        run.trigger,
      );
      if (!observations.length) return { accepted: false, retry: true };

      await runAndRecord(run, checkpoint, { verifiedResult: { observations, diagnostics: message.diagnostics } });
      return { accepted: true };
    });
  }

  return {
    restoreWhileIdle(restore) {
      return withRunLock(async () => {
        if (await findPausedRun()) {
          throw collectionError("请先完成或跳过待验证任务，再恢复备份", "RUN_ALREADY_ACTIVE");
        }

        const result = await restore();
        lastRun = null;
        return result;
      });
    },

    startRun(trigger = "manual", options = {}) {
      return withRunLock(async () => {
        if (trigger !== "manual" && trigger !== "scheduled") {
          throw new TypeError("Trigger must be manual or scheduled");
        }
        if (await findPausedRun()) {
          throw collectionError("有任务正在等待人工验证，请继续采集或跳过本项", "RUN_ALREADY_ACTIVE");
        }

        const startedAt = currentTimestamp();
        return runAndRecord({
          id: createId(),
          trigger,
          planIds: options.planIds ? [...options.planIds] : null,
          startedAt,
          updatedAt: startedAt,
          status: "running",
          successCount: 0,
          failureCount: 0,
          tasks: [],
        });
      });
    },

    openVerificationTab: (runId, taskIndex) => actOnVerification(runId, taskIndex, "open"),
    resumeRun: (runId, taskIndex) => actOnVerification(runId, taskIndex, "resume"),
    skipVerificationTask: (runId, taskIndex) => actOnVerification(runId, taskIndex, "skip"),
    resumeFromVerifiedResults,

    async getVerificationWatch(sender) {
      return (await findVerificationForSender(sender))?.checkpoint.watch ?? null;
    },

    async getResumableRunId() {
      return (await findPausedRun())?.run.id ?? null;
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
