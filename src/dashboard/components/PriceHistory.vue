<template>
  <section class="metrics-grid" aria-label="价格概览">
    <article class="metric-card metric-lowest">
      <h2>历史最低价</h2>
      <button
        v-if="summary.lowest"
        type="button"
        class="metric-value metric-link"
        aria-controls="history-observations"
        :aria-pressed="selectedKey === 'lowest'"
        @click="toggleSelection('lowest')"
      >{{ formatFare(summary.lowest.listedFareCny) }}<span aria-hidden="true">↘</span></button>
      <p v-else class="metric-value">—</p>
      <p v-if="summary.lowest" class="metric-detail metric-flight">
        <strong>{{ summary.lowest.flightNo }}</strong> · {{ summary.lowest.travelDate.slice(5) }} 出发 · {{ tripLabel(summary.lowest) }}
      </p>
      <p v-else class="metric-detail">暂无符合筛选条件的报价</p>
    </article>
    <article class="metric-card">
      <h2>最近采集日价格区间</h2>
      <p v-if="summary.latestRange" class="metric-value metric-range">
        {{ formatFare(summary.latestRange.min) }}<template v-if="summary.latestRange.min !== summary.latestRange.max"><span class="metric-range-separator">–</span>{{ formatFare(summary.latestRange.max) }}</template>
      </p>
      <p v-else class="metric-value">—</p>
      <p v-if="summary.latestRange" class="metric-detail">
        <time :datetime="summary.latestRange.date">{{ summary.latestRange.date }}</time> · {{ summary.latestRange.count }} 条报价
      </p>
      <p v-else class="metric-detail">暂无采集数据</p>
    </article>
    <article class="metric-card">
      <h2>监测航班</h2>
      <p class="metric-value">{{ summary.flightCount }}<span class="metric-unit">班次</span></p>
      <p class="metric-detail">共 {{ summary.quoteCount }} 条报价</p>
    </article>
    <article class="metric-card">
      <h2>下次自动采集</h2>
      <p class="metric-value metric-schedule">{{ schedule.label }}</p>
      <p class="metric-detail"><span class="status-dot" :class="{ 'is-scheduled': schedule.active }" aria-hidden="true"></span>{{ schedule.detail }}</p>
    </article>
  </section>

  <section class="history-section dashboard-card" aria-labelledby="history-title">
    <div class="section-heading">
      <div>
        <div class="chart-heading">
          <h2 id="history-title">价格走势</h2>
          <el-tooltip
            content="圆点越大，表示同价报价越多。悬停查看航班；点击或按回车，可定位下方报价。"
            placement="top"
            :trigger="['hover', 'focus']"
          >
            <button type="button" class="chart-help" aria-label="价格图表使用说明">?</button>
          </el-tooltip>
        </div>
        <p class="section-subtitle">经济舱 · 未含税费</p>
      </div>
      <label class="price-focus-control">
        <el-switch v-model="focusLowPrices" size="small" aria-label="聚焦低价区间" />
        <span>聚焦低价</span>
      </label>
    </div>

    <div class="history-filters" role="group" aria-label="筛选价格走势与航班报价">
      <div class="date-filter">
        <span>出行日期</span>
        <el-select v-model="filters.travelDate" :empty-values="[null, undefined]" size="small" aria-label="出行日期">
          <el-option label="全部日期" value="" />
          <el-option v-for="date in availableDates" :key="date" :label="date" :value="date" />
        </el-select>
      </div>
      <el-segmented v-model="filters.tripType" :options="tripOptions" aria-label="行程类型" size="small" />
      <el-segmented v-model="filters.filterMode" :options="modeOptions" aria-label="筛选方式" size="small" />
      <div v-if="filters.filterMode === 'airline' && filterOptions.length" class="airline-filters" role="group" aria-label="筛选航司">
        <button
          v-for="option in filterOptions"
          :key="option.value"
          type="button"
          class="airline-chip"
          :style="{ '--airline-color': airlineColor(option.value) }"
          :aria-pressed="selectedValues.includes(option.value)"
          @click="toggleAirline(option.value)"
        ><span class="airline-dot" aria-hidden="true"></span>{{ option.label }}</button>
      </div>
      <el-select
        v-else-if="filterOptions.length"
        v-model="selectedValues"
        class="flight-filter"
        size="small"
        multiple
        collapse-tags
        clearable
        aria-label="筛选航班"
        placeholder="选择航班"
        @change="onSelectionChange"
      >
        <el-option v-for="option in filterOptions" :key="option.value" :label="option.label" :value="option.value" />
      </el-select>
      <span v-else class="muted-text">暂无可选{{ filters.filterMode === 'airline' ? '航司' : '航班' }}</span>
    </div>

    <el-empty v-if="!priceChart.scale" :description="plans.length ? '当前筛选条件下暂无价格数据' : '新建查询计划并采集后，即可查看价格走势'" :image-size="90" />
    <template v-else>
      <div v-if="priceChart.mode === 'distribution' || priceChart.hiddenQuoteCount" class="chart-context">
        <span v-if="priceChart.mode === 'distribution'">
          <strong>{{ priceChart.dataDates.length }} 日价格分布</strong> · 按航司归组，满 3 个采集日显示趋势
        </span>
        <span v-if="priceChart.hiddenQuoteCount" class="chart-cutoff-note" role="status">
          图中隐藏 {{ priceChart.hiddenQuoteCount }} 条高价，完整报价见下表
        </span>
      </div>
      <PriceChart :chart="priceChart" :rows="observationsById" :selected-key="selectedKey" @select="toggleSelection" />
    </template>
  </section>

  <QuoteTable
    ref="quoteTable"
    :observations="selectedObservations"
    :lowest-price="summary.lowest?.listedFareCny"
    :selection="selection"
    @clear-selection="selectedKey = null"
  />
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { buildChartModel, buildPriceChartView, filterObservations } from "../../shared/chart-model.js";
import { getFilterOptions } from "../../shared/ui-model.js";
import { airlineColor, formatFare, getQuoteSummary, tripLabel } from "../dashboard-model.js";
import PriceChart from "./PriceChart.vue";
import QuoteTable from "./QuoteTable.vue";

const props = defineProps({
  plans: { type: Array, default: () => [] },
  planId: { type: String, default: "" },
  observations: { type: Array, default: () => [] },
  runs: { type: Array, default: () => [] },
  schedule: { type: Object, required: true },
});

const tripOptions = [
  { label: "不限", value: "all" },
  { label: "直飞", value: "direct" },
  { label: "经停", value: "stopover" },
  { label: "中转", value: "transfer" },
];
const modeOptions = [
  { label: "按航司", value: "airline" },
  { label: "按航班", value: "flight" },
];
const filters = reactive({ travelDate: "", tripType: "all", filterMode: "airline" });
const selectedValues = ref([]);
const selectedKey = ref(null);
const quoteTable = ref(null);
const focusLowPrices = ref(true);
let selectionIncludesAll = true;

const availableDates = computed(() => {
  const dates = new Set(props.plans.filter(({ id }) => !props.planId || id === props.planId)
    .flatMap((plan) => plan.travelDates ?? []));
  for (const observation of props.observations) {
    if (!props.planId || observation.planId === props.planId) dates.add(observation.travelDate);
  }
  return [...dates].sort();
});
const baseObservations = computed(() => filterObservations(props.observations, {
  planId: props.planId, travelDate: filters.travelDate, tripType: filters.tripType,
}));
const filterOptions = computed(() => getFilterOptions(baseObservations.value, filters.filterMode));

watch([() => props.planId, () => filters.travelDate, () => filters.tripType, () => filters.filterMode], () => {
  if (filters.travelDate && !availableDates.value.includes(filters.travelDate)) filters.travelDate = "";
  selectedKey.value = null;
  selectionIncludesAll = true;
  selectedValues.value = filterOptions.value.map(({ value }) => value);
}, { immediate: true });

watch(filterOptions, (options) => {
  const values = new Set(options.map(({ value }) => value));
  selectedValues.value = selectionIncludesAll ? [...values] : selectedValues.value.filter((value) => values.has(value));
});

function onSelectionChange(values) {
  selectionIncludesAll = values.length === filterOptions.value.length;
  selectedKey.value = null;
}

function toggleAirline(code) {
  selectedValues.value = selectedValues.value.includes(code)
    ? selectedValues.value.filter((value) => value !== code)
    : [...selectedValues.value, code];
  onSelectionChange(selectedValues.value);
}

const selectedObservations = computed(() => filterObservations(baseObservations.value, {
  filterMode: filters.filterMode, selectedValues: selectedValues.value,
}));
const summary = computed(() => getQuoteSummary(selectedObservations.value));
const observationsById = computed(() => new Map(selectedObservations.value.map((row) => [row.id, row])));

function getLocalDate(value) {
  const date = new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

const collectionDates = computed(() => props.runs.filter((run) =>
  !props.planId || run.planIds?.includes(props.planId) || run.tasks?.some((task) => task.planId === props.planId),
).map((run) => getLocalDate(run.startedAt)));
const chartModel = computed(() => buildChartModel(selectedObservations.value, collectionDates.value));
const priceChart = computed(() => buildPriceChartView(chartModel.value, { focusLowPrices: focusLowPrices.value }));
const selection = computed(() => {
  if (selectedKey.value === "lowest" && summary.value.lowest) {
    return { key: "lowest", listedFareCny: summary.value.lowest.listedFareCny, observationIds: summary.value.lowestIds };
  }
  return priceChart.value.pointGroups.find(({ key }) => key === selectedKey.value);
});

watch(selection, (group) => {
  if (!group) selectedKey.value = null;
});

async function toggleSelection(key) {
  selectedKey.value = selectedKey.value === key ? null : key;
  await nextTick();
  if (selectedKey.value === key) quoteTable.value?.revealHighlightedRow();
}
</script>
