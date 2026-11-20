<template>
  <div ref="chartFrame" class="chart-frame">
    <svg class="price-chart" :height="layout.height" :viewBox="`0 0 ${layout.width} ${layout.height}`" role="group" :aria-label="chartLabel">
      <g v-for="tick in layout.ticks" :key="tick.value" aria-hidden="true">
        <line :x1="layout.left" :x2="layout.right" :y1="tick.y" :y2="tick.y" class="chart-grid-line" />
        <text :x="layout.left - 11" :y="tick.y + 4" text-anchor="end">{{ formatFare(tick.value) }}</text>
      </g>
      <g v-for="axisLabel in layout.labels" :key="axisLabel.label" aria-hidden="true">
        <line
          v-if="axisLabel.color"
          :x1="axisLabel.x"
          :x2="axisLabel.x"
          :y1="layout.top"
          :y2="layout.bottom"
          class="chart-distribution-guide"
        />
        <text :x="axisLabel.x" :y="layout.bottom + 23" text-anchor="middle" :style="{ fill: axisLabel.color }">{{ axisLabel.label }}</text>
      </g>
      <text :x="(layout.left + layout.right) / 2" :y="layout.height - 5" text-anchor="middle" aria-hidden="true" class="chart-axis-title">
        {{ chart.mode === 'distribution' ? '航司' : '采集日期' }}
      </text>
      <path
        v-for="series in layout.series"
        :key="series.key"
        :d="series.path"
        :stroke="series.color"
        class="chart-trend-line"
        aria-hidden="true"
      />
      <g
        v-for="group in layout.groups"
        :key="group.key"
        class="chart-point"
        :class="{ 'is-overlap': group.observationIds.length > 1 }"
        :transform="`translate(${group.x} ${group.y})`"
        :style="{ '--point-color': group.color }"
        tabindex="0"
        role="button"
        aria-controls="history-observations"
        :aria-label="pointLabel(group)"
        :aria-pressed="selectedKey === group.key"
        @pointerenter="showPreview(group.key)"
        @pointerleave="deferDismiss"
        @focus="showPreview(group.key)"
        @blur="dismissPreview"
        @click="selectPoint(group.key)"
        @keydown.enter.prevent="selectPoint(group.key)"
        @keydown.space.prevent="selectPoint(group.key)"
      >
        <circle class="chart-point-target" :r="group.radius + 4" />
        <circle class="chart-point-glow" :r="group.radius + 4" />
        <circle class="chart-point-mark" :r="group.radius" />
      </g>
    </svg>
    <div
      v-if="preview"
      class="price-chart-tooltip"
      :class="{ 'is-below': preview.y < 176 }"
      :style="{ '--point-x': `${preview.x}px`, '--point-y': `${preview.y}px` }"
      role="tooltip"
      @pointerenter="cancelDismiss"
      @pointerleave="deferDismiss"
    >
      <div class="chart-tooltip-heading">
        <time :datetime="preview.captureDate">{{ preview.captureDate }} 采集</time>
        <span v-if="preview.observationIds.length > 1">{{ preview.observationIds.length }} 条同价</span>
      </div>
      <div v-for="row in previewRows" :key="row.id" class="chart-tooltip-row">
        <span class="airline-dot" :style="{ '--airline-color': airlineColor(row.airlineCode) }" aria-hidden="true"></span>
        <span><strong>{{ row.flightNo }}</strong><small>{{ row.airlineName || AIRLINE_NAMES[row.airlineCode] || row.airlineCode }} · {{ row.travelDate.slice(5) }} 出发</small></span>
        <strong class="chart-tooltip-price">{{ formatFare(row.listedFareCny) }}</strong>
      </div>
      <div v-if="preview.observationIds.length > previewRows.length" class="chart-tooltip-more">
        另有 {{ preview.observationIds.length - previewRows.length }} 条 · 点击定位全部
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { selectChartDateLabels } from "../../shared/chart-model.js";
import { AIRLINE_NAMES } from "../../shared/domain.js";
import { airlineColor, formatFare } from "../dashboard-model.js";

const props = defineProps({
  chart: { type: Object, required: true },
  rows: { type: Map, required: true },
  selectedKey: { type: String, default: null },
});
const emit = defineEmits(["select"]);
const chartFrame = ref(null);
const width = ref(1000);
const previewKey = ref(null);
let dismissTimer;
const shortAirlineNames = { CA: "国航", CZ: "南航", GJ: "长龙", "3U": "川航" };
const lanes = [0, -1, 1, -2, 2];

watch(chartFrame, (frame, _previous, onCleanup) => {
  if (!frame) return;
  const updateWidth = (value) => { if (value > 0) width.value = Math.floor(value); };
  updateWidth(frame.clientWidth);
  const observer = new ResizeObserver(([entry]) => updateWidth(entry.contentRect.width));
  observer.observe(frame);
  onCleanup(() => observer.disconnect());
}, { flush: "post" });

const layout = computed(() => {
  const { mode, dataDates, captureDates, scale, airlines, series, pointGroups, fareCutoff } = props.chart;
  const distribution = mode === "distribution";
  const height = distribution ? (width.value < 500 ? 306 : 362) : 700;
  const left = width.value < 500 ? 59 : 76;
  const right = width.value - (distribution ? 18 : width.value < 500 ? 32 : 44);
  const top = 18;
  const bottom = height - 52;
  const plotWidth = right - left;
  const fareY = (fare) => bottom - (fare - scale.min) / (scale.max - scale.min) * (bottom - top);
  const dateIndices = new Map(captureDates.map((date, index) => [date, index]));
  const dateX = (date) => left + dateIndices.get(date) / (captureDates.length - 1) * plotWidth;
  const bandWidth = plotWidth / (airlines.length || 1);
  const airlineX = (code) => left + (airlines.indexOf(code) + 0.5) * bandWidth;
  const countsByLane = new Map();
  function groupX(group) {
    if (!distribution) return dateX(group.captureDate);
    const laneKey = `${group.airlineCode}|${group.captureDate}`;
    const count = countsByLane.get(laneKey) ?? 0;
    countsByLane.set(laneKey, count + 1);
    const twoDates = dataDates.length === 2;
    const dateOffset = twoDates ? (dataDates.indexOf(group.captureDate) - 0.5) * bandWidth * 0.45 : 0;
    const spread = Math.min(twoDates ? bandWidth * 0.075 : bandWidth * 0.14, 46);
    return airlineX(group.airlineCode) + dateOffset + spread * lanes[count % lanes.length];
  }

  return {
    width: width.value, height, left, right, top, bottom,
    ticks: scale.ticks.map((value) => ({ value, y: fareY(value) })),
    labels: distribution
      ? airlines.map((code) => ({ x: airlineX(code), label: shortAirlineNames[code] ?? code, color: airlineColor(code) }))
      : selectChartDateLabels(captureDates, plotWidth).map((date) => ({ x: dateX(date), label: date })),
    series: distribution ? [] : series.map((line) => {
      let previous = -2;
      const path = line.points.filter(({ listedFareCny }) => listedFareCny <= fareCutoff).map((point) => {
        const index = dateIndices.get(point.captureDate);
        const command = index === previous + 1 ? "L" : "M";
        previous = index;
        return `${command} ${dateX(point.captureDate)} ${fareY(point.listedFareCny)}`;
      }).join(" ");
      return { key: line.key, path, color: airlineColor(line.airlineCode) };
    }).filter(({ path }) => path.includes("L")),
    groups: pointGroups.map((group) => ({
      ...group, x: groupX(group), y: fareY(group.listedFareCny), color: airlineColor(group.airlineCode),
      radius: group.observationIds.length > 1 ? Math.min(11, 6 + Math.sqrt(group.observationIds.length)) : 4.5,
    })),
  };
});

const chartLabel = computed(() => props.chart.mode === "distribution" ? "按航司展示的票价分布" : "按采集日期展示的票价趋势");
const preview = computed(() => layout.value.groups.find(({ key }) => key === previewKey.value));
const previewRows = computed(() => (preview.value?.observationIds ?? []).slice(0, 3).map((id) => props.rows.get(id)).filter(Boolean));

function pointLabel(group) {
  const description = `${group.captureDate} 采集，${formatFare(group.listedFareCny)}`;
  const row = props.rows.get(group.observationIds[0]);
  return group.observationIds.length > 1 ? `${description}，${group.observationIds.length} 条同价报价`
    : `${description}，航班 ${row.flightNo}，${row.travelDate} 出发`;
}

function cancelDismiss() { clearTimeout(dismissTimer); }
function dismissPreview() {
  cancelDismiss();
  previewKey.value = null;
}
function deferDismiss() {
  cancelDismiss();
  dismissTimer = setTimeout(dismissPreview, 200);
}
function showPreview(key) {
  cancelDismiss();
  previewKey.value = key;
}
function selectPoint(key) {
  dismissPreview();
  emit("select", key);
}
function dismissOnEscape(event) {
  if (event.key === "Escape") dismissPreview();
}

onMounted(() => document.addEventListener("keydown", dismissOnEscape));
onUnmounted(() => {
  cancelDismiss();
  document.removeEventListener("keydown", dismissOnEscape);
});
</script>
