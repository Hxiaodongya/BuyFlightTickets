import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { airlineAdapters, buildQuoteSearchUrl } from "../src/collectors/airline-config.js";

const parserSource = await readFile(
  new URL("../src/collectors/price-parser.js", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const parser = vm.runInNewContext(`${parserSource}\nglobalThis.FlightPriceParser`);

const cityPlan = {
  originCityId: "city-hgh",
  originCityName: "杭州",
  destinationCityId: "city-cgq",
  destinationCityName: "长春",
  travelDates: ["2027-02-04"],
};

const airChinaUrl = "https://www.airchina.com.cn/flight/oneway/hgh-cgq/2027-02-04";
const chinaSouthernUrl = "https://b2c.csair.com/B2C40/newTrips/static/main/page/booking/index.html?t=S&c1=HGH&c2=CGQ&d1=2027-02-04&at=1&ct=0&it=0&b1=HGH&b2=CGQ&orderChannel=JPSS-YDXC";
const quote = {
  originCityId: cityPlan.originCityId,
  destinationCityId: cityPlan.destinationCityId,
  travelDate: "2027-02-04",
  captureDate: "2026-11-19",
  sourceUrl: "https://www.airchina.com.cn/",
};

test("opens results for the quote's airline, stored route, and travel date", () => {
  assert.equal(buildQuoteSearchUrl({ ...quote, airlineCode: "CA" }), airChinaUrl);
  assert.equal(buildQuoteSearchUrl({ ...quote, airlineCode: "CZ" }), chinaSouthernUrl);
});

test("preserves the exact airport in historical quotes with airport codes", () => {
  const historicalQuote = {
    originCode: "PKX",
    destinationCode: "CGQ",
    travelDate: "2027-02-05",
  };
  const url = new URL(buildQuoteSearchUrl({ ...historicalQuote, airlineCode: "CZ" }));
  assert.equal(url.searchParams.get("c1"), "BJS");
  assert.equal(url.searchParams.get("b1"), "PKX");
  assert.equal(url.searchParams.get("c2"), "CGQ");
  assert.equal(url.searchParams.get("d1"), "2027-02-05");
  assert.equal(
    buildQuoteSearchUrl({ ...historicalQuote, airlineCode: "CA" }),
    "https://www.airchina.com.cn/flight/oneway/pkx-cgq/2027-02-05",
  );
});

test("keeps a shared airport code without substituting either associated city", () => {
  const historicalQuote = { originCode: "XIY", destinationCode: "CAN", travelDate: "2027-02-05" };
  assert.equal(
    buildQuoteSearchUrl({ ...historicalQuote, airlineCode: "CA" }),
    "https://www.airchina.com.cn/flight/oneway/xiy-can/2027-02-05",
  );
  const url = new URL(buildQuoteSearchUrl({ ...historicalQuote, airlineCode: "CZ" }));
  assert.equal(url.searchParams.get("c1"), "XIY");
  assert.equal(url.searchParams.get("b1"), "XIY");
});

test("does not link to a homepage or invalid search when quote details are unusable", () => {
  for (const overrides of [
    { airlineCode: "constructor" },
    { travelDate: "2027-02-30" },
    { originCityId: "unknown" },
    { originCityId: undefined, originCode: "../PKX" },
    { destinationCityId: quote.originCityId },
  ]) {
    assert.equal(buildQuoteSearchUrl({ ...quote, airlineCode: "CA", ...overrides }), null);
  }
});

test("opens the official Air China one-way results for the requested date", () => {
  assert.equal(
    airlineAdapters.CA.buildSearchUrl({ plan: cityPlan, travelDate: "2027-02-04" }),
    airChinaUrl,
  );
});

test("opens China Southern's one-way list for the selected cities and one adult", () => {
  assert.equal(
    airlineAdapters.CZ.buildSearchUrl({ plan: cityPlan, travelDate: "2027-02-04" }),
    chinaSouthernUrl,
  );
  const fromBeijing = new URL(airlineAdapters.CZ.buildSearchUrl({
    plan: { ...cityPlan, originCityId: "city-bjs", originCityName: "北京" },
    travelDate: "2027-02-05",
  }));
  assert.equal(fromBeijing.searchParams.get("c1"), "BJS");
  assert.equal(fromBeijing.searchParams.get("b1"), "PEK-PKX");
  assert.equal(fromBeijing.searchParams.get("d1"), "2027-02-05");

  const beijingToShanghai = new URL(airlineAdapters.CZ.buildSearchUrl({
    plan: { ...cityPlan, originCityId: "city-bjs", destinationCityId: "city-sha" },
    travelDate: "2027-02-04",
  }));
  assert.equal(
    beijingToShanghai.href,
    "https://b2c.csair.com/B2C40/newTrips/static/main/page/booking/index.html?t=S&c1=BJS&c2=SHA&d1=2027-02-04&at=1&ct=0&it=0&b1=PEK-PKX&b2=SHA-PVG&orderChannel=JPSS-YDXC",
  );
});

function makeElement(text, children = {}) {
  return {
    innerText: text,
    textContent: text,
    getClientRects: () => [{}],
    querySelector: (selector) => children[selector]?.[0] ?? null,
    querySelectorAll: (selector) => children[selector] ?? [],
  };
}

function makeAirChinaRow({ flightNumbers, businessFare, economyFare, departure, arrival, layover, duration, segmentCount = flightNumbers.length }) {
  return makeElement(`${flightNumbers.join(" ")} ${departure} ${arrival} ${businessFare} ${economyFare}`, {
    '[class*="shared-flights_number__"]': flightNumbers.map((flightNumber) => makeElement(flightNumber)),
    '[class*="baseContent_aircraftWrapper__"]': Array.from({ length: segmentCount }, () => makeElement("")),
    '[class*="baseContent_layover__"]': layover ? [makeElement(layover)] : [],
    '[class*="baseContent_totalTime__"]': duration ? [makeElement(duration)] : [],
    '[class*="baseContent_departure__"] [class*="baseContent_time__"]': [makeElement(departure)],
    '[class*="baseContent_arrive__"] [class*="baseContent_time__"]': [makeElement(arrival)],
    '[class*="cabinContent_business__"] [class*="cabinContent_price__"]': [makeElement(businessFare)],
    '[class*="cabinContent_economy__"] [class*="cabinContent_price__"]': economyFare ? [makeElement(economyFare)] : [],
  });
}

const airChinaCards = [
  makeAirChinaRow({ flightNumbers: ["CA8547"], businessFare: "￥3510起", economyFare: "￥1950起", departure: "07:20", arrival: "10:25" }),
  makeAirChinaRow({ flightNumbers: ["CA1701", "CA1649"], businessFare: "￥6910起", economyFare: "￥3790起", departure: "07:00", arrival: "14:40 +1天", layover: "转 1 次" }),
  makeAirChinaRow({ flightNumbers: ["CA9923"], businessFare: "￥3580起", departure: "09:30", arrival: "12:30" }),
];

function airChinaList() {
  return makeElement("", {
    '[class*="style_tableContentWrapper__"] [class*="style_singleFightWrapper__"]': airChinaCards,
  });
}

test("collects Air China fares while leaving a visible notice open", async () => {
  let noticeClicks = 0;
  const notice = {
    ...makeElement("我知道了"),
    className: "model_btn__abc123",
    click() { noticeClicks += 1; },
  };
  const list = airChinaList();
  const response = await requestCollection({
    url: airChinaUrl,
    airlineCode: "CA",
    document: {
      body: makeElement("杭州(HGH) → 长春(CGQ)"),
      querySelectorAll(selector) {
        if (selector === '[class*="model_btn__"]') return [notice];
        return list.querySelectorAll(selector);
      },
    },
  });

  assert.equal(response.rows.length, 2);
  assert.equal(response.rows[0].listedFareCny, 1950);
  assert.equal(response.error, undefined);
  assert.equal(noticeClicks, 0);
});

function plainRows(rows) {
  return Array.from(rows, (row) => ({ ...row }));
}

test("parses Air China result cards and selects only economy fares", () => {
  assert.deepEqual(plainRows(parser.collectVisibleRows(airChinaList(), "CA")), [
    {
      flightNo: "CA8547",
      listedFareCny: 1950,
      stopCount: 0,
      transferCount: 0,
      hasStopover: false,
      stopoverName: null,
      cabin: "economy",
      fareProduct: null,
      departureTime: "07:20",
      arrivalTime: "10:25",
      arrivalDate: null,
      arrivalDayOffset: null,
      durationMinutes: null,
    },
    {
      flightNo: "CA1701+CA1649",
      listedFareCny: 3790,
      stopCount: 1,
      transferCount: 1,
      hasStopover: null,
      stopoverName: null,
      cabin: "economy",
      fareProduct: null,
      departureTime: "07:00",
      arrivalTime: "14:40",
      arrivalDate: null,
      arrivalDayOffset: 1,
      durationMinutes: null,
    },
  ]);
});

function chinaSouthernList(includeAdditionalFlight = false) {
  const makeRow = (flightNumber, economyFare, stop) => makeElement(
    `${flightNumber} 08:25 11:30 ￥3180 ￥2340 ${economyFare} ${stop ?? "直达"}`,
    { '[data-cabin="3"]': economyFare ? [makeElement(economyFare)] : [] },
  );
  const rows = [
    makeRow("CZ6541", "￥1890", "经停：武汉"),
    makeRow("CZ6542", "￥1200"),
    makeRow("CZ6543", ""),
  ];
  if (includeAdditionalFlight) {
    rows.push(makeRow("CZ6544", includeAdditionalFlight === "unpriced" ? "" : "￥1700"));
  }
  return makeElement("", {
    ".zls-flight-cell": rows,
  });
}

test("reads China Southern economy fares from live zls flight cells", () => {
  assert.deepEqual(plainRows(parser.collectVisibleRows(chinaSouthernList(), "CZ")), [
    {
      flightNo: "CZ6541",
      listedFareCny: 1890,
      stopCount: 1,
      transferCount: 0,
      hasStopover: true,
      stopoverName: "武汉",
      cabin: "economy",
      fareProduct: null,
      departureTime: "08:25",
      arrivalTime: "11:30",
      arrivalDate: null,
      arrivalDayOffset: null,
      durationMinutes: null,
    },
    {
      flightNo: "CZ6542",
      listedFareCny: 1200,
      stopCount: 0,
      transferCount: 0,
      hasStopover: false,
      stopoverName: null,
      cabin: "economy",
      fareProduct: null,
      departureTime: "08:25",
      arrivalTime: "11:30",
      arrivalDate: null,
      arrivalDayOffset: null,
      durationMinutes: null,
    },
  ]);
});

test("collects Air China total time and arrival day offset from the itinerary summary", () => {
  const card = makeAirChinaRow({
    flightNumbers: ["CA123"], economyFare: "￥1950", departure: "23:10", arrival: "+1天 01:20",
    duration: "2h10m", layover: "经停：武汉",
  });
  const [row] = parser.collectVisibleRows(makeElement("", {
    '[class*="style_tableContentWrapper__"] [class*="style_singleFightWrapper__"]': [card],
  }), "CA");
  assert.equal(row.arrivalDayOffset, 1);
  assert.equal(row.durationMinutes, 130);
  assert.equal(row.hasStopover, true);
  assert.equal(row.stopoverName, "武汉");
  assert.equal(row.transferCount, 0);
});

test("keeps China Southern overnight arrival and uses total time rather than transfer waiting time", () => {
  const card = makeElement("CZ8628 CZ6144\n中转\n22:10 01:35 +1天\n中转等待 50分钟\n总用时 3小时25分钟\n￥1950", {
    '[data-cabin="3"]': [makeElement("￥1950")],
  });
  const [row] = parser.collectVisibleRows(makeElement("", { ".zls-flight-cell": [card] }), "CZ");
  assert.equal(row.arrivalTime, "01:35");
  assert.equal(row.arrivalDayOffset, 1);
  assert.equal(row.durationMinutes, 205);
  assert.equal(row.transferCount, 1);
  assert.notEqual(row.hasStopover, true);
});

test("attaches a China Southern next-day prefix to the arrival time", () => {
  const card = makeElement("CZ8628\n08:25\n+1天 17:35\n￥1950", {
    '[data-cabin="3"]': [makeElement("￥1950")],
  });
  const [row] = parser.collectVisibleRows(makeElement("", { ".zls-flight-cell": [card] }), "CZ");
  assert.equal(row.departureTime, "08:25");
  assert.equal(row.arrivalTime, "17:35");
  assert.equal(row.arrivalDayOffset, 1);
});

test("does not read the hour after a China Southern transfer label as a stop count", () => {
  const card = makeElement("CZ8628 CZ6144\n中转\n08:25 17:35\n￥1950", {
    '[data-cabin="3"]': [makeElement("￥1950")],
  });
  const [row] = parser.collectVisibleRows(makeElement("", { ".zls-flight-cell": [card] }), "CZ");

  assert.equal(row.flightNo, "CZ8628+CZ6144");
  assert.equal(row.stopCount, 1);
  assert.equal(row.departureTime, "08:25");
});

test("uses labeled counts and actual Air China segments rather than alternate flight numbers", () => {
  const rows = [
    makeAirChinaRow({ flightNumbers: ["CA8547", "CA 8547", "CA9111"], segmentCount: 1, economyFare: "￥1950" }),
    makeAirChinaRow({ flightNumbers: ["CA1701", "CA1649"], segmentCount: 2, economyFare: "￥1950" }),
    makeAirChinaRow({ flightNumbers: ["CA1701", "CA1649", "CA3201"], segmentCount: 3, economyFare: "￥1950" }),
    makeAirChinaRow({ flightNumbers: ["CA1755"], segmentCount: 1, layover: "经停：武汉", economyFare: "￥1950" }),
    makeAirChinaRow({ flightNumbers: ["CA1801", "CA1802"], segmentCount: 2, layover: "转 2 次", economyFare: "￥1950" }),
  ];
  const list = makeElement("", {
    '[class*="style_tableContentWrapper__"] [class*="style_singleFightWrapper__"]': rows,
  });
  const parsed = plainRows(parser.collectVisibleRows(list, "CA"));

  assert.deepEqual(parsed.map(({ stopCount }) => stopCount), [0, 1, 2, 1, 2]);
  assert.equal(parsed[0].flightNo, "CA8547+CA9111");
});

test("keeps a valid China Southern price without guessing a stop count from flat flight text", () => {
  const card = makeElement("CZ8628\n实际承运 CZ6144\n08:25 17:35\n￥1950", {
    '[data-cabin="3"]': [makeElement("￥1950")],
  });
  const [row] = parser.collectVisibleRows(makeElement("", { ".zls-flight-cell": [card] }), "CZ");

  assert.equal(row.listedFareCny, 1950);
  assert.equal(row.stopCount, null);
});

test("reports candidate, flight, fare, and parsed card counts", () => {
  const result = parser.collectVisibleRowsWithDiagnostics(chinaSouthernList(), "CZ");

  assert.deepEqual(JSON.parse(JSON.stringify(result.diagnostics)), {
    candidateCount: 3,
    visibleCardCount: 3,
    flightNumberCardCount: 3,
    economyFareCardCount: 2,
    parsedRowCount: 2,
  });
});

async function createResultPage({ url, document, afterWait, onSendMessage }) {
  let listener;
  let time = 0;
  const messages = [];
  const intervals = new Map();
  const location = new URL(url);
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: {
          addListener(callback) {
            listener = callback;
          },
        },
        async sendMessage(message) {
          messages.push(structuredClone(message));
          return onSendMessage?.(message);
        },
      },
    },
    document: { querySelector: () => null, ...document },
    location,
    URL,
    Date: { now: () => time },
    setTimeout(callback, delay) {
      queueMicrotask(() => {
        time += delay;
        afterWait?.();
        callback();
      });
    },
    setInterval(callback, delay) {
      const timer = Symbol();
      intervals.set(timer, { callback, delay });
      return timer;
    },
    clearInterval(timer) {
      intervals.delete(timer);
    },
  });
  const entry = manifest.content_scripts.find(({ matches }) => matches.some(
    (pattern) => url.startsWith(pattern.slice(0, -1)),
  ));
  assert.ok(entry, `no content script for ${url}`);
  for (const file of entry.js) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    vm.runInContext(source, context);
  }
  return {
    messages,
    location,
    request: (message) => new Promise((resolve) => listener(message, {}, resolve)),
    async tickWatch(seconds) {
      await Promise.resolve();
      const stopAt = time + seconds * 1000;
      while (intervals.size && time < stopAt) {
        const [{ callback, delay }] = intervals.values();
        time += delay;
        await callback();
      }
    },
  };
}

async function requestCollection({ url, searchUrl = url, airlineCode, document, afterWait }) {
  const page = await createResultPage({ url, document, afterWait });
  return page.request(
    { type: "GET_COLLECTION_REQUEST", requestId: "run-1:0", airlineCode, searchUrl },
  );
}

test("confirms known Air China notices when fares are not available yet", async () => {
  const clickedNotices = [];
  let activeNotice = "确认，查看下一个提示";
  let waitCount = 0;
  let resultsVisible = false;
  const list = airChinaList();
  const response = await requestCollection({
    url: airChinaUrl,
    airlineCode: "CA",
    afterWait() {
      waitCount += 1;
      if (waitCount === 2) activeNotice = "我知道了";
    },
    document: {
      body: {
        get innerText() {
          return `杭州(HGH) → 长春(CGQ) ${activeNotice ?? ""}`;
        },
      },
      querySelectorAll(selector) {
        if (selector !== '[class*="model_btn__"]') {
          return resultsVisible ? list.querySelectorAll(selector) : [];
        }
        return ["确认", activeNotice].filter(Boolean).map((label) => ({
          ...makeElement(label),
          click() {
            clickedNotices.push(label);
            activeNotice = null;
            if (label === "我知道了") resultsVisible = true;
          },
        }));
      },
    },
  });

  assert.deepEqual(clickedNotices, ["确认，查看下一个提示", "我知道了"]);
  assert.equal(response.rows[0].listedFareCny, 1950);
  assert.equal(response.error, undefined);
});

test("clicks the interactive control inside an Air China notice button wrapper", async () => {
  let noticeVisible = true;
  let clickedTarget = null;
  const list = airChinaList();
  const button = {
    ...makeElement("我知道了"),
    tagName: "BUTTON",
    click() {
      clickedTarget = "button";
      noticeVisible = false;
    },
  };
  const buttonWrapper = {
    ...makeElement("我知道了"),
    className: "model_btn__abc123",
    click() { clickedTarget = "wrapper"; },
    querySelectorAll(selector) {
      return selector.startsWith("button,") ? [button] : [];
    },
  };
  const response = await requestCollection({
    url: airChinaUrl,
    airlineCode: "CA",
    document: {
      body: {
        get innerText() {
          return noticeVisible ? "您的停留时间过长" : "航班列表";
        },
      },
      querySelectorAll(selector) {
        if (selector === '[class*="model_btn__"]') {
          return noticeVisible ? [buttonWrapper] : [];
        }
        return noticeVisible ? [] : list.querySelectorAll(selector);
      },
    },
  });

  assert.equal(clickedTarget, "button");
  assert.equal(response.rows[0].listedFareCny, 1950);
  assert.equal(response.error, undefined);
});

test("confirms repeated Air China next-notice dialogs before reading fares", async () => {
  const notices = [
    { label: "确认，查看下一个提示", content: "充电宝安全提示" },
    { label: "确认，查看下一个提示", content: "行李携带提示" },
    { label: "我知道了", content: "提示结束" },
  ];
  const clickedNotices = [];
  let activeNoticeIndex = 0;
  let activeNotice = notices[activeNoticeIndex].label;
  let resultsVisible = false;
  const list = airChinaList();
  const response = await requestCollection({
    url: airChinaUrl,
    airlineCode: "CA",
    afterWait() {
      if (activeNotice === null && activeNoticeIndex < notices.length - 1) {
        activeNoticeIndex += 1;
        activeNotice = notices[activeNoticeIndex].label;
      }
    },
    document: {
      body: {
        get innerText() {
          const content = activeNotice === null ? "" : notices[activeNoticeIndex].content;
          return `杭州(HGH) → 长春(CGQ) ${content}`;
        },
      },
      querySelectorAll(selector) {
        if (selector !== '[class*="model_btn__"]') {
          return resultsVisible ? list.querySelectorAll(selector) : [];
        }
        if (activeNotice === null) return [];
        const label = activeNotice;
        return [{
          ...makeElement(label),
          click() {
            clickedNotices.push(label);
            activeNotice = null;
            if (label === "我知道了") resultsVisible = true;
          },
        }];
      },
    },
  });

  assert.deepEqual(clickedNotices, notices.map(({ label }) => label));
  assert.equal(response.rows[0].listedFareCny, 1950);
  assert.equal(response.error, undefined);
});

test("opens Air China's re-query form and submits it before collecting results", async () => {
  let requeryCount = 0;
  let searchCount = 0;
  let results;
  const requeryWrapper = {
    ...makeElement("重新查询"),
    tagName: "DIV",
    className: "result-search-wrapper",
    click() { requeryCount += 1; },
  };
  const requeryButton = {
    ...makeElement("重新查询"),
    tagName: "BUTTON",
    click() { requeryCount += 1; },
  };
  const searchWrapper = {
    ...makeElement("查询"),
    tagName: "DIV",
    className: "search-button-wrapper",
    click() { searchCount += 1; },
  };
  const searchButton = {
    ...makeElement("查询"),
    tagName: "BUTTON",
    click() { searchCount += 1; },
  };
  const response = await requestCollection({
    url: airChinaUrl,
    airlineCode: "CA",
    afterWait() {
      if (searchCount === 1) results = airChinaList();
    },
    document: {
      body: { get innerText() { return results ? "航班列表" : "查询无结果"; } },
      querySelectorAll(selector) {
        if (selector.startsWith("button,")) {
          if (requeryCount === 0) return [requeryWrapper, requeryButton];
          if (searchCount === 0) return [searchWrapper, searchButton];
          return [];
        }
        if (selector === '[class*="model_btn__"]') return [];
        return results?.querySelectorAll(selector) ?? [];
      },
    },
  });

  assert.equal(requeryCount, 1);
  assert.equal(searchCount, 1);
  assert.equal(response.rows[0].listedFareCny, 1950);
  assert.equal(response.error, undefined);
});

test("continues past the China Southern important notice before reading fares", async () => {
  let noticeVisible = true;
  let confirmationCount = 0;
  let activatedControl;
  const confirmationWrapper = {
    ...makeElement("继续"),
    tagName: "DIV",
    className: "dialog-button-wrapper",
    click() { activatedControl = "wrapper"; },
  };
  const confirmationButton = {
    ...makeElement("继续"),
    tagName: "BUTTON",
    click() {
      activatedControl = "button";
      confirmationCount += 1;
      noticeVisible = false;
    },
  };
  const dialog = {
    className: "trave-dialog",
    parentElement: null,
    querySelectorAll(selector) {
      if (selector.startsWith("button,") && noticeVisible) {
        return [confirmationWrapper, confirmationButton];
      }
      return [];
    },
  };
  const dialogContent = {
    className: "trave-dialog-content",
    parentElement: dialog,
    querySelectorAll: () => [],
  };
  const noticeBody = {
    innerText: "重要提示 舱位及价格实时变动。机型仅供参考，以实际航班为准。",
    textContent: "重要提示 舱位及价格实时变动。机型仅供参考，以实际航班为准。",
    getClientRects: () => noticeVisible ? [{}] : [],
    querySelector(selector) {
      return selector === ".subTitle" ? makeElement("重要提示") : null;
    },
    get parentElement() { return dialogContent; },
  };
  const list = chinaSouthernList();
  const response = await requestCollection({
    url: chinaSouthernUrl,
    airlineCode: "CZ",
    document: {
      body: makeElement("航班列表"),
      querySelectorAll(selector) {
        if (selector === ".trave-dialog-body") return noticeVisible ? [noticeBody] : [];
        if (noticeVisible) return [];
        return list.querySelectorAll(selector);
      },
    },
  });

  assert.equal(confirmationCount, 1);
  assert.equal(activatedControl, "button");
  assert.equal(response.rows.length, 2);
  assert.equal(response.error, undefined);
});

test("does not click page-level confirmation outside the China Southern notice", async () => {
  let confirmationClicks = 0;
  const unrelatedConfirmation = {
    ...makeElement("确认"),
    tagName: "BUTTON",
    click() { confirmationClicks += 1; },
  };
  const page = {
    className: "page-root",
    parentElement: null,
    querySelectorAll(selector) {
      return selector.startsWith("button,") ? [unrelatedConfirmation] : [];
    },
  };
  const dialog = {
    className: "trave-dialog",
    parentElement: page,
    querySelectorAll: () => [],
  };
  const noticeBody = {
    innerText: "重要提示 舱位及价格实时变动。机型仅供参考，以实际航班为准。",
    textContent: "重要提示 舱位及价格实时变动。机型仅供参考，以实际航班为准。",
    getClientRects: () => [{}],
    querySelector: (selector) => selector === ".subTitle" ? makeElement("重要提示") : null,
    get parentElement() { return dialog; },
  };
  const response = await requestCollection({
    url: chinaSouthernUrl,
    airlineCode: "CZ",
    document: {
      body: makeElement("重要提示"),
      querySelectorAll(selector) {
        if (selector === ".trave-dialog-body") return [noticeBody];
        return [];
      },
    },
  });

  assert.equal(confirmationClicks, 0);
  assert.match(response.error, /南航重要提示未确认/);
});

test("does not treat a generic dialog wrapper as the China Southern dialog", async () => {
  let confirmationClicks = 0;
  const unrelatedConfirmation = {
    ...makeElement("确认"),
    tagName: "BUTTON",
    click() { confirmationClicks += 1; },
  };
  const wrapper = {
    className: "trave-dialog-wrapper",
    parentElement: null,
    querySelectorAll(selector) {
      return selector.startsWith("button,") ? [unrelatedConfirmation] : [];
    },
  };
  const content = {
    className: "trave-dialog-content",
    parentElement: wrapper,
    querySelectorAll: () => [],
  };
  const noticeBody = {
    innerText: "重要提示 舱位及价格实时变动。机型仅供参考，以实际航班为准。",
    textContent: "重要提示 舱位及价格实时变动。机型仅供参考，以实际航班为准。",
    getClientRects: () => [{}],
    querySelector: (selector) => selector === ".subTitle" ? makeElement("重要提示") : null,
    get parentElement() { return content; },
  };
  const response = await requestCollection({
    url: chinaSouthernUrl,
    airlineCode: "CZ",
    document: {
      body: makeElement("重要提示"),
      querySelectorAll: (selector) => selector === ".trave-dialog-body" ? [noticeBody] : [],
    },
  });

  assert.equal(confirmationClicks, 0);
  assert.match(response.error, /南航重要提示未确认/);
});

test("retries the China Southern confirmation when its button appears late", async () => {
  let noticeVisible = true;
  let confirmationAvailable = false;
  let confirmationClicks = 0;
  const confirmationButton = {
    ...makeElement("确定"),
    tagName: "BUTTON",
    click() {
      confirmationClicks += 1;
      noticeVisible = false;
    },
  };
  const dialog = {
    className: "trave-dialog",
    parentElement: null,
    querySelectorAll(selector) {
      return selector.startsWith("button,") && confirmationAvailable ? [confirmationButton] : [];
    },
  };
  const noticeBody = {
    innerText: "重要提示 舱位及价格实时变动。机型仅供参考，以实际航班为准。",
    textContent: "重要提示 舱位及价格实时变动。机型仅供参考，以实际航班为准。",
    getClientRects: () => noticeVisible ? [{}] : [],
    querySelector: (selector) => selector === ".subTitle" ? makeElement("重要提示") : null,
    get parentElement() { return dialog; },
  };
  const list = chinaSouthernList();
  const response = await requestCollection({
    url: chinaSouthernUrl,
    airlineCode: "CZ",
    afterWait() { confirmationAvailable = true; },
    document: {
      body: makeElement("重要提示"),
      querySelectorAll(selector) {
        if (selector === ".trave-dialog-body") return noticeVisible ? [noticeBody] : [];
        return noticeVisible ? [] : list.querySelectorAll(selector);
      },
    },
  });

  assert.equal(confirmationClicks, 1);
  assert.equal(response.rows.length, 2);
  assert.equal(response.error, undefined);
});

test("does not accept a China Southern result for a different departure date", async () => {
  const response = await requestCollection({
    url: chinaSouthernUrl.replace("2027-02-04", "2027-02-05"),
    searchUrl: chinaSouthernUrl,
    airlineCode: "CZ",
    document: { ...chinaSouthernList(), body: makeElement("") },
  });
  assert.equal(response.rows.length, 0);
  assert.match(response.error, /不匹配/);
});

test("waits for the China Southern list to render instead of reopening the search form", async () => {
  let list;
  const response = await requestCollection({
    url: chinaSouthernUrl,
    airlineCode: "CZ",
    afterWait() { list = chinaSouthernList(); },
    document: {
      body: { get innerText() { return list ? "航班列表" : "暂无航班"; } },
      querySelectorAll: (selector) => list?.querySelectorAll(selector) ?? [],
    },
  });
  assert.equal(response.rows.length, 2);
  assert.equal(response.rows[0].sourceUrl, chinaSouthernUrl);
});

test("waits for a partially rendered China Southern list to finish growing", async () => {
  let list;
  let waitCount = 0;
  const response = await requestCollection({
    url: chinaSouthernUrl,
    airlineCode: "CZ",
    afterWait() {
      waitCount += 1;
      if (waitCount === 1) list = chinaSouthernList();
      if (waitCount === 3) list = chinaSouthernList(true);
    },
    document: {
      body: { get innerText() { return list ? "航班列表" : "正在加载"; } },
      querySelectorAll: (selector) => list?.querySelectorAll(selector) ?? [],
    },
  });

  assert.deepEqual([...response.rows].map(({ flightNo }) => flightNo), [
    "CZ6541",
    "CZ6542",
    "CZ6544",
  ]);
  assert.equal(response.diagnostics.parsedRowCount, 3);
});

test("waits when a visible China Southern card gains its fare after the initial rows", async () => {
  let list;
  let waitCount = 0;
  const response = await requestCollection({
    url: chinaSouthernUrl,
    airlineCode: "CZ",
    afterWait() {
      waitCount += 1;
      if (waitCount === 1) list = chinaSouthernList();
      if (waitCount === 5) list = chinaSouthernList("unpriced");
      if (waitCount === 6) list = chinaSouthernList(true);
    },
    document: {
      body: { get innerText() { return list ? "航班列表" : "正在加载"; } },
      querySelectorAll: (selector) => list?.querySelectorAll(selector) ?? [],
    },
  });

  assert.deepEqual([...response.rows].map(({ flightNo }) => flightNo), [
    "CZ6541",
    "CZ6542",
    "CZ6544",
  ]);
});

test("reports the still-visible Air China notice and click count on timeout", async () => {
  let clickCount = 0;
  const notice = {
    ...makeElement("我知道了"),
    className: "model_btn__abc123",
    click() { clickCount += 1; },
  };
  const response = await requestCollection({
    url: airChinaUrl,
    airlineCode: "CA",
    document: {
      body: makeElement("停留时间过长"),
      querySelectorAll(selector) {
        return selector === '[class*="model_btn__"]' ? [notice] : [];
      },
    },
  });

  assert.equal(clickCount, 1);
  assert.match(response.error, /我知道了/);
  assert.match(response.error, /点击.*1/);
  assert.equal(response.diagnostics.visibleNoticeLabels.join(","), "我知道了");
  assert.equal(response.diagnostics.noticeClickCount, 1);
});

test("pauses for human verification without reading or operating on the page", async () => {
  const response = await requestCollection({
    url: airChinaUrl,
    airlineCode: "CA",
    afterWait() { assert.fail("must not poll a verification page"); },
    document: {
      body: makeElement("请完成安全验证"),
      querySelectorAll() { assert.fail("must not operate on a verification page"); },
    },
  });
  assert.deepEqual({ ...response }, {
    type: "COLLECTION_PAUSED",
    requestId: "run-1:0",
    airlineCode: "CA",
    reason: "human-verification",
  });
});

const airChinaVerificationRequest = {
  requestId: "run-1:0",
  airlineCode: "CA",
  searchUrl: airChinaUrl,
};

test("reconnects a reloaded verification tab and reports only stable results for the original search", async () => {
  let pageText = "请完成安全验证";
  let cards = airChinaCards;
  const page = await createResultPage({
    url: airChinaUrl,
    onSendMessage: ({ type }) => type === "GET_VERIFICATION_WATCH" ? airChinaVerificationRequest : { accepted: true },
    document: {
      body: { get innerText() { return pageText; } },
      querySelectorAll(selector) {
        assert.equal(pageText, "杭州(HGH) → 长春(CGQ)", "do not inspect or click controls on the verification page");
        assert.notEqual(selector, '[class*="model_btn__"]', "the verification watcher must not acknowledge notices");
        return selector.includes("style_singleFightWrapper__") ? cards : [];
      },
    },
  });
  const readyMessages = () => page.messages.filter(({ type }) => type === "VERIFICATION_RESULTS_READY");
  await page.tickWatch(2);
  assert.equal(readyMessages().length, 0);

  pageText = "杭州(HGH) → 长春(CGQ)";
  page.location.pathname = "/flight/oneway/hgh-cgq/2027-02-05";
  await page.tickWatch(2);
  assert.equal(readyMessages().length, 0);

  page.location.pathname = "/flight/oneway/hgh-pek/2027-02-04";
  await page.tickWatch(2);
  assert.equal(readyMessages().length, 0);

  page.location.pathname = new URL(airChinaUrl).pathname;
  cards = [];
  await page.tickWatch(2);
  assert.equal(readyMessages().length, 0);

  cards = airChinaCards.slice(0, 1);
  await page.tickWatch(0.5);
  cards = airChinaCards;
  await page.tickWatch(0.5);
  assert.equal(readyMessages().length, 0);
  await page.tickWatch(2);
  await page.tickWatch(2);

  assert.equal(readyMessages().length, 1);
  assert.equal(readyMessages()[0].requestId, "run-1:0");
  assert.deepEqual(readyMessages()[0].rows.map(({ flightNo }) => flightNo), ["CA8547", "CA1701+CA1649"]);
});

test("watches an existing verification document when the pause has been stored", async () => {
  const list = airChinaList();
  const page = await createResultPage({
    url: airChinaUrl,
    onSendMessage: ({ type }) => type === "VERIFICATION_RESULTS_READY" ? { accepted: true } : null,
    document: { ...list, body: makeElement("杭州(HGH) → 长春(CGQ)") },
  });

  const response = await Promise.race([
    page.request({ type: "WATCH_VERIFICATION_RESULTS", ...airChinaVerificationRequest }),
    new Promise((resolve) => setImmediate(() => resolve(null))),
  ]);
  assert.equal(response?.watching, true);
  await page.tickWatch(2);
  assert.equal(page.messages.filter(({ type }) => type === "VERIFICATION_RESULTS_READY").length, 1);
});

test("parses Chinese yuan fares and comma-separated amounts", () => {
  assert.equal(parser.parseListedFare("票面价 ¥ 1,280"), 1280);
  assert.equal(parser.parseListedFare("CNY 2,450.50"), 2450.5);
  assert.equal(parser.parseListedFare("￥699"), 699);
  assert.equal(parser.parseListedFare("￥1950起"), 1950);
  assert.equal(parser.parseListedFare("CNY 2450.50"), 2450.5);
});

test("recognizes nonstop, same-flight stops, and changes of flight separately", () => {
  assert.equal(parser.parseRoute("直达").stopCount, 0);
  assert.equal(parser.parseRoute("经停 1 次").transferCount, 0);
  assert.equal(parser.parseRoute("经停 1 次").hasStopover, true);
  assert.equal(parser.parseRoute("中转").transferCount, 1);
  assert.equal(parser.parseRoute("转 2 次").transferCount, 2);
  assert.equal(parser.parseRoute("转\n12:40").transferCount, 1);
  assert.equal(parser.parseRoute("中转·成都，另有经停·潍坊").transferCount, 1);
  assert.equal(parser.parseRoute("中转·成都，另有经停·潍坊").stopoverName, "潍坊");
  assert.equal(parser.parseRoute("经停·威海（无需中转）", 1).transferCount, 0);
  assert.equal(parser.parseRoute("1 stop").hasStopover, null);
});

test("parses only rows with an airline flight number and a clear fare", () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        parser.parseFlightRow(
          {
            flightText: "中国国际航空 CA 1234",
            fareText: "￥1,288",
            routeText: "直飞",
            cabin: "economy",
          },
          "CA",
        ),
      ),
    ),
    {
      flightNo: "CA1234",
      listedFareCny: 1288,
      stopCount: 0,
      transferCount: 0,
      hasStopover: false,
      stopoverName: null,
      cabin: "economy",
      fareProduct: null,
      departureTime: null,
      arrivalTime: null,
      arrivalDate: null,
      arrivalDayOffset: null,
      durationMinutes: null,
    },
  );
  assert.equal(
    parser.parseFlightRow(
      { flightText: "CA1234", fareText: "税费合计 ￥1,500", routeText: "直达" },
      "CA",
    ),
    null,
  );
  assert.equal(
    parser.parseFlightRow(
      { flightText: "中国国际航空", fareText: "￥1,280", routeText: "直达" },
      "CA",
    ),
    null,
  );
});

test("rejects prices without an explicit CNY marker", () => {
  assert.equal(parser.parseListedFare("1,280"), null);
  assert.equal(parser.parseListedFare("暂无报价"), null);
});
