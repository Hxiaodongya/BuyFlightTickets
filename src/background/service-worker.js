import { airlineAdapters } from "../collectors/airline-config.js";
import { createCollector, openLoongAirQuoteSearch } from "./collector.js";
import {
  createScheduler,
  getTodayCollectionStatus,
  markInterruptedRuns,
} from "./scheduler.js";
import { createStorage } from "../shared/storage.js";

const dashboardUrl = chrome.runtime.getURL("src/dashboard/index.html");
const storage = createStorage(chrome.storage.local);
const collector = createCollector({
  tabsApi: chrome.tabs,
  windowsApi: chrome.windows,
  runtimeApi: chrome.runtime,
  storage,
  sessionArea: chrome.storage.session,
  adapters: airlineAdapters,
});
const scheduler = createScheduler({
  alarmsApi: chrome.alarms,
  storage,
  onScheduledRun: (planId) =>
    collector.startRun("scheduled", { planIds: [planId] }),
});

let readiness = collector.getResumableRunId()
  .then((runId) => markInterruptedRuns(storage, new Date(), runId))
  .catch((error) => console.error("Flight tracker recovery failed", error));

function initialize() {
  readiness = readiness
    .then(() => scheduler.rescheduleAll())
    .catch((error) => console.error("Flight tracker initialization failed", error));
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);
chrome.action.onClicked.addListener(() =>
  chrome.tabs.create({ url: dashboardUrl }).catch((error) => {
    console.error("Flight tracker could not open the dashboard", error);
  }),
);

chrome.alarms.onAlarm.addListener((alarm) =>
  readiness.then(() => scheduler.handleAlarm(alarm)).catch((error) => {
    if (error.code !== "RUN_ALREADY_ACTIVE") console.error("Scheduled collection failed", error);
  }),
);

async function handleMessage(message, sender) {
  await readiness;
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
    case "OPEN_VERIFICATION_TAB":
      return collector.openVerificationTab(message.runId, message.taskIndex);
    case "RESUME_COLLECTION_RUN":
      return collector.resumeRun(message.runId, message.taskIndex);
    case "SKIP_VERIFICATION_TASK":
      return collector.skipVerificationTask(message.runId, message.taskIndex);
    case "GET_VERIFICATION_WATCH":
      return collector.getVerificationWatch(sender);
    case "VERIFICATION_RESULTS_READY":
      return collector.resumeFromVerifiedResults(message, sender);
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
    case "EXPORT_BACKUP":
    case "RESTORE_BACKUP": {
      if (sender?.url !== dashboardUrl) {
        throw new Error("请在扩展的航班价格看板中管理备份");
      }
      if (message.type === "EXPORT_BACKUP") return storage.exportBackup();

      return collector.restoreWhileIdle(async () => {
        const counts = await storage.restoreBackup(message.backup, message.strategy);
        try {
          await scheduler.rescheduleAll();
        } catch (error) {
          console.error("Flight tracker could not reschedule restored plans", error);
          return { counts, warning: "数据已恢复，部分采集计划的定时任务未更新。" };
        }
        return { counts };
      });
    }
    case "OPEN_LOONG_AIR_QUOTE":
      if (sender?.url !== dashboardUrl) {
        throw new Error("请从扩展的航班报价页打开查询");
      }
      return openLoongAirQuoteSearch(chrome.tabs, message.quote);
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
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        error: error.message,
        code: error.code ?? "REQUEST_FAILED",
      }),
    );
  return true;
});
