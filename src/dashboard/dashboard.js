import { buildChartModel, filterObservations } from "../shared/chart-model.js";
import { validatePlan } from "../shared/domain.js";

const AIRLINES = {
  CA: { name: "中国国际航空", color: "#bc3d3d" },
  CZ: { name: "中国南方航空", color: "#087e78" },
};
const RUN_LABELS = {
  running: "采集中",
  complete: "采集完成",
  partial: "部分失败",
  failed: "采集失败",
};
const TODAY_LABELS = {
  "not-collected": "今日尚未采集",
  running: "采集中",
  complete: "今日采集完成",
  partial: "今日采集不完整",
  failed: "今日采集失败",
};
const SVG_NS = "http://www.w3.org/2000/svg";

const form = document.querySelector("#plan-form");
const planError = document.querySelector("#plan-error");
const dateInput = document.querySelector("#travel-date");
const dateList = document.querySelector("#selected-dates");
const planList = document.querySelector("#plan-list");
const filterPlan = document.querySelector("#filter-plan");
const filterDate = document.querySelector("#filter-date");
const valueFilterOptions = document.querySelector("#value-filter-options");
const valueFilterTitle = document.querySelector("#value-filter-title");
const chartEmpty = document.querySelector("#chart-empty");
const chartFrame = document.querySelector("#chart-frame");
const chart = document.querySelector("#price-chart");
const chartLegend = document.querySelector("#chart-legend");
const observationRows = document.querySelector("#observation-rows");
const tableWrap = document.querySelector(".table-wrap");
const runList = document.querySelector("#run-list");
const runButton = document.querySelector("#run-now");
const globalStatus = document.querySelector("#global-status");

let plans = [];
let observations = [];
let runs = [];
let selectedDates = [];
let selectedValues = null;
let editingPlan = null;

function element(tagName, className, value) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (value !== undefined) {
    node.textContent = value;
  }
  return node;
}

function svgElement(tagName, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (response?.error) {
    const error = new Error(response.error);
    error.code = response.code;
    throw error;
  }
  return response;
}

function formatDate(value, options = { dateStyle: "medium" }) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", options).format(new Date(value));
}

function getLocalDate(value) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getRouteLabel(plan) {
  const origin = [plan.originName, plan.originCode].filter(Boolean).join(" ");
  const destination = [plan.destinationName, plan.destinationCode]
    .filter(Boolean)
    .join(" ");
  return `${origin} → ${destination}`;
}

function getAirlineLabel(code) {
  return AIRLINES[code]?.name ?? code;
}

function getCabinLabel(cabin) {
  return {
    economy: "经济舱",
    business: "公务舱",
    first: "头等舱",
  }[cabin] ?? cabin ?? "-";
}

function renderDates() {
  dateList.replaceChildren();
  for (const date of selectedDates) {
    const item = element("li");
    item.append(element("span", "", date));
    const removeButton = element("button", "", "移除");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `移除出行日期 ${date}`);
    removeButton.addEventListener("click", () => {
      selectedDates = selectedDates.filter((value) => value !== date);
      renderDates();
    });
    item.append(removeButton);
    dateList.append(item);
  }
}

function resetPlanForm() {
  editingPlan = null;
  form.reset();
  document.querySelector("#adult-count").value = "1";
  document.querySelector("#collection-time").value = "09:00";
  document.querySelector("#plan-enabled").checked = true;
  selectedDates = [];
  planError.textContent = "";
  document.querySelector("#cancel-edit").hidden = true;
  renderDates();
}

function beginEdit(plan) {
  editingPlan = plan;
  document.querySelector("#plan-name").value = plan.name;
  document.querySelector("#origin-name").value = plan.originName ?? "";
  document.querySelector("#origin-code").value = plan.originCode;
  document.querySelector("#destination-name").value = plan.destinationName ?? "";
  document.querySelector("#destination-code").value = plan.destinationCode;
  document.querySelector("#adult-count").value = String(plan.adultCount);
  document.querySelector("#cabin").value = plan.cabin;
  document.querySelector("#collection-time").value = plan.collectionTime;
  document.querySelector("#plan-enabled").checked = plan.enabled;
  document.querySelectorAll('input[name="airlineCodes"]').forEach((input) => {
    input.checked = plan.airlineCodes.includes(input.value);
  });
  selectedDates = [...plan.travelDates];
  document.querySelector("#cancel-edit").hidden = false;
  planError.textContent = "";
  renderDates();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#plan-name").focus();
}

function renderPlans() {
  planList.replaceChildren();
  if (plans.length === 0) {
    planList.append(element("p", "section-subtitle", "还没有查询计划"));
    return;
  }

  for (const plan of plans) {
    const item = element("article", "plan-item");
    const summary = element("div");
    summary.append(element("h3", "", plan.name || getRouteLabel(plan)));
    summary.append(
      element(
        "p",
        "",
        `${getRouteLabel(plan)} · ${plan.travelDates.join("、")}`,
      ),
    );
    summary.append(
      element(
        "p",
        "",
        `${plan.airlineCodes.map(getAirlineLabel).join("、")} · ${plan.adultCount} 位成人 · ${getCabinLabel(plan.cabin)} · 每日 ${plan.collectionTime} · ${plan.enabled ? "已启用" : "已停用"}`,
      ),
    );

    const actions = element("div", "plan-actions");
    const editButton = element("button", "", "编辑");
    editButton.type = "button";
    editButton.addEventListener("click", () => beginEdit(plan));
    const toggleButton = element("button", "", plan.enabled ? "停用" : "启用");
    toggleButton.type = "button";
    toggleButton.addEventListener("click", () =>
      savePlan({ ...plan, enabled: !plan.enabled }),
    );
    const deleteButton = element("button", "delete-button", "删除");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`删除“${plan.name}”及其价格历史？`)) {
        return;
      }
      try {
        await request("DELETE_PLAN", { planId: plan.id });
        if (editingPlan?.id === plan.id) {
          resetPlanForm();
        }
        await loadData();
      } catch (error) {
        globalStatus.textContent = error.message;
      }
    });
    actions.append(editButton, toggleButton, deleteButton);
    item.append(summary, actions);
    planList.append(item);
  }
}

async function savePlan(plan, resetForm = false) {
  try {
    const savedPlan = await request("SAVE_PLAN", { plan });
    planError.textContent = "";
    if (resetForm || (editingPlan && savedPlan.id === editingPlan.id)) {
      resetPlanForm();
    }
    await loadData();
  } catch (error) {
    planError.textContent = error.message;
  }
}

function getTripType() {
  return document.querySelector('input[name="tripType"]:checked')?.value ?? "all";
}

function getFilterMode() {
  return document.querySelector('input[name="filterMode"]:checked')?.value ?? "airline";
}

function getBaseFilters() {
  return {
    planId: filterPlan.value || undefined,
    travelDate: filterDate.value || undefined,
    tripType: getTripType(),
  };
}

function getBaseObservations() {
  return filterObservations(observations, getBaseFilters());
}

function updateRouteOptions() {
  const previousValue = filterPlan.value;
  filterPlan.replaceChildren();
  const allRoutes = element("option", "", "全部路线");
  allRoutes.value = "";
  filterPlan.append(allRoutes);
  for (const plan of plans) {
    const option = element("option", "", plan.name || getRouteLabel(plan));
    option.value = plan.id;
    filterPlan.append(option);
  }
  filterPlan.value = plans.some((plan) => plan.id === previousValue)
    ? previousValue
    : plans[0]?.id ?? "";
}

function updateTravelDateOptions() {
  const previousValue = filterDate.value;
  const plan = plans.find((candidate) => candidate.id === filterPlan.value);
  const availableDates = new Set([
    ...(plan?.travelDates ?? []),
    ...observations
      .filter((observation) => !filterPlan.value || observation.planId === filterPlan.value)
      .map((observation) => observation.travelDate),
  ]);
  const dates = [...availableDates].sort();
  filterDate.replaceChildren();
  const allDates = element("option", "", "全部日期");
  allDates.value = "";
  filterDate.append(allDates);
  for (const date of dates) {
    const option = element("option", "", date);
    option.value = date;
    filterDate.append(option);
  }
  filterDate.value = dates.includes(previousValue) ? previousValue : "";
}

function updateValueFilter(resetSelection = false) {
  const mode = getFilterMode();
  const key = mode === "flight" ? "flightNo" : "airlineCode";
  const values = [
    ...new Set(getBaseObservations().map((observation) => observation[key])),
  ].sort();
  valueFilterTitle.textContent = mode === "flight" ? "航班" : "航司";
  valueFilterOptions.replaceChildren();

  if (resetSelection || selectedValues === null) {
    selectedValues = [...values];
  } else {
    selectedValues = selectedValues.filter((value) => values.includes(value));
  }

  for (const value of values) {
    const label = element("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = selectedValues.includes(value);
    input.addEventListener("change", () => {
      selectedValues = [...valueFilterOptions.querySelectorAll("input:checked")]
        .map((checkbox) => checkbox.value);
      renderHistory();
    });
    label.append(input, document.createTextNode(
      mode === "airline" ? `${getAirlineLabel(value)}（${value}）` : value,
    ));
    valueFilterOptions.append(label);
  }
  if (values.length === 0) {
    valueFilterOptions.append(element("span", "section-subtitle", "暂无可筛选数据"));
  }
}

function getSelectedObservations() {
  return filterObservations(observations, {
    ...getBaseFilters(),
    filterMode: getFilterMode(),
    selectedValues: selectedValues ?? [],
  });
}

function createAxisText(x, y, value, attributes = {}) {
  const node = svgElement("text", {
    x,
    y,
    fill: "#5b6873",
    "font-size": 12,
    ...attributes,
  });
  node.textContent = value;
  return node;
}

function renderChart(model) {
  chart.replaceChildren();
  chartLegend.replaceChildren();
  const values = model.series.flatMap((series) =>
    series.points.map((point) => point.listedFareCny),
  );
  const hasData = model.series.length > 0 && values.length > 0;
  chartEmpty.hidden = hasData;
  chartFrame.hidden = !hasData;
  tableWrap.hidden = !hasData;
  if (!hasData) {
    return;
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
  const xPosition = (captureDate) => {
    const index = model.captureDates.indexOf(captureDate);
    if (model.captureDates.length <= 1) {
      return plot.left + plotWidth / 2;
    }
    return plot.left + (index / (model.captureDates.length - 1)) * plotWidth;
  };
  const yPosition = (fare) =>
    plot.top + ((maximum - fare) / (maximum - minimum || 1)) * plotHeight;

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = plot.top + (tick / 4) * plotHeight;
    const fare = Math.round(maximum - ((maximum - minimum) * tick) / 4);
    chart.append(
      svgElement("line", {
        x1: plot.left,
        x2: width - plot.right,
        y1: y,
        y2: y,
        stroke: "#e1e6e9",
        "stroke-width": 1,
      }),
      createAxisText(plot.left - 12, y + 4, `￥${fare}`, { "text-anchor": "end" }),
    );
  }

  chart.append(
    svgElement("line", {
      x1: plot.left,
      x2: plot.left,
      y1: plot.top,
      y2: plot.top + plotHeight,
      stroke: "#687681",
      "stroke-width": 1,
    }),
    svgElement("line", {
      x1: plot.left,
      x2: width - plot.right,
      y1: plot.top + plotHeight,
      y2: plot.top + plotHeight,
      stroke: "#687681",
      "stroke-width": 1,
    }),
  );

  const labelStep = Math.max(1, Math.ceil(model.captureDates.length / 8));
  model.captureDates.forEach((date, index) => {
    if (index % labelStep !== 0 && index !== model.captureDates.length - 1) {
      return;
    }
    const x = xPosition(date);
    chart.append(
      svgElement("line", {
        x1: x,
        x2: x,
        y1: plot.top + plotHeight,
        y2: plot.top + plotHeight + 5,
        stroke: "#687681",
        "stroke-width": 1,
      }),
      createAxisText(x, plot.top + plotHeight + 22, date, { "text-anchor": "middle" }),
    );
  });

  chart.append(
    createAxisText(width / 2, height - 12, "采集日期", { "text-anchor": "middle" }),
  );
  const yLabel = createAxisText(20, height / 2, "列表价（CNY）", {
    "text-anchor": "middle",
    transform: `rotate(-90 20 ${height / 2})`,
  });
  chart.append(yLabel);

  model.series.forEach((series, seriesIndex) => {
    const color = AIRLINES[series.airlineCode]?.color ?? "#536475";
    const pointsByDate = new Map(series.points.map((point) => [point.captureDate, point]));
    let pathData = "";
    let previousIndex = -2;
    for (const point of series.points) {
      const pointIndex = model.captureDates.indexOf(point.captureDate);
      const command = pointIndex === previousIndex + 1 ? "L" : "M";
      pathData += `${command} ${xPosition(point.captureDate)} ${yPosition(point.listedFareCny)} `;
      previousIndex = pointIndex;
    }
    const path = svgElement("path", {
      d: pathData.trim(),
      fill: "none",
      stroke: color,
      "stroke-width": 2.4,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-dasharray": seriesIndex % 2 === 0 ? "none" : "6 4",
    });
    const pathTitle = svgElement("title");
    pathTitle.textContent = `${series.airlineCode} ${series.flightNo} · ${series.travelDate}`;
    path.append(pathTitle);
    chart.append(path);

    for (const point of series.points) {
      const circle = svgElement("circle", {
        cx: xPosition(point.captureDate),
        cy: yPosition(point.listedFareCny),
        r: 4.5,
        fill: color,
        stroke: "#ffffff",
        "stroke-width": 1.5,
      });
      const title = svgElement("title");
      title.textContent = `${point.captureDate} · ${series.airlineCode} ${series.flightNo} · ￥${point.listedFareCny}`;
      circle.append(title);
      chart.append(circle);
    }

    const legendItem = element(
      "li",
      "",
      `${series.airlineCode} ${series.flightNo} · ${series.travelDate}`,
    );
    const swatch = element("span", "legend-swatch");
    swatch.style.backgroundColor = color;
    legendItem.prepend(swatch);
    chartLegend.append(legendItem);
  });

  chart.setAttribute(
    "aria-label",
    `列表价（未含税费）历史折线图，包含 ${model.series.length} 条航班系列和 ${model.captureDates.length} 个采集日期。缺失日期不连接。`,
  );
}

function renderObservationTable(items) {
  observationRows.replaceChildren();
  const sorted = [...items].sort((left, right) =>
    right.captureDate.localeCompare(left.captureDate) ||
    left.travelDate.localeCompare(right.travelDate) ||
    left.airlineCode.localeCompare(right.airlineCode) ||
    left.flightNo.localeCompare(right.flightNo),
  );

  for (const observation of sorted) {
    const row = document.createElement("tr");
    const values = [
      observation.captureDate,
      observation.travelDate,
      `${getAirlineLabel(observation.airlineCode)}（${observation.airlineCode}）`,
      observation.flightNo,
      observation.stopCount === 0 ? "直达" : `中转 ${observation.stopCount} 次`,
      getCabinLabel(observation.cabin),
      `￥${new Intl.NumberFormat("zh-CN").format(observation.listedFareCny)}`,
    ];
    values.forEach((value, index) => {
      const cell = element("td", index === 6 ? "price-cell" : "", value);
      row.append(cell);
    });
    observationRows.append(row);
  }
}

function renderHistory() {
  const filtered = getSelectedObservations();
  const selectedPlanId = filterPlan.value;
  const collectionDates = runs
    .filter((run) => {
      if (!selectedPlanId) {
        return true;
      }
      if (Array.isArray(run.planIds)) {
        return run.planIds.includes(selectedPlanId);
      }
      return run.tasks?.some((task) => task.planId === selectedPlanId);
    })
    .map((run) => getLocalDate(run.startedAt));
  renderChart(buildChartModel(filtered, collectionDates));
  renderObservationTable(filtered);
}

function renderRuns() {
  runList.replaceChildren();
  if (runs.length === 0) {
    runList.append(element("p", "section-subtitle", "暂无采集记录"));
    return;
  }

  for (const run of runs.slice(0, 20)) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const trigger = run.trigger === "manual" ? "手动" : "计划任务";
    const status = RUN_LABELS[run.status] ?? run.status;
    summary.textContent = `${formatDate(run.startedAt, { dateStyle: "medium", timeStyle: "short" })} · ${trigger} · ${status} · 成功 ${run.successCount ?? 0} / 失败 ${run.failureCount ?? 0}`;
    details.append(summary);

    if (run.error || run.tasks?.length) {
      const list = document.createElement("ul");
      if (run.error) {
        list.append(element("li", "run-error", run.error));
      }
      for (const task of run.tasks ?? []) {
        const plan = plans.find((candidate) => candidate.id === task.planId);
        const route = plan ? getRouteLabel(plan) : task.planId;
        const description = `${route} · ${task.travelDate} · ${getAirlineLabel(task.airlineCode)} · ${RUN_LABELS[task.status] ?? task.status}`;
        list.append(
          element(
            "li",
            task.error ? "run-error" : "",
            task.error ? `${description}：${task.error}` : description,
          ),
        );
      }
      details.append(list);
    }
    runList.append(details);
  }
}

async function refreshStatus() {
  try {
    const status = await request("GET_STATUS");
    const active = status.currentRun?.status === "running";
    const statusCode = active ? "running" : status.todayStatus;
    globalStatus.textContent = TODAY_LABELS[statusCode] ?? "状态未知";
    runButton.disabled = active;
    runButton.textContent = active ? "采集中…" : "立即采集";
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

async function loadData() {
  try {
    [plans, observations, runs] = await Promise.all([
      request("GET_PLANS"),
      request("GET_OBSERVATIONS"),
      request("GET_RUNS"),
    ]);
    renderPlans();
    updateRouteOptions();
    updateTravelDateOptions();
    updateValueFilter(true);
    renderHistory();
    renderRuns();
    await refreshStatus();
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}

function readPlanForm() {
  return {
    ...(editingPlan ? { id: editingPlan.id, createdAt: editingPlan.createdAt } : {}),
    name: document.querySelector("#plan-name").value,
    originName: document.querySelector("#origin-name").value,
    originCode: document.querySelector("#origin-code").value,
    destinationName: document.querySelector("#destination-name").value,
    destinationCode: document.querySelector("#destination-code").value,
    travelDates: [...selectedDates],
    airlineCodes: [...document.querySelectorAll('input[name="airlineCodes"]:checked')]
      .map((input) => input.value),
    adultCount: Number(document.querySelector("#adult-count").value),
    cabin: document.querySelector("#cabin").value,
    collectionTime: document.querySelector("#collection-time").value,
    enabled: document.querySelector("#plan-enabled").checked,
  };
}

document.querySelector("#add-date").addEventListener("click", () => {
  if (!dateInput.value) {
    return;
  }
  if (!selectedDates.includes(dateInput.value)) {
    selectedDates = [...selectedDates, dateInput.value].sort();
  }
  dateInput.value = "";
  renderDates();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const plan = readPlanForm();
  const errors = validatePlan(plan);
  if (Object.keys(errors).length > 0) {
    planError.textContent = Object.values(errors).join("；");
    return;
  }
  await savePlan(plan, true);
});

document.querySelector("#cancel-edit").addEventListener("click", resetPlanForm);
document.querySelector("#refresh-data").addEventListener("click", () => void loadData());

filterPlan.addEventListener("change", () => {
  updateTravelDateOptions();
  updateValueFilter(true);
  renderHistory();
});
filterDate.addEventListener("change", () => {
  updateValueFilter(true);
  renderHistory();
});
document.querySelectorAll('input[name="tripType"]').forEach((input) => {
  input.addEventListener("change", () => {
    updateValueFilter(true);
    renderHistory();
  });
});
document.querySelectorAll('input[name="filterMode"]').forEach((input) => {
  input.addEventListener("change", () => {
    updateValueFilter(true);
    renderHistory();
  });
});

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  runButton.textContent = "采集中…";
  try {
    await request("START_MANUAL_RUN");
    await loadData();
  } catch (error) {
    globalStatus.textContent = error.message;
    await refreshStatus();
  }
});

void loadData();
setInterval(() => void refreshStatus(), 1500);
setInterval(async () => {
  try {
    [runs, observations] = await Promise.all([
      request("GET_RUNS"),
      request("GET_OBSERVATIONS"),
    ]);
    renderRuns();
    renderHistory();
  } catch (error) {
    globalStatus.textContent = error.message;
  }
}, 5000);
