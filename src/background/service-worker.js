import { airlineAdapters } from "../collectors/airline-config.js";
import { createCollector } from "./collector.js";
import {
  createScheduler,
  getTodayCollectionStatus,
  markInterruptedRuns,
} from "./scheduler.js";
import { createStorage } from "../shared/storage.js";

const storage = createStorage(chrome.storage.local);
const collector = createCollector({
  tabsApi: chrome.tabs,
  runtimeApi: chrome.runtime,
  storage,
  adapters: airlineAdapters,
});
const scheduler = createScheduler({
  alarmsApi: chrome.alarms,
  storage,
  onScheduledRun: (planId) =>
    collector.startRun("scheduled", { planIds: [planId] }),
});

async function seedExamplePlan() {
  const plans = await storage.listPlans();
  if (plans.length > 0) {
    return;
  }

  await storage.savePlan({
    id: "example-hgh-cgq",
    name: "杭州 - 长春",
    originName: "杭州萧山",
    originCode: "HGH",
    destinationName: "长春龙嘉",
    destinationCode: "CGQ",
    travelDates: ["2027-02-04", "2027-02-05"],
    airlineCodes: ["CA", "CZ"],
    adultCount: 1,
    cabin: "economy",
    collectionTime: "09:00",
    enabled: true,
  });
}

async function initialize(isInstall = false) {
  if (isInstall) {
    await seedExamplePlan();
  } else {
    await markInterruptedRuns(storage);
  }
  await scheduler.rescheduleAll();
}

chrome.runtime.onInstalled.addListener((details) =>
  initialize(details.reason === "install").catch((error) =>
    console.error("Flight tracker initialization failed", error),
  ),
);

chrome.runtime.onStartup.addListener(() =>
  initialize().catch((error) =>
    console.error("Flight tracker startup failed", error),
  ),
);

chrome.alarms.onAlarm.addListener((alarm) =>
  scheduler.handleAlarm(alarm).catch((error) =>
    console.error("Scheduled collection failed", error),
  ),
);

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATUS": {
      const runs = await storage.listRuns();
      return {
        todayStatus: getTodayCollectionStatus(runs),
        currentRun: await collector.getStatus(),
        lastRun: runs[0] ?? null,
      };
    }
    case "START_MANUAL_RUN":
      return collector.startRun("manual");
    case "GET_PLANS":
      return storage.listPlans();
    case "SAVE_PLAN": {
      const plan = await storage.savePlan(message.plan);
      await scheduler.rescheduleAll();
      return plan;
    }
    case "DELETE_PLAN": {
      await storage.deletePlan(message.planId);
      await scheduler.rescheduleAll();
      return { deleted: true };
    }
    case "GET_OBSERVATIONS":
      return storage.listObservations(message.filters ?? {});
    case "GET_RUNS":
      return storage.listRuns();
    default:
      throw new TypeError("Unsupported extension message");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "COLLECTION_RESULT_PUSH") {
    sendResponse({ received: true });
    return false;
  }
  handleMessage(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        error: error.message,
        code: error.code ?? "REQUEST_FAILED",
      }),
    );
  return true;
});
