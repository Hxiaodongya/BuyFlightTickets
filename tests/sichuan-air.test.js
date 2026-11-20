import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createCollector } from "../src/background/collector.js";
import * as collectorModule from "../src/background/collector.js";
import { airlineAdapters, buildQuoteSearchUrl } from "../src/collectors/airline-config.js";
import { normalizePlan } from "../src/shared/domain.js";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);
const parserSource = await readFile(projectFile("src/collectors/price-parser.js"), "utf8");
const resultSource = await readFile(projectFile("src/collectors/result-page.js"), "utf8");
const travelDate = "2027-02-05";
const plan = {
  id: "sichuan-plan",
  originCityId: "city-hgh",
  destinationCityId: "city-cgq",
  airlineCodes: ["3U"],
  travelDates: [travelDate],
};
const searchUrl = `https://www.sichuanair.com/?flightTrackerFrom=HGH&flightTrackerTo=CGQ&flightTrackerDate=${travelDate}`;
const resultUrl = "https://flights.sichuanair.com/3uair/ibe/ticket/hgh-cgq.html";

function element(text = "", selectors = {}, children = []) {
  return {
    innerText: text,
    textContent: text,
    children,
    getClientRects: () => [{}],
    querySelector: (selector) => selectors[selector]?.[0] ?? null,
    querySelectorAll: (selector) => selectors[selector] ?? [],
  };
}

function resultDocument(date = travelDate) {
  const fares = ["¥890", "¥1950", "--", "¥1780", "--"];
  const firstFlight = element("3U6225", {
    ".route-info .flight-code": [element("3U6225")],
    ".route-start .route-time": [element("07:50")],
    ".route-start .route-date": [element(date)],
    ".route-end .route-time": [element("11:00")],
    ".route-end .route-date": [element(date)],
    ".period-time": [element("3h 10min")],
  });
  const cells = fares.map((fare) => element(fare, { ".ticket-price": fare === "--" ? [] : [element(fare)] }));
  const row = element("3U6225", {}, [firstFlight, ...cells]);
  const soldOut = element("3U6227", {}, [firstFlight, cells[0], ...cells.slice(1).map(() => element("--"))]);
  const cabinLabels = ["航班信息", "优惠公务舱", "经典经济舱", "增值经济舱", "标准经济舱", "基础经济舱"];
  const table = element("", {
    ".tbh-section .th-tr": [element("", {}, cabinLabels.map((name) => element(name)))],
    ".tbd-section .tb-tr": [row, soldOut],
  });
  return {
    ...element("", {
      "#main .route-resume .date": [element(date)],
      "#main .zt-flight-choose": [table],
    }),
    body: element("杭州 长春 航班信息 经济舱"),
  };
}

function requestResult(document, href = `${resultUrl}?ark-trace-id=test-only`) {
  let listener;
  let timestamp = 0;
  vm.runInNewContext(`${parserSource}\n${resultSource}`, {
    document,
    location: new URL(href),
    URL,
    Date: { now: () => timestamp += 1_001 },
    setTimeout: (callback) => queueMicrotask(callback),
    chrome: { runtime: {
      onMessage: { addListener(handler) { listener = handler; } },
      async sendMessage() { return null; },
    } },
  });
  assert.equal(typeof listener, "function", "川航结果页应注册采集消息处理器");
  return new Promise((resolve) => {
    assert.equal(listener({
      type: "GET_COLLECTION_REQUEST", requestId: "3u-job", airlineCode: "3U", searchUrl, resultUrl, travelDate,
    }, {}, resolve), true);
  });
}

test("川航支持新查询计划和多机场城市，报价跳转保留原机场航线", () => {
  const normalized = normalizePlan(plan);
  assert.equal(airlineAdapters["3U"].buildSearchUrl({ plan: normalized, travelDate }), searchUrl);
  assert.deepEqual(airlineAdapters["3U"].buildSearchRoutes({ plan: { ...plan, originCityId: "city-bjs" } }), ["PEK-CGQ", "PKX-CGQ"]);
  const jump = new URL(buildQuoteSearchUrl({
    ...plan, originCityId: "city-bjs", airlineCode: "3U", travelDate,
    sourceUrl: "https://flights.sichuanair.com/3uair/ibe/ticket/pkx-cgq.html?ark-trace-id=transient",
  }));
  assert.equal(jump.origin, "https://www.sichuanair.com");
  assert.equal(jump.searchParams.get("flightTrackerFrom"), "PKX");
  assert.equal(jump.searchParams.get("flightTrackerDate"), travelDate);
  assert.equal(jump.searchParams.has("ark-trace-id"), false);
});

test("川航取各航班最低可用经济舱票面价，保留日期时刻且排除仅公务舱的航班", async () => {
  const response = await requestResult(resultDocument());
  assert.equal(response.error, undefined);
  assert.equal(response.diagnostics.visibleCardCount, 2);
  assert.equal(response.diagnostics.economyFareCardCount, 1);
  assert.deepEqual(Array.from(response.rows, (row) => ({ ...row })), [{
    flightNo: "3U6225", listedFareCny: 1780, stopCount: 0, transferCount: 0, hasStopover: false,
    stopoverName: null, cabin: "economy", fareProduct: "最低经济舱", travelDate,
    departureTime: "07:50", arrivalTime: "11:00", arrivalDate: travelDate, arrivalDayOffset: null,
    durationMinutes: 190, sourceUrl: resultUrl,
  }]);
});

test("川航结果页日期或机场航线不匹配时拒绝采集", async () => {
  for (const response of [
    await requestResult(resultDocument("2027-02-04")),
    await requestResult(resultDocument(), resultUrl.replace("hgh-cgq", "cgq-hgh")),
  ]) {
    assert.equal(response.rows.length, 0);
    assert.match(response.error, /航线或日期不匹配/);
  }
});

async function submitSearchThroughForm({ pageText = "", airportsPreselected = false } = {}) {
  const searchSource = await readFile(projectFile("src/collectors/sichuan-air-search.js"), "utf8");
  const actions = [];
  const initialDate = "2026-11-20";
  let calendarDate = airportsPreselected ? initialDate : null;
  let activeAirport;
  let elapsed = 0;
  const field = { ...element(), value: "" };
  const airportFields = (direction, code, label) => {
    const name = `Search/OriginDestinationInformation/${direction}/location`;
    const selectionId = `CITY_${code}_CN`;
    const selected = { ...field, value: airportsPreselected ? selectionId : "" };
    let suggestionReady = false;
    const option = {
      ...element(`${code} ${label}`),
      click() {
        selected.value = selectionId;
        actions.push(code);
        if (direction === "Destination") dateInput.focus();
      },
    };
    const input = {
      ...field,
      value: airportsPreselected ? label : "",
      addEventListener() {},
      removeEventListener() {},
      focus() { activeAirport = this; },
      dispatchEvent(event) {
        if (event.type === "keydown" && event.keyCode && activeAirport === this && this.value === label) {
          queueMicrotask(() => { suggestionReady = true; });
        }
      },
      closest: () => ({
        querySelectorAll: (selector) => suggestionReady && selector.includes(`li[id^="CITY_${code}_"]`) ? [option] : [],
      }),
    };
    return { [`input[name="${name}_input"]`]: [input], [`input[name="${name}"]`]: [selected] };
  };
  const dateInput = {
    ...field,
    value: initialDate,
    addEventListener() {},
    removeEventListener() {},
    focus() { calendarDate ??= this.value; },
    dispatchEvent(event) {
      if (event.type === "focus") this.focus();
      if (event.type === "keyup" && calendarDate) calendarDate = this.value;
    },
  };
  const day = {
    ...element("5"),
    click() {
      dateInput.value = travelDate;
      calendarDate = null;
      actions.push(travelDate);
    },
  };
  const calendar = { getClientRects: () => calendarDate ? [{}] : [] };
  const form = element("", {
    ...airportFields("Origin", "HGH", "杭州"),
    ...airportFields("Destination", "CGQ", "长春"),
    'input[name="Search/DateInformation/departDate_display"]': [dateInput],
    'input[name="Search/DateInformation/departDate"]': [{ ...field }],
    'input[name="Search/Passengers/adults"]': [{ value: "1" }],
    'input[name="Search/Passengers/children"]': [{ value: "0" }],
    'input[name="Search/Passengers/infants"]': [{ value: "0" }],
    "a.sensor-search": [{ ...element("立即查询"), click() { actions.push("submitted"); } }],
  });
  let listener;
  vm.runInNewContext(`${parserSource}\n${searchSource}`, {
    location: new URL(searchUrl), URL, Event,
    Date: { now: () => elapsed },
    KeyboardEvent: class extends Event {
      constructor(type, init = {}) {
        super(type, init);
        this.keyCode = init.keyCode ?? 0;
      }
    },
    document: {
      ...element("", {
        "#searchForm": [form], "#flightoneway": [{ checked: true }], "#ui-datepicker-div": [calendar],
      }),
      querySelectorAll(selector) {
        const februaryDays = '#ui-datepicker-div td[data-handler="selectDay"][data-year="2027"][data-month="1"] a';
        return selector === februaryDays && calendarDate === travelDate ? [day] : [];
      },
      body: element(pageText),
    },
    setTimeout: (callback, delay = 0) => queueMicrotask(() => {
      elapsed += delay;
      callback();
    }),
    chrome: { runtime: { onMessage: { addListener(handler) { listener = handler; } } } },
  });
  const response = await new Promise((resolve) => {
    listener({ type: "SUBMIT_SICHUAN_AIR_SEARCH", searchUrl, originName: "杭州", destinationName: "长春" }, {}, resolve);
  });
  await Promise.resolve();
  return { response: { ...response }, actions };
}

test("川航按下键触发杭州、长春联想并在选定日期后只提交一次", async () => {
  const { response, actions } = await submitSearchThroughForm();
  assert.deepEqual(response, { submitted: true });
  assert.deepEqual(actions, ["HGH", "CGQ", travelDate, "submitted"]);
});

test("川航日历已在默认月份打开时仍选中指定出发日期", async () => {
  const { response, actions } = await submitSearchThroughForm({ airportsPreselected: true });
  assert.deepEqual(response, { submitted: true });
  assert.deepEqual(actions, [travelDate, "submitted"]);
});

test("川航首页出现安全验证时保持原样并暂停任务", async () => {
  const { response, actions } = await submitSearchThroughForm({ pageText: "安全验证，请完成验证后查询" });
  assert.deepEqual(response, { pauseReason: "human-verification" });
  assert.deepEqual(actions, []);
});

function navigatingTabs() {
  let tab;
  const messages = [];
  return {
    messages,
    async create(options) {
      tab = { id: 7, url: options.url, status: "complete", active: options.active };
      return { ...tab };
    },
    async get(tabId) {
      assert.equal(tabId, 7);
      return { ...tab };
    },
    async sendMessage(tabId, message) {
      assert.equal(tabId, 7);
      messages.push({ url: tab.url, type: message.type, active: tab.active });
      if (message.type === "SUBMIT_SICHUAN_AIR_SEARCH") {
        assert.equal(tab.url, searchUrl);
        assert.equal(message.originName, "杭州");
        assert.equal(message.destinationName, "长春");
        tab.url = `${resultUrl}?ark-trace-id=test-only`;
        return { submitted: true };
      }
      assert.equal(message.resultUrl, resultUrl);
      assert.equal(message.travelDate, travelDate);
      if (message.type === "CHECK_SICHUAN_AIR_RESULT") return { submitted: true };
      return {
        type: "COLLECTION_RESULT", requestId: message.requestId, airlineCode: "3U",
        rows: [{ flightNo: "3U6225", listedFareCny: 1950, travelDate, sourceUrl: resultUrl }],
      };
    },
    async remove(tabId) { assert.equal(tabId, 7); },
  };
}

test("定时采集在同一个标签页提交川航表单并读取跨域结果", async () => {
  const tabsApi = navigatingTabs();
  const observations = [];
  const collector = createCollector({
    tabsApi, adapters: airlineAdapters, timeoutMs: 100,
    storage: {
      async listPlans() { return [{ ...plan, originCityName: "杭州", destinationCityName: "长春", enabled: true }]; },
      async saveRun() {},
      async saveObservations(rows) { observations.push(...rows); },
    },
  });
  const run = await collector.startRun("scheduled");
  assert.equal(run.status, "complete");
  assert.equal(run.successCount, 1);
  assert.equal(observations[0]?.listedFareCny, 1950);
  assert.deepEqual(tabsApi.messages.map(({ type, active }) => [type, active]), [
    ["SUBMIT_SICHUAN_AIR_SEARCH", false], ["GET_COLLECTION_REQUEST", false],
  ]);
});

test("川航报价跳转打开前台标签并确认到达指定日期的结果页", async () => {
  const tabsApi = navigatingTabs();
  const result = await collectorModule.openSichuanAirQuoteSearch(tabsApi, { ...plan, airlineCode: "3U", travelDate }, 100);
  assert.deepEqual(result, { submitted: true });
  assert.deepEqual(tabsApi.messages.map(({ type, active }) => [type, active]), [
    ["SUBMIT_SICHUAN_AIR_SEARCH", true], ["CHECK_SICHUAN_AIR_RESULT", true],
  ]);
});
