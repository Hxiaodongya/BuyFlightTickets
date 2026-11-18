const STATUS_LABELS = {
  "not-collected": "今日尚未采集",
  running: "采集中",
  complete: "今日采集完成",
  partial: "今日采集不完整",
  failed: "今日采集失败",
};

const statusElement = document.querySelector("#today-status");
const timeElement = document.querySelector("#run-time");
const countElement = document.querySelector("#run-counts");
const errorElement = document.querySelector("#error-message");
const collectButton = document.querySelector("#collect-now");

async function sendMessage(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (response?.error) {
    const error = new Error(response.error);
    error.code = response.code;
    throw error;
  }
  return response;
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function renderRun(run) {
  if (!run) {
    timeElement.textContent = "";
    countElement.textContent = "";
    return;
  }
  timeElement.textContent = `最近采集：${formatDate(run.startedAt)}`;
  countElement.textContent = `成功 ${run.successCount ?? 0} 项 · 失败 ${run.failureCount ?? 0} 项`;
}

async function refresh() {
  try {
    const status = await sendMessage("GET_STATUS");
    const active = status.currentRun?.status === "running";
    statusElement.textContent = STATUS_LABELS[active ? "running" : status.todayStatus] ?? "状态未知";
    collectButton.disabled = active;
    collectButton.textContent = active ? "采集中…" : "立即采集";
    renderRun(status.currentRun ?? status.lastRun);
    errorElement.textContent = "";
  } catch (error) {
    errorElement.textContent = error.message;
  }
}

collectButton.addEventListener("click", async () => {
  collectButton.disabled = true;
  collectButton.textContent = "采集中…";
  errorElement.textContent = "";
  try {
    await sendMessage("START_MANUAL_RUN");
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    await refresh();
  }
});

document.querySelector("#open-dashboard").addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/index.html") });
});

void refresh();
setInterval(() => void refresh(), 1500);
