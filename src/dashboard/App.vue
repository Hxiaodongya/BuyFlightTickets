<template>
  <div class="dashboard-shell">
    <header class="topbar">
      <div class="topbar-inner dashboard-width">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.8 3.2c1.2 1.2.7 3.1-.5 4.3l-4.1 4.1 1.1 6.1-2 2-2.8-4.5-3.2 3.2-.5 2.5-1.3 1.3-1.3-3.6-3.6-1.3 1.3-1.3 2.5-.5 3.2-3.2L5.1 9.5l2-2 6.1 1.1 4.1-4.1c1.2-1.2 3.1-2.5 3.5-1.3Z" />
            </svg>
          </span>
          <h1>航班价格追踪</h1>
        </div>
        <div class="route-bar">
          <nav v-if="plans.length" class="route-switcher" aria-label="切换查询路线">
            <button type="button" class="route-tab" :aria-pressed="!activePlanId" @click="activePlanId = ''">全部路线</button>
            <button
              v-for="plan in plans"
              :key="plan.id"
              type="button"
              class="route-tab"
              :aria-pressed="activePlanId === plan.id"
              :title="getRouteLabel(plan)"
              @click="activePlanId = plan.id"
            >{{ getRouteLabel(plan) }}<span v-if="!plan.enabled" class="route-tab-status">已停用</span></button>
          </nav>
          <el-dropdown v-if="managedPlan" trigger="click" placement="bottom-end" @command="managePlan">
            <button type="button" class="route-more" :aria-label="`管理计划：${getRouteLabel(managedPlan)}`">···</button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑计划</el-dropdown-item>
                <el-dropdown-item command="toggle" :disabled="Boolean(managedPlan.migrationStatus)">
                  {{ managedPlan.enabled ? "停用计划" : "启用计划" }}
                </el-dropdown-item>
                <el-dropdown-item command="delete" divided class="delete-plan-option">删除计划</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button type="default" class="new-plan-button" @click="openNewPlan"><span aria-hidden="true">＋</span> 新建计划</el-button>
        </div>
        <div class="top-actions">
          <button
            type="button"
            class="collection-status"
            :data-status="statusCode"
            aria-haspopup="dialog"
            :aria-label="`${statusLabel}，查看采集记录`"
            @click="runsVisible = true"
          >
            <span class="status-dot" aria-hidden="true"></span><span role="status">{{ statusLabel }}</span><span class="status-chevron" aria-hidden="true">›</span>
          </button>
          <el-button
            v-if="!isPaused"
            type="primary"
            :loading="collecting"
            :disabled="isRunning || !hasEnabledPlans"
            title="立即采集所有已启用计划"
            @click="collectNow"
          >{{ isRunning ? "采集中" : "立即采集" }}</el-button>
          <el-dropdown
            trigger="click"
            placement="bottom-end"
            popper-class="backup-menu"
            :show-arrow="false"
            @command="manageBackup"
          >
            <button type="button" class="data-ghost-button" aria-label="数据管理" title="数据管理">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.65" /><circle cx="12" cy="12" r="1.65" /><circle cx="19" cy="12" r="1.65" />
              </svg>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="export" :disabled="exportingBackup">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" />
                  </svg>
                  <span><strong>导出备份数据 (.json)</strong><small>保存所有计划、历史报价和采集记录</small></span>
                </el-dropdown-item>
                <el-dropdown-item command="restore">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" />
                  </svg>
                  <span><strong>导入恢复数据 (.json)</strong><small>合并或覆盖本地记录</small></span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <main class="dashboard-main dashboard-width">
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        show-icon
        :closable="true"
        @close="errorMessage = ''"
      />
      <VerificationPanel
        v-if="isPaused"
        :key="`${currentRun.id}:${currentRun.manualVerification.taskIndex}`"
        :run="currentRun"
        @change="refreshStatus"
      />

      <el-alert
        v-if="managedPlan?.migrationStatus"
        title="这条计划需要重新选择城市后才能启用。"
        type="warning"
        :closable="false"
        show-icon
      />
      <PriceHistory :plans="plans" :plan-id="activePlanId" :observations="observations" :runs="runs" :schedule="collectionSchedule" />
    </main>

    <el-drawer v-model="runsVisible" title="采集记录" size="min(480px, 100%)" append-to-body class="runs-drawer">
      <p v-if="runs.length" class="drawer-caption">最近 {{ Math.min(runs.length, 20) }} 次采集</p>
      <el-empty v-if="!runs.length" description="暂无采集记录" />
      <ul v-else class="dashboard-list run-list">
        <li v-for="run in runs.slice(0, 20)" :key="run.id" class="dashboard-list-item">
          <div class="dashboard-list-heading">
            <strong><time :datetime="run.startedAt">{{ formatDate(run.startedAt) }}</time></strong>
            <el-tag :type="runStatusType(run.status)" effect="plain" size="small">
              {{ runStatusLabel(run.status) }}
            </el-tag>
          </div>
          <p class="run-metadata">
            {{ run.trigger === "manual" ? "手动" : "计划任务" }} · 成功 {{ run.successCount ?? 0 }} / 失败 {{ run.failureCount ?? 0 }}
          </p>
          <details v-if="run.error || run.tasks?.length" class="run-details">
            <summary>查看明细</summary>
            <ul>
              <li v-if="run.error" class="run-error">{{ run.error }}</li>
              <li v-for="(task, index) in run.tasks ?? []" :key="index" :class="{ 'run-error': task.error }">
                {{ taskDescription(task) }}<span v-if="task.error">：{{ task.error }}</span><span v-if="task.diagnostics && !task.error" class="muted-text">（{{ taskDiagnostics(task.diagnostics) }}）</span>
              </li>
            </ul>
          </details>
          <span v-else class="muted-text">无明细</span>
        </li>
      </ul>
    </el-drawer>

    <PlanEditor
      :visible="editorVisible"
      :saving="savingPlan"
      :cities="cities"
      :plan="editingPlan"
      @save="savePlan"
      @cancel="closeEditor"
    />
    <BackupRestoreDialog
      v-model="restoreVisible"
      :collection-busy="isRunning || isPaused || collecting"
      :restore-backup="restoreBackup"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { listCities } from "../shared/cities.js";
import { AIRLINE_NAMES } from "../shared/domain.js";
import { createPlanPayload, getRouteLabel } from "../shared/ui-model.js";
import VerificationPanel from "../shared/VerificationPanel.vue";
import BackupRestoreDialog from "./components/BackupRestoreDialog.vue";
import PlanEditor from "./components/PlanEditor.vue";
import PriceHistory from "./components/PriceHistory.vue";
import { downloadData, getBackupFilename } from "./data-download.js";
import { findNextCollection } from "./dashboard-model.js";

const STATUS_LABELS = {
  "not-collected": "今日尚未采集",
  running: "采集中",
  paused: "等待人工验证",
  complete: "今日采集完成",
  partial: "今日采集不完整",
  failed: "今日采集失败",
};
const RUN_LABELS = {
  pending: "未执行",
  running: "采集中",
  paused: "等待人工验证",
  "awaiting-manual": "等待人工验证",
  complete: "采集完成",
  completed: "采集完成",
  partial: "部分失败",
  failed: "采集失败",
};
const FINISHED_STATUS_LABELS = { complete: "已更新", partial: "部分失败", failed: "采集失败" };

const cities = listCities();
const plans = ref([]);
const observations = ref([]);
const runs = ref([]);
const alarms = ref([]);
const activePlanId = ref("");
const todayStatus = ref("not-collected");
const currentRun = ref(null);
const lastRun = ref(null);
const errorMessage = ref("");
const collecting = ref(false);
const savingPlan = ref(false);
const editorVisible = ref(false);
const editingPlan = ref(null);
const runsVisible = ref(false);
const restoreVisible = ref(false);
const exportingBackup = ref(false);
let statusTimer;
let dataTimer;

const isRunning = computed(() => currentRun.value?.status === "running");
const isPaused = computed(() => currentRun.value?.status === "paused" && Boolean(currentRun.value.manualVerification));
const statusCode = computed(() => isPaused.value ? "paused" : isRunning.value ? "running" : todayStatus.value);
const clockFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });
const statusLabel = computed(() => {
  const run = lastRun.value;
  const recentTime = Date.parse(run?.endedAt ?? run?.startedAt);
  const outcome = FINISHED_STATUS_LABELS[statusCode.value];
  if (outcome && Number.isFinite(recentTime)) {
    return `今日 ${clockFormatter.format(recentTime)} ${outcome}`;
  }
  return STATUS_LABELS[statusCode.value] ?? "状态未知";
});
const activePlan = computed(() => plans.value.find(({ id }) => id === activePlanId.value));
const managedPlan = computed(() => activePlan.value ?? (plans.value.length === 1 ? plans.value[0] : null));
const hasEnabledPlans = computed(() => plans.value.some(({ enabled }) => enabled));
const collectionSchedule = computed(() => {
  if (activePlan.value && !activePlan.value.enabled) return { label: "已停用", detail: "当前计划不会自动采集" };
  if (!hasEnabledPlans.value) return { label: "未安排", detail: "没有启用的查询计划" };
  const next = findNextCollection(plans.value, alarms.value, activePlanId.value);
  if (!next) return { label: "待安排", detail: "暂无下次采集时间" };

  const scheduled = new Date(next.scheduledTime);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const day = scheduled.toDateString() === today.toDateString() ? "今日"
    : scheduled.toDateString() === tomorrow.toDateString() ? "明日" : dayFormatter.format(scheduled);
  const plan = plans.value.find(({ id }) => id === next.planId);
  return { label: `${day} ${clockFormatter.format(scheduled)}`, detail: getRouteLabel(plan), active: true };
});

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (response?.error) {
    const error = new Error(response.error);
    error.code = response.code;
    throw error;
  }
  return response;
}

async function manageBackup(command) {
  if (command === "restore") {
    restoreVisible.value = true;
    return;
  }
  if (command !== "export" || exportingBackup.value) return;

  exportingBackup.value = true;
  try {
    const backup = await request("EXPORT_BACKUP");
    downloadData(JSON.stringify(backup), getBackupFilename(new Date(backup.exportedAt)), "application/json");
    ElMessage.success({
      message: `备份已导出，包含 ${backup.plans.length} 个计划、${backup.observations.length} 条报价`,
      customClass: "data-transfer-toast",
    });
  } catch (error) {
    ElMessage.error(`备份导出失败。${error.message}`);
  } finally {
    exportingBackup.value = false;
  }
}

async function restoreBackup(backup, strategy) {
  const result = await request("RESTORE_BACKUP", { backup, strategy });
  await loadData();
  return result;
}

async function refreshStatus() {
  try {
    const status = await request("GET_STATUS");
    todayStatus.value = status.todayStatus;
    currentRun.value = status.currentRun;
    lastRun.value = status.lastRun;
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function getScheduledAlarms() {
  try {
    return await chrome.alarms.getAll();
  } catch {
    return [];
  }
}

async function loadData() {
  try {
    const [nextPlans, nextObservations, nextRuns, nextAlarms] = await Promise.all([
      request("GET_PLANS"),
      request("GET_OBSERVATIONS"),
      request("GET_RUNS"),
      getScheduledAlarms(),
    ]);
    plans.value = nextPlans;
    observations.value = nextObservations;
    runs.value = nextRuns;
    alarms.value = nextAlarms;
    if (!nextPlans.some(({ id }) => id === activePlanId.value)) activePlanId.value = "";
    errorMessage.value = "";
    await refreshStatus();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function refreshLocalData() {
  try {
    const [nextObservations, nextRuns, nextAlarms] = await Promise.all([
      request("GET_OBSERVATIONS"),
      request("GET_RUNS"),
      getScheduledAlarms(),
    ]);
    observations.value = nextObservations;
    runs.value = nextRuns;
    alarms.value = nextAlarms;
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error.message;
  }
}

function openNewPlan() {
  editingPlan.value = null;
  editorVisible.value = true;
}

function editPlan(plan) {
  editingPlan.value = plan;
  editorVisible.value = true;
}

function closeEditor() {
  editorVisible.value = false;
  editingPlan.value = null;
}

async function savePlan(draft) {
  savingPlan.value = true;
  const existingPlan = editingPlan.value;
  try {
    const plan = createPlanPayload(draft, existingPlan);
    await request("SAVE_PLAN", { plan });
    if (!existingPlan) activePlanId.value = plan.id;
    closeEditor();
    await loadData();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    savingPlan.value = false;
  }
}

function managePlan(command) {
  const plan = managedPlan.value;
  if (!plan) return;
  if (command === "edit") editPlan(plan);
  if (command === "toggle") void togglePlan(plan);
  if (command === "delete") void deletePlan(plan);
}

async function togglePlan(plan) {
  try {
    const updatedPlan = createPlanPayload({ ...plan, enabled: !plan.enabled }, plan);
    await request("SAVE_PLAN", { plan: updatedPlan });
    await loadData();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function deletePlan(plan) {
  try {
    await ElMessageBox.confirm(
      `删除“${getRouteLabel(plan)}”及其价格历史？`,
      "删除查询计划",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
    await request("DELETE_PLAN", { planId: plan.id });
    if (editingPlan.value?.id === plan.id) {
      closeEditor();
    }
    await loadData();
  } catch (error) {
    if (error !== "cancel" && error !== "close") {
      errorMessage.value = error.message;
    }
  }
}

async function collectNow() {
  collecting.value = true;
  errorMessage.value = "";
  try {
    await request("START_MANUAL_RUN");
    await refreshStatus();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    collecting.value = false;
  }
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function runStatusLabel(status) {
  return RUN_LABELS[status] ?? status;
}

function runStatusType(status) {
  return {
    running: "warning",
    paused: "warning",
    complete: "success",
    completed: "success",
    partial: "warning",
    failed: "danger",
  }[status] ?? "info";
}

function taskDescription(task) {
  const plan = plans.value.find((item) => item.id === task.planId);
  const route = plan ? getRouteLabel(plan) : task.planId;
  const airports = task.airportRoute ? ` (${task.airportRoute})` : "";
  return `${route}${airports} · ${task.travelDate} · ${AIRLINE_NAMES[task.airlineCode] ?? task.airlineCode} · ${runStatusLabel(task.status)}`;
}

function taskDiagnostics(diagnostics) {
  const details = [
    `卡片 ${diagnostics.visibleCardCount}/${diagnostics.candidateCount}`,
    `含航班号 ${diagnostics.flightNumberCardCount}`,
    `含经济舱价 ${diagnostics.economyFareCardCount}`,
    `识别 ${diagnostics.parsedRowCount}`,
  ];
  if (diagnostics.visibleNoticeLabels?.length) {
    details.push(`提示按钮 ${diagnostics.visibleNoticeLabels.join("/")}`);
  }
  if (Number.isInteger(diagnostics.noticeClickCount) && diagnostics.noticeClickCount > 0) {
    details.push(`点击 ${diagnostics.noticeClickCount} 次`);
  }
  return details.join("，");
}

onMounted(() => {
  void loadData();
  statusTimer = setInterval(() => void refreshStatus(), 1500);
  dataTimer = setInterval(() => void refreshLocalData(), 5000);
});

onUnmounted(() => {
  clearInterval(statusTimer);
  clearInterval(dataTimer);
});
</script>
