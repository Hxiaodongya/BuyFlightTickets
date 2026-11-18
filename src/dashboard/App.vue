<template>
  <div class="dashboard-shell">
    <header class="topbar">
      <div>
        <h1>航班价格追踪</h1>
        <p>中国国际航空 · 中国南方航空</p>
      </div>
      <div class="top-actions">
        <el-tag :type="statusType" effect="plain" role="status" aria-live="polite">
          {{ statusLabel }}
        </el-tag>
        <el-button type="primary" :loading="collecting" :disabled="isRunning" @click="collectNow">
          {{ isRunning ? "采集中" : "立即采集" }}
        </el-button>
      </div>
    </header>

    <main class="dashboard-main">
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        show-icon
        :closable="true"
        @close="errorMessage = ''"
      />

      <section class="plans-section" aria-labelledby="plans-title">
        <div class="section-heading">
          <div>
            <h2 id="plans-title">查询计划</h2>
            <p class="section-subtitle">设置城市、目标日期和每日采集时间</p>
          </div>
          <el-button type="primary" @click="openNewPlan">新建计划</el-button>
        </div>

        <el-table v-if="plans.length" :data="plans" row-key="id" stripe>
          <el-table-column label="路线" min-width="180">
            <template #default="{ row }">
              <span>{{ getRouteLabel(row) }}</span>
              <el-tag v-if="row.migrationStatus" type="warning" size="small" class="row-warning">
                需重新选择城市
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="目标出行日期" min-width="220">
            <template #default="{ row }">{{ row.travelDates?.join("、") || "未设置" }}</template>
          </el-table-column>
          <el-table-column label="航司" min-width="180">
            <template #default="{ row }">{{ formatAirlines(row.airlineCodes) }}</template>
          </el-table-column>
          <el-table-column prop="collectionTime" label="每日采集" width="120" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'" effect="plain">
                {{ row.enabled ? "已启用" : "已停用" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="editPlan(row)">编辑</el-button>
              <el-button
                link
                type="primary"
                :disabled="Boolean(row.migrationStatus)"
                @click="togglePlan(row)"
              >
                {{ row.enabled ? "停用" : "启用" }}
              </el-button>
              <el-button link type="danger" @click="deletePlan(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="还没有查询计划" />
      </section>

      <PriceHistory
        :plans="plans"
        :observations="observations"
        :runs="runs"
        :refreshing="refreshing"
        @refresh="refreshLocalData"
      />

      <section class="runs-section" aria-labelledby="runs-title">
        <div class="section-heading">
          <h2 id="runs-title">采集记录</h2>
          <span class="muted-text">最近 20 次</span>
        </div>
        <el-empty v-if="!runs.length" description="暂无采集记录" />
        <el-table v-else :data="runs.slice(0, 20)" row-key="id" size="small">
          <el-table-column label="开始时间" min-width="175">
            <template #default="{ row }">{{ formatDate(row.startedAt) }}</template>
          </el-table-column>
          <el-table-column label="触发方式" width="115">
            <template #default="{ row }">{{ row.trigger === "manual" ? "手动" : "计划任务" }}</template>
          </el-table-column>
          <el-table-column label="结果" width="130">
            <template #default="{ row }">
              <el-tag :type="runStatusType(row.status)" effect="plain">
                {{ runStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="成功 / 失败" width="130">
            <template #default="{ row }">{{ row.successCount ?? 0 }} / {{ row.failureCount ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="明细" min-width="250">
            <template #default="{ row }">
              <details v-if="row.error || row.tasks?.length" class="run-details">
                <summary>查看明细</summary>
                <ul>
                  <li v-if="row.error" class="run-error">{{ row.error }}</li>
                  <li v-for="(task, index) in row.tasks ?? []" :key="`${row.id}-${index}`" :class="{ 'run-error': task.error }">
                    {{ taskDescription(task) }}<span v-if="task.error">：{{ task.error }}</span>
                  </li>
                </ul>
              </details>
              <span v-else class="muted-text">无明细</span>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </main>

    <PlanEditor
      :visible="editorVisible"
      :saving="savingPlan"
      :cities="cities"
      :plan="editingPlan"
      @save="savePlan"
      @cancel="closeEditor"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { listCities } from "../shared/cities.js";
import { createPlanPayload, getRouteLabel } from "../shared/ui-model.js";
import PlanEditor from "./components/PlanEditor.vue";
import PriceHistory from "./components/PriceHistory.vue";

const AIRLINE_NAMES = {
  CA: "中国国际航空",
  CZ: "中国南方航空",
};
const STATUS_LABELS = {
  "not-collected": "今日尚未采集",
  running: "采集中",
  complete: "今日采集完成",
  partial: "今日采集不完整",
  failed: "今日采集失败",
};
const RUN_LABELS = {
  running: "采集中",
  complete: "采集完成",
  partial: "部分失败",
  failed: "采集失败",
};

const cities = listCities();
const plans = ref([]);
const observations = ref([]);
const runs = ref([]);
const todayStatus = ref("not-collected");
const currentRun = ref(null);
const errorMessage = ref("");
const collecting = ref(false);
const refreshing = ref(false);
const savingPlan = ref(false);
const editorVisible = ref(false);
const editingPlan = ref(null);
let statusTimer;
let dataTimer;

const isRunning = computed(() => currentRun.value?.status === "running");
const statusCode = computed(() => isRunning.value ? "running" : todayStatus.value);
const statusLabel = computed(() => STATUS_LABELS[statusCode.value] ?? "状态未知");
const statusType = computed(() => ({
  running: "warning",
  complete: "success",
  partial: "warning",
  failed: "danger",
}[statusCode.value] ?? "info"));

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (response?.error) {
    const error = new Error(response.error);
    error.code = response.code;
    throw error;
  }
  return response;
}

async function refreshStatus() {
  try {
    const status = await request("GET_STATUS");
    todayStatus.value = status.todayStatus;
    currentRun.value = status.currentRun;
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function loadData() {
  refreshing.value = true;
  try {
    const [nextPlans, nextObservations, nextRuns] = await Promise.all([
      request("GET_PLANS"),
      request("GET_OBSERVATIONS"),
      request("GET_RUNS"),
    ]);
    plans.value = nextPlans;
    observations.value = nextObservations;
    runs.value = nextRuns;
    errorMessage.value = "";
    await refreshStatus();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    refreshing.value = false;
  }
}

async function refreshLocalData() {
  try {
    const [nextObservations, nextRuns] = await Promise.all([
      request("GET_OBSERVATIONS"),
      request("GET_RUNS"),
    ]);
    observations.value = nextObservations;
    runs.value = nextRuns;
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
  try {
    const plan = createPlanPayload(draft, editingPlan.value);
    await request("SAVE_PLAN", { plan });
    closeEditor();
    await loadData();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    savingPlan.value = false;
  }
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

function formatAirlines(codes = []) {
  return codes.map((code) => AIRLINE_NAMES[code] ?? code).join("、") || "未选择";
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
    complete: "success",
    partial: "warning",
    failed: "danger",
  }[status] ?? "info";
}

function taskDescription(task) {
  const plan = plans.value.find((item) => item.id === task.planId);
  const route = plan ? getRouteLabel(plan) : task.planId;
  return `${route} · ${task.travelDate} · ${AIRLINE_NAMES[task.airlineCode] ?? task.airlineCode} · ${runStatusLabel(task.status)}`;
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
