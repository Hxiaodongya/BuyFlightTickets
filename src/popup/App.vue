<template>
  <div class="popup-shell">
    <header class="popup-header">
      <h1>航班价格追踪</h1>
      <el-button link type="primary" @click="openDashboard">价格历史</el-button>
    </header>

    <main>
      <p class="fare-note">列表价（未含税费）</p>
      <div class="status-row">
        <span class="status-dot" :class="`status-dot--${statusType}`" />
        <strong role="status" aria-live="polite">{{ statusLabel }}</strong>
      </div>
      <p class="run-time">{{ runTime }}</p>
      <p class="run-counts">{{ runCounts }}</p>
      <el-button
        type="primary"
        class="collect-button"
        :loading="collecting || isRunning"
        :disabled="collecting || isRunning"
        @click="collectNow"
      >
        {{ isRunning ? "采集中" : "立即采集" }}
      </el-button>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" />
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";

const STATUS_LABELS = {
  "not-collected": "今日尚未采集",
  running: "采集中",
  complete: "今日采集完成",
  partial: "今日采集不完整",
  failed: "今日采集失败",
};

const todayStatus = ref("not-collected");
const currentRun = ref(null);
const lastRun = ref(null);
const collecting = ref(false);
const errorMessage = ref("");
let statusTimer;

const isRunning = computed(() => currentRun.value?.status === "running");
const statusLabel = computed(() =>
  STATUS_LABELS[isRunning.value ? "running" : todayStatus.value] ?? "状态未知",
);
const statusType = computed(() => {
  if (isRunning.value || todayStatus.value === "partial") {
    return "warning";
  }
  if (todayStatus.value === "complete") {
    return "success";
  }
  if (todayStatus.value === "failed") {
    return "danger";
  }
  return "info";
});
const runTime = computed(() => {
  const run = currentRun.value ?? lastRun.value;
  return run?.startedAt
    ? `最近采集：${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.startedAt))}`
    : "尚无采集记录";
});
const runCounts = computed(() => {
  const run = currentRun.value ?? lastRun.value;
  return run
    ? `成功 ${run.successCount ?? 0} 项 · 失败 ${run.failureCount ?? 0} 项`
    : "";
});

async function request(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (response?.error) {
    throw new Error(response.error);
  }
  return response;
}

async function refresh() {
  try {
    const status = await request("GET_STATUS");
    todayStatus.value = status.todayStatus;
    currentRun.value = status.currentRun;
    lastRun.value = status.lastRun;
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function collectNow() {
  collecting.value = true;
  errorMessage.value = "";
  try {
    await request("START_MANUAL_RUN");
    await refresh();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    collecting.value = false;
  }
}

function openDashboard() {
  void chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/index.html") });
}

onMounted(() => {
  void refresh();
  statusTimer = setInterval(() => void refresh(), 1500);
});

onUnmounted(() => clearInterval(statusTimer));
</script>
