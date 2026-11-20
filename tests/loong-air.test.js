import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as collector from "../src/background/collector.js";
import { airlineAdapters, buildQuoteSearchUrl } from "../src/collectors/airline-config.js";
import { normalizeObservations, normalizePlan } from "../src/shared/domain.js";

const plan = {
  id: "plan-gj",
  originCityId: "city-hgh",
  destinationCityId: "city-cgq",
  airlineCodes: ["GJ"],
  travelDates: ["2027-02-04"],
};
const travelDate = plan.travelDates[0];
const quote = { ...plan, airlineCode: "GJ", travelDate, sourceUrl: "https://www.loongair.cn/" };
const searchUrl = "https://www.loongair.cn/?flightTrackerFrom=HGH&flightTrackerTo=CGQ&flightTrackerDate=2027-02-04#/web/home";
const resultHash = "#/web/ticket/search";
const contents = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const manifest = JSON.parse(await contents("manifest.json"));
const parserSource = await contents("src/collectors/price-parser.js");
const parser = vm.runInNewContext(`${parserSource}\nglobalThis.FlightPriceParser`);
const cardSelector = ".search .flights .flight_item";
const loadingMaskSelector = ".search .flights > .el-loading-mask";
const fareSelector = ".right li:has(> b.eco) > h4";
const formSelector = ".menu_box_search .search_form_row";
const citySelector = ".search_group_cities .select_citylist input";
const dateSelector = ".date_box .el-date-editor input";
const travelNotice = [
  "出行提示",
  "防诈骗提醒",
  "长龙航空不会以“改签退票、行李异常、积分兑换”等名义向旅客索要银行卡号和验证码、要求转账汇款。",
  "关闭",
].join("\n");

function element(text = "", children = {}, properties = {}) {
  return {
    innerText: text,
    getClientRects: () => [{}],
    querySelector: (selector) => children[selector]?.[0] ?? null,
    querySelectorAll: (selector) => children[selector] ?? [],
    ...properties,
  };
}

function flightCard({
  flights, economyFare, route = "", tax = false, duration = "", dates = [],
  times = ["09:10", "12:05 +1"],
}) {
  const heading = element(`${flights.join(" ")} 09:10 12:05 ￥2490 ${economyFare ?? ""}`, {
    ".left .top .icomoon": flights.map((flight) => element(`${flight}-320`)),
    ".center_trip": [element(route)],
    ".center .center_item .time p": times.map((time) => element(time)),
    ".center .center_item .date": dates.map((date) => element(date)),
    ".center .center_arrow_wrap .stop_over": [element(duration)],
    ".right .tax_total_tip": tax ? [element("含税总价")] : [],
    [fareSelector]: economyFare ? [element(economyFare)] : [],
  });
  return element(heading.innerText, { ".fight_card": [heading] });
}

test("supports a Loong Air-only plan and its economy price history", () => {
  const normalized = normalizePlan(plan);
  assert.deepEqual(normalized.airlineCodes, ["GJ"]);
  const [observation] = normalizeObservations(normalized, "GJ", [
    { flightNo: "GJ8851", listedFareCny: 890, stopCount: 0 },
  ], "2026-11-19T13:00:00Z");
  assert.equal(observation.airlineName, "长龙航空");
  assert.equal(observation.travelDate, travelDate);
  assert.equal(observation.cabin, "economy");
});

test("uses the requested route and travel date for both Loong Air collection and jumps", () => {
  assert.equal(airlineAdapters.GJ.buildSearchUrl({ plan, travelDate }), searchUrl);
  assert.equal(buildQuoteSearchUrl(quote), searchUrl);
  assert.equal(buildQuoteSearchUrl({ ...quote, travelDate: "2027-02-30" }), null);
  const differentQuote = new URL(buildQuoteSearchUrl({ ...quote, originCityId: "city-bjs", travelDate: "2027-02-05" }));
  assert.equal(differentQuote.searchParams.get("flightTrackerFrom"), "BJS");
  assert.equal(differentQuote.searchParams.get("flightTrackerDate"), "2027-02-05");
});

test("reads only visible untaxed Loong Air economy prices and counts real segments", () => {
  const cards = [
    flightCard({ flights: ["GJ8851"], economyFare: "￥890起" }),
    flightCard({ flights: ["GJ8021", "EU2245"], economyFare: "￥1,220 起", route: "中转·成都" }),
    flightCard({ flights: ["GJ8951"], economyFare: "￥1290", tax: true }),
    flightCard({ flights: ["GJ8235"] }),
    { ...flightCard({ flights: ["GJ8115"], economyFare: "￥590" }), getClientRects: () => [] },
  ];
  const collection = parser.collectVisibleRowsWithDiagnostics(element("", { [cardSelector]: cards }), "GJ");
  const { rows, diagnostics } = JSON.parse(JSON.stringify(collection));
  assert.deepEqual(rows.map(({ flightNo, listedFareCny, stopCount, departureTime, arrivalTime }) =>
    [flightNo, listedFareCny, stopCount, departureTime, arrivalTime]), [
    ["GJ8851", 890, 0, "09:10", "12:05"],
    ["GJ8021+EU2245", 1220, 1, "09:10", "12:05"],
  ]);
  assert.deepEqual(diagnostics, {
    candidateCount: 5,
    visibleCardCount: 4,
    flightNumberCardCount: 4,
    economyFareCardCount: 2,
    parsedRowCount: 2,
  });
});

test("reads the dates, elapsed time, and same-flight stopover from the Loong Air itinerary", () => {
  const dates = ["2027-02-05", "2027-02-05"];
  const cards = [
    flightCard({ flights: ["GJ8577"], economyFare: "￥1650", route: "经停·潍坊", times: ["06:40", "11:05"], duration: "4时25分", dates }),
    flightCard({ flights: ["GJ8087"], economyFare: "￥1650", times: ["17:10", "20:15"], duration: "3时5分", dates }),
    flightCard({ flights: ["GJ8021", "EU2245"], economyFare: "￥1220", route: "中转·成都" }),
  ];
  const rows = JSON.parse(JSON.stringify(parser.collectVisibleRows(element("", { [cardSelector]: cards }), "GJ")));
  assert.deepEqual(rows.map(({ departureTime, arrivalTime, arrivalDate, durationMinutes, hasStopover, stopoverName, transferCount }) =>
    [departureTime, arrivalTime, arrivalDate, durationMinutes, hasStopover, stopoverName, transferCount]), [
    ["06:40", "11:05", "2027-02-05", 265, true, "潍坊", 0],
    ["17:10", "20:15", "2027-02-05", 185, false, null, 0],
    ["09:10", "12:05", null, null, null, null, 1],
  ]);
});

async function createPage({
  challenge = "",
  challengeAfterSubmit = "",
  resultNotice = "",
  missingDestination = false,
  emptyFirstOriginLookup = false,
  originSuggestionDelay = 0,
  backgroundTab = false,
  resultLoadingMaskClasses = null,
  cards = [flightCard({ flights: ["GJ8851"], economyFare: "￥890" })],
} = {}) {
  const location = new URL(searchUrl);
  const actions = [];
  const cityFocusEvents = [];
  const messages = [];
  let now = 0;
  let listener;
  let watch;
  let submitted;
  let openCityList;
  let activeElement;
  function formInput(properties) {
    return Object.assign(new EventTarget(), element("", {}, {
      focus() {
        if (activeElement === this) return;
        activeElement = this;
        if (!backgroundTab) this.dispatchEvent(new Event("focus"));
      },
      ...properties,
    }));
  }
  const makeCityInput = (target, name, differentCode) => {
    let modelValue = "";
    let requestCount = 0;
    let readyAt = 0;
    let activated = false;
    const input = formInput({
      value: "",
      closest: () => ({ getAttribute: () => `el-autocomplete-${target}` }),
    });
    input.addEventListener("focus", () => {
      activated = true;
      cityFocusEvents.push(target);
    });
    input.addEventListener("input", () => {
      if (input.value === modelValue) return;
      const value = input.value;
      queueMicrotask(() => { modelValue = value; });
      actions.push(`type:${value}`);
      openCityList = value ? target : null;
      if (!value) return;
      requestCount += 1;
      readyAt = now + (target === "HGH" ? originSuggestionDelay : 0);
    });
    const option = (code, label) => element(label, {
      ".AirportCode": [element("中国"), element(code)],
    }, {
      click() {
        actions.push(`select:${code}`);
        input.value = label;
        input.code = `citycode-${code}`;
        openCityList = null;
      },
    });
    const options = [option(differentCode, "错误的建议"), ...(name ? [option(target, name)] : [])];
    const isLoading = () => openCityList === target && now < readyAt;
    const hasSuggestions = () => !(target === "HGH" && emptyFirstOriginLookup && requestCount === 1);
    const list = element("", {}, {
      classList: { contains: (className) => className === "is-loading" && isLoading() },
      getClientRects: () => activated && openCityList === target && (isLoading() || hasSuggestions()) ? [{}] : [],
      querySelectorAll: (selector) => selector === ".city" && !isLoading() && hasSuggestions() ? options : [],
    });
    return { input, list };
  };
  const origin = makeCityInput("HGH", "杭州", "HLD");
  const destination = makeCityInput("CGQ", missingDestination ? "" : "长春", "CNI");
  const dateInput = formInput({ value: "2026-11-20" });
  dateInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    actions.push(`date:${dateInput.value}`);
    dateInput.date = dateInput.value;
  });
  const submit = element("机票查询", {}, {
    click() {
      actions.push("submit");
      submitted = {
        istab: 0,
        indexJumpInfo: { AirportFrom: origin.input.code, AirportTo: destination.input.code, DepartureTime: dateInput.date },
      };
      challenge = challengeAfterSubmit;
      location.hash = resultHash;
    },
  });
  const form = element("", {
    [citySelector]: [origin.input, destination.input],
    [dateSelector]: [dateInput],
    ".hero_primary_btn": [submit],
  });
  const loadingMask = resultLoadingMaskClasses && element("", {}, {
    classList: { contains: (className) => resultLoadingMaskClasses.includes(className) },
  });
  const entry = manifest.content_scripts.find(({ matches }) =>
    matches.some((pattern) => searchUrl.startsWith(pattern.slice(0, -1))));
  assert.ok(entry, "the Loong Air tab must have an injected content script");
  const context = vm.createContext({
    chrome: { runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      async sendMessage(message) { messages.push(structuredClone(message)); return { accepted: true }; },
    } },
    document: {
      get activeElement() { return activeElement; },
      body: {
        get innerText() {
          return ["长龙航空机票预订", location.hash === resultHash ? resultNotice : "", challenge].join("\n");
        },
      },
      querySelector(selector) {
        if (location.hash === resultHash) return selector === loadingMaskSelector ? loadingMask : null;
        return selector === formSelector ? form : null;
      },
      querySelectorAll: (selector) => selector === cardSelector && location.hash === resultHash ? cards : [],
      getElementById(id) {
        if (id === "el-autocomplete-HGH") return origin.list;
        if (id === "el-autocomplete-CGQ") return destination.list;
        return null;
      },
    },
    sessionStorage: { getItem: () => JSON.stringify(submitted ?? null) },
    location,
    URL,
    Date: { now: () => now },
    Event,
    KeyboardEvent: class extends Event {
      constructor(type, options) {
        super(type, options);
        this.key = options.key;
      }
    },
    setTimeout(callback, duration) { now += duration; queueMicrotask(callback); },
    setInterval(callback) { watch = callback; return 1; },
    clearInterval() { watch = null; },
  });
  for (const file of entry.js) vm.runInContext(await contents(file), context, { filename: file });
  return {
    actions,
    cityFocusEvents,
    messages,
    location,
    clearChallenge() { challenge = ""; },
    changeSubmittedDate(date) { submitted.indexJumpInfo.DepartureTime = date; },
    async tick() { now += 500; await watch?.(); },
    async request(extra) {
      return structuredClone(await new Promise((resolve) => listener({
        type: "GET_COLLECTION_REQUEST", airlineCode: "GJ", requestId: "test:0", searchUrl, ...extra,
      }, {}, resolve)));
    },
  };
}

test("fills the normal Loong Air form once before collecting results", async () => {
  const page = await createPage();
  const response = await page.request();
  assert.deepEqual(page.cityFocusEvents, ["HGH", "CGQ"]);
  assert.deepEqual(page.actions, ["type:HGH", "select:HGH", "type:CGQ", "select:CGQ", `date:${travelDate}`, "submit"]);
  assert.equal(page.location.hash, resultHash);
  assert.equal(response.type, "COLLECTION_RESULT");
  assert.equal(response.rows[0].flightNo, "GJ8851");
  assert.equal(response.rows[0].listedFareCny, 890);
});

test("opens Loong Air city suggestions when a background tab changes focus without a native event", async () => {
  const page = await createPage({ backgroundTab: true });
  const response = await page.request();
  assert.equal(response.error, undefined);
  assert.deepEqual(page.cityFocusEvents, ["HGH", "CGQ"]);
  assert.equal(page.actions.filter((action) => action === "submit").length, 1);
  assert.equal(response.rows[0].flightNo, "GJ8851");
});

test("retries an empty Loong Air origin lookup before submitting the flight search once", async () => {
  const page = await createPage({ emptyFirstOriginLookup: true });
  const response = await page.request();
  assert.equal(response.type, "COLLECTION_RESULT");
  assert.equal(response.error, undefined);
  assert.deepEqual(page.actions, [
    "type:HGH", "type:", "type:HGH", "select:HGH", "type:CGQ", "select:CGQ", `date:${travelDate}`, "submit",
  ]);
});

test("waits for a slow Loong Air city lookup without repeating the request while it loads", async () => {
  const page = await createPage({ originSuggestionDelay: 6_000 });
  const response = await page.request();
  assert.equal(response.type, "COLLECTION_RESULT");
  assert.equal(response.error, undefined);
  assert.deepEqual(page.actions, ["type:HGH", "select:HGH", "type:CGQ", "select:CGQ", `date:${travelDate}`, "submit"]);
});

test("collects Loong Air economy fares while the anti-fraud travel notice stays open", async () => {
  const expected = [["GJ6075", 1880], ["GJ8087", 1650], ["GJ8105", 1880]];
  const page = await createPage({
    resultNotice: travelNotice,
    cards: expected.map(([flightNo, fare]) => flightCard({ flights: [flightNo], economyFare: `￥${fare}起` })),
  });
  const response = await page.request();
  assert.equal(response.type, "COLLECTION_RESULT");
  assert.deepEqual(response.rows.map(({ flightNo, listedFareCny }) => [flightNo, listedFareCny]), expected);
});

test("collects all Loong Air fares while the finished loading mask fades out", async () => {
  const page = await createPage({
    backgroundTab: true,
    resultLoadingMaskClasses: ["el-loading-mask", "el-loading-fade-leave", "el-loading-fade-leave-active"],
    cards: [
      flightCard({ flights: ["GJ6075"], economyFare: "￥1880起" }),
      flightCard({ flights: ["GJ8087"], economyFare: "￥1650起" }),
      flightCard({ flights: ["GJ8105"], economyFare: "￥1880起" }),
    ],
  });
  const response = await page.request();
  assert.equal(response.error, undefined);
  assert.deepEqual(response.rows.map(({ flightNo, listedFareCny }) => [flightNo, listedFareCny]), [
    ["GJ6075", 1880], ["GJ8087", 1650], ["GJ8105", 1880],
  ]);
});

test("reports active Loong Air loading without returning already visible fares", async () => {
  const page = await createPage({ resultLoadingMaskClasses: ["el-loading-mask"] });
  const response = await page.request();
  assert.deepEqual(response.rows, []);
  assert.equal(response.diagnostics.parsedRowCount, 1);
  assert.match(response.error, /长龙航空官网航班列表仍在加载/);
});

test("does not select another city or submit when the exact city is unavailable", async () => {
  const page = await createPage({ missingDestination: true });
  const response = await page.request();
  assert.deepEqual(response.rows, []);
  assert.match(response.error, /CGQ/);
  assert.deepEqual(page.actions, ["type:HGH", "select:HGH", "type:CGQ", "type:", "type:CGQ"]);
});

test("does not operate the Loong Air form during visible human verification", async () => {
  const page = await createPage({ challenge: "请完成安全验证" });
  assert.equal((await page.request()).type, "COLLECTION_PAUSED");
  assert.deepEqual(page.actions, []);
});

test("only resumes verified Loong Air rows for the original submitted search", async () => {
  const page = await createPage({ resultNotice: travelNotice, challengeAfterSubmit: "请输入验证码" });
  const paused = await page.request();
  assert.equal(paused.type, "COLLECTION_PAUSED");
  assert.equal(paused.reason, "human-verification");
  assert.equal(paused.rows, undefined);
  assert.equal((await page.request({ type: "WATCH_VERIFICATION_RESULTS" })).watching, true);
  const ready = () => page.messages.filter(({ type }) => type === "VERIFICATION_RESULTS_READY");
  for (let tick = 0; tick < 4; tick += 1) await page.tick();
  assert.equal(ready().length, 0);
  page.clearChallenge();
  page.changeSubmittedDate("2027-02-05");
  for (let tick = 0; tick < 4; tick += 1) await page.tick();
  assert.equal(ready().length, 0);
  page.changeSubmittedDate(travelDate);
  for (let tick = 0; tick < 4; tick += 1) await page.tick();
  assert.equal(ready().length, 1);
  assert.equal(page.actions.filter((action) => action === "submit").length, 1);
});

test("jumps to the Loong Air search without starting a collection", async () => {
  const calls = [];
  const tabs = {
    async create(options) { calls.push(options); return { id: 42, status: "complete" }; },
    async sendMessage(tabId, request, options) {
      calls.push({ tabId, request, options });
      const page = await createPage();
      const response = await page.request(request);
      assert.equal(page.location.hash, resultHash);
      assert.equal(response.rows, undefined);
      return response;
    },
  };
  assert.deepEqual(await collector.openLoongAirQuoteSearch(tabs, quote), { submitted: true });
  assert.deepEqual(calls, [
    { url: searchUrl, active: true },
    { tabId: 42, request: { type: "OPEN_LOONG_AIR_QUOTE", searchUrl }, options: { frameId: 0 } },
  ]);
});

test("waits for the Loong Air content script without repeating an already received request", async () => {
  let messages = 0;
  const tabs = {
    async create() { return { id: 42, status: "complete" }; },
    async sendMessage() {
      messages += 1;
      if (messages === 1) throw new Error("Could not establish connection. Receiving end does not exist.");
      return { submitted: true };
    },
  };
  assert.deepEqual(await collector.openLoongAirQuoteSearch(tabs, quote), { submitted: true });
  assert.equal(messages, 2);

  messages = 0;
  tabs.sendMessage = async () => {
    messages += 1;
    throw new Error("The message port closed before a response was received.");
  };
  await assert.rejects(collector.openLoongAirQuoteSearch(tabs, quote), /message port closed/);
  assert.equal(messages, 1);
});
