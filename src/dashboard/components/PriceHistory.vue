<template>
  <section class="history-section" aria-labelledby="history-title">
    <div class="section-heading">
      <div>
        <h2 id="history-title">价格历史</h2>
        <p class="section-subtitle">列表价（未含税费）</p>
      </div>
      <el-button :loading="refreshing" @click="$emit('refresh')">刷新数据</el-button>
    </div>

    <div class="history-filters">
      <label class="history-filter-item">
        <span>查询路线</span>
        <el-select v-model="filters.planId" class="filter-select">
          <el-option label="全部路线" value="" />
          <el-option
            v-for="plan in plans"
            :key="plan.id"
            :label="getRouteLabel(plan)"
            :value="plan.id"
          />
        </el-select>
      </label>
      <label class="history-filter-item">
        <span>出行日期</span>
        <el-select v-model="filters.travelDate" class="filter-select">
          <el-option label="全部日期" value="" />
          <el-option v-for="date in availableDates" :key="date" :label="date" :value="date" />
        </el-select>
      </label>
      <div class="history-filter-item">
        <span>行程类型</span>
        <el-radio-group v-model="filters.tripType" size="small">
          <el-radio-button value="all">不限</el-radio-button>
          <el-radio-button value="direct">直达</el-radio-button>
          <el-radio-button value="transfer">中转</el-radio-button>
        </el-radio-group>
      </div>
      <div class="history-filter-item">
        <span>筛选方式</span>
        <el-radio-group v-model="filters.filterMode" size="small">
          <el-radio-button value="airline">按航司</el-radio-button>
          <el-radio-button value="flight">按航班</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <div class="value-filters" role="group" :aria-label="filterTitle">
      <span class="filter-caption">{{ filterTitle }}</span>
      <el-checkbox-group
        v-if="filterOptions.length"
        v-model="selectedValues"
        @change="onSelectionChange"
      >
        <el-checkbox v-for="option in filterOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </el-checkbox>
      </el-checkbox-group>
      <span v-else class="muted-text">暂无可筛选数据</span>
    </div>

    <el-empty v-if="!chartLayout" description="当前筛选条件下没有采集记录" />
    <template v-else>
      <div class="chart-scroll">
        <svg
          class="price-chart"
          viewBox="0 0 1000 430"
          role="img"
          :aria-label="chartAriaLabel"
        >
          <g v-for="tick in chartLayout.ticks" :key="tick.label">
            <line
              :x1="chartLayout.plot.left"
              :x2="chartLayout.width - chartLayout.plot.right"
              :y1="tick.y"
              :y2="tick.y"
              stroke="#e1e6e9"
            />
            <text :x="chartLayout.plot.left - 12" :y="tick.y + 4" text-anchor="end">
              {{ tick.label }}
            </text>
          </g>
          <line
            :x1="chartLayout.plot.left"
            :x2="chartLayout.plot.left"
            :y1="chartLayout.plot.top"
            :y2="chartLayout.plot.bottomY"
            stroke="#687681"
          />
          <line
            :x1="chartLayout.plot.left"
            :x2="chartLayout.width - chartLayout.plot.right"
            :y1="chartLayout.plot.bottomY"
            :y2="chartLayout.plot.bottomY"
            stroke="#687681"
          />
          <g v-for="label in chartLayout.dateLabels" :key="label.date">
            <line
              :x1="label.x"
              :x2="label.x"
              :y1="chartLayout.plot.bottomY"
              :y2="chartLayout.plot.bottomY + 5"
              stroke="#687681"
            />
            <text :x="label.x" :y="chartLayout.plot.bottomY + 22" text-anchor="middle">
              {{ label.date }}
            </text>
          </g>
          <text x="500" y="418" text-anchor="middle">采集日期</text>
          <text x="20" y="215" text-anchor="middle" transform="rotate(-90 20 215)">
            列表价（CNY）
          </text>
          <g v-for="series in chartLayout.series" :key="series.key">
            <path
              :d="series.path"
              fill="none"
              :stroke="series.color"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              :stroke-dasharray="series.dashed ? '6 4' : 'none'"
            >
              <title>{{ series.label }}</title>
            </path>
            <circle
              v-for="point in series.points"
              :key="point.captureDate"
              :cx="point.x"
              :cy="point.y"
              r="4.5"
              :fill="series.color"
              stroke="#ffffff"
              stroke-width="1.5"
            >
              <title>{{ point.title }}</title>
            </circle>
          </g>
        </svg>
      </div>

      <ul class="chart-legend" aria-label="航班系列图例">
        <li v-for="series in chartLayout.series" :key="series.key">
          <span class="legend-swatch" :style="{ backgroundColor: series.color }" />
          {{ series.label }}
        </li>
      </ul>

      <el-table :data="sortedObservations" stripe size="small" class="observation-table">
        <el-table-column prop="captureDate" label="采集日期" min-width="120" />
        <el-table-column prop="travelDate" label="出行日期" min-width="120" />
        <el-table-column label="航司" min-width="160">
          <template #default="{ row }">{{ row.airlineName }}（{{ row.airlineCode }}）</template>
        </el-table-column>
        <el-table-column prop="flightNo" label="航班" min-width="100" />
        <el-table-column label="行程" min-width="100">
          <template #default="{ row }">
            {{ row.stopCount === 0 ? "直达" : `中转 ${row.stopCount} 次` }}
          </template>
        </el-table-column>
        <el-table-column label="列表价（未含税费）" min-width="170" align="right">
          <template #default="{ row }">￥{{ formatMoney(row.listedFareCny) }}</template>
        </el-table-column>
      </el-table>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { buildChartModel, filterObservations } from "../../shared/chart-model.js";
import { getFilterOptions, getRouteLabel } from "../../shared/ui-model.js";

const props = defineProps({
  plans: { type: Array, default: () => [] },
  observations: { type: Array, default: () => [] },
  runs: { type: Array, default: () => [] },
  refreshing: { type: Boolean, default: false },
});

defineEmits(["refresh"]);

const filters = reactive({
  planId: "",
  travelDate: "",
  tripType: "all",
  filterMode: "airline",
});
const selectedValues = ref([]);
let selectionIncludesAll = true;

const activePlan = computed(() => props.plans.find((plan) => plan.id === filters.planId));
const availableDates = computed(() => {
  const dates = new Set(activePlan.value?.travelDates ?? []);
  for (const observation of props.observations) {
    if (!filters.planId || observation.planId === filters.planId) {
      dates.add(observation.travelDate);
    }
  }
  return [...dates].sort();
});

const baseObservations = computed(() =>
  filterObservations(props.observations, {
    planId: filters.planId || undefined,
    travelDate: filters.travelDate || undefined,
    tripType: filters.tripType,
  }),
);
const filterOptions = computed(() => getFilterOptions(baseObservations.value, filters.filterMode));
const filterTitle = computed(() => filters.filterMode === "flight" ? "航班" : "航司");

watch(
  [() => filters.planId, () => filters.travelDate, () => filters.tripType, () => filters.filterMode],
  async () => {
    if (filters.travelDate && !availableDates.value.includes(filters.travelDate)) {
      filters.travelDate = "";
    }
    await nextTick();
    selectedValues.value = filterOptions.value.map((option) => option.value);
    selectionIncludesAll = true;
  },
  { immediate: true },
);

watch(filterOptions, (options) => {
  if (selectionIncludesAll) {
    selectedValues.value = options.map((option) => option.value);
  } else {
    const available = new Set(options.map((option) => option.value));
    selectedValues.value = selectedValues.value.filter((value) => available.has(value));
  }
});

function onSelectionChange(values) {
  selectionIncludesAll = values.length === filterOptions.value.length;
}

const selectedObservations = computed(() =>
  filterObservations(props.observations, {
    planId: filters.planId || undefined,
    travelDate: filters.travelDate || undefined,
    tripType: filters.tripType,
    filterMode: filters.filterMode,
    selectedValues: selectedValues.value,
  }),
);

function getLocalDate(value) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const collectionDates = computed(() =>
  props.runs
    .filter((run) => {
      if (!filters.planId) {
        return true;
      }
      if (Array.isArray(run.planIds)) {
        return run.planIds.includes(filters.planId);
      }
      return run.tasks?.some((task) => task.planId === filters.planId);
    })
    .map((run) => getLocalDate(run.startedAt)),
);

const chartModel = computed(() =>
  buildChartModel(selectedObservations.value, collectionDates.value),
);
const chartLayout = computed(() => {
  const model = chartModel.value;
  const values = model.series.flatMap((series) =>
    series.points.map((point) => point.listedFareCny),
  );
  if (!values.length) {
    return null;
  }

  const width = 1000;
  const height = 430;
  const plot = { left: 82, right: 26, top: 24, bottom: 72 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const padding = Math.max((highest - lowest) * 0.12, 80);
  const minimum = Math.max(0, Math.floor((lowest - padding) / 100) * 100);
  const maximum = Math.ceil((highest + padding) / 100) * 100 || 100;
  const xPosition = (date) => {
    const index = model.captureDates.indexOf(date);
    return model.captureDates.length <= 1
      ? plot.left + plotWidth / 2
      : plot.left + (index / (model.captureDates.length - 1)) * plotWidth;
  };
  const yPosition = (fare) =>
    plot.top + ((maximum - fare) / (maximum - minimum || 1)) * plotHeight;
  const dateStep = Math.max(1, Math.ceil(model.captureDates.length / 8));

  return {
    width,
    plot: { ...plot, bottomY: plot.top + plotHeight },
    ticks: Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const fare = Math.round(maximum - (maximum - minimum) * ratio);
      return {
        label: `￥${fare}`,
        y: plot.top + ratio * plotHeight,
      };
    }),
    dateLabels: model.captureDates.flatMap((date, index) =>
      index % dateStep === 0 || index === model.captureDates.length - 1
        ? [{ date, x: xPosition(date) }]
        : [],
    ),
    series: model.series.map((series, seriesIndex) => {
      const points = series.points.map((point) => {
        const x = xPosition(point.captureDate);
        const y = yPosition(point.listedFareCny);
        return {
          ...point,
          x,
          y,
          title: `${point.captureDate} · ${series.airlineCode} ${series.flightNo} · ￥${formatMoney(point.listedFareCny)}`,
        };
      });
      const path = points.reduce((result, point, index) => {
        const priorDateIndex = index > 0
          ? model.captureDates.indexOf(points[index - 1].captureDate)
          : -2;
        const currentDateIndex = model.captureDates.indexOf(point.captureDate);
        return `${result}${currentDateIndex === priorDateIndex + 1 ? "L" : "M"} ${point.x} ${point.y} `;
      }, "").trim();
      const color = series.airlineCode === "CA" ? "#bd3935" : "#16877e";
      return {
        ...series,
        color,
        dashed: seriesIndex % 2 === 1,
        points,
        path,
        label: `${series.airlineCode} ${series.flightNo} · ${series.travelDate}`,
      };
    }),
  };
});

const chartAriaLabel = computed(() =>
  `列表价（未含税费）历史折线图，包含 ${chartLayout.value?.series.length ?? 0} 条航班系列。缺失采集日期不连接。`,
);

const sortedObservations = computed(() =>
  [...selectedObservations.value].sort((left, right) =>
    right.captureDate.localeCompare(left.captureDate) ||
    left.travelDate.localeCompare(right.travelDate) ||
    left.airlineCode.localeCompare(right.airlineCode) ||
    left.flightNo.localeCompare(right.flightNo),
  ),
);

function formatMoney(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
</script>
