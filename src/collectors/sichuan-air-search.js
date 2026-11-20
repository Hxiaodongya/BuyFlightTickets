(function installSichuanAirSearch() {
  const visible = (element) => element?.getClientRects().length > 0;
  const parser = globalThis.FlightPriceParser;
  const airportPattern = /^[A-Z]{3}$/;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const calendarSelector = "#ui-datepicker-div";
  let submitting = false;

  function getSearchFields(searchUrl) {
    const expected = new URL(searchUrl);
    const current = new URL(location.href);
    const from = expected.searchParams.get("flightTrackerFrom");
    const to = expected.searchParams.get("flightTrackerTo");
    const date = expected.searchParams.get("flightTrackerDate");
    if (expected.origin !== "https://www.sichuanair.com" || expected.pathname !== "/" ||
        current.origin !== expected.origin || current.pathname !== expected.pathname ||
        ![...expected.searchParams].every(([name, value]) => current.searchParams.get(name) === value) ||
        !airportPattern.test(from) || !airportPattern.test(to) || from === to || !datePattern.test(date)) {
      throw new Error("四川航空查询页与请求不匹配");
    }
    return { from, to, date };
  }

  function getPageIssue() {
    return parser.detectPageIssue(document.body?.innerText, { includeNoFlights: false });
  }

  function checkPageIssue() {
    const issue = getPageIssue();
    if (issue?.reason) throw Object.assign(new Error("四川航空需要人工验证"), { pauseReason: issue.reason });
    if (issue) throw new Error(issue.message);
  }

  function focusInput(input) {
    let receivedFocus = false;
    const recordFocus = () => { receivedFocus = true; };
    input.addEventListener("focus", recordFocus);
    input.focus();
    input.removeEventListener("focus", recordFocus);
    if (!receivedFocus) input.dispatchEvent(new Event("focus"));
  }

  async function chooseAirport(form, direction, code, cityName, waitFor) {
    const name = `Search/OriginDestinationInformation/${direction}/location`;
    const input = form.querySelector(`input[name="${name}_input"]`);
    const selected = form.querySelector(`input[name="${name}"]`);
    const options = input?.closest(".location-component");
    if (!visible(input) || !selected || !options) throw new Error("四川航空官网未显示机场选择框");
    const cityIdPrefix = `CITY_${code}_`;
    const isConfirmed = () => selected.value === code || selected.value.startsWith(cityIdPrefix);
    if (isConfirmed() && input.value) return;

    const query = cityName || code;
    focusInput(input);
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: query.at(-1), keyCode: query.charCodeAt(query.length - 1), bubbles: true,
    }));
    const optionSelector = `li[id^="${cityIdPrefix}"], li[_3code="${code}"]`;
    const option = await waitFor(() => [...options.querySelectorAll(optionSelector)].find(visible),
      `四川航空官网未提供 ${code} 机场选项`);
    option.click();
    await waitFor(isConfirmed, `四川航空官网未确认 ${code} 机场`);
  }

  async function chooseDate(form, date, waitFor) {
    const input = form.querySelector('input[name="Search/DateInformation/departDate_display"]');
    if (!visible(input)) throw new Error("四川航空官网未显示出发日期选择框");

    const [year, month, day] = date.split("-").map(Number);
    input.value = date;
    focusInput(input);
    input.dispatchEvent(new Event("keyup", { bubbles: true }));
    const daySelector = `${calendarSelector} td[data-handler="selectDay"][data-year="${year}"][data-month="${month - 1}"] a`;
    const dayLink = await waitFor(() => [...document.querySelectorAll(daySelector)]
      .find((link) => visible(link) && Number(link.textContent.trim()) === day),
    `四川航空官网未提供 ${date} 的出发日期选项`);
    dayLink.click();
    await waitFor(() => input.value === date && !visible(document.querySelector(calendarSelector)),
      `四川航空官网未确认出发日期 ${date}`);
  }

  async function prepareSearch({ searchUrl, originName, destinationName }) {
    const { from, to, date } = getSearchFields(searchUrl);

    async function waitFor(lookup, errorMessage) {
      const deadline = Date.now() + 5_000;
      do {
        checkPageIssue();
        const match = lookup();
        if (match) return match;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      throw new Error(errorMessage);
    }

    const form = await waitFor(() => {
      const element = document.querySelector("#searchForm");
      return visible(element?.querySelector("a.sensor-search")) ? element : null;
    }, "未找到四川航空官网的机票查询表单");
    const oneWay = document.querySelector("#flightoneway");
    if (!oneWay) throw new Error("四川航空官网未显示单程查询选项");
    if (!oneWay.checked) oneWay.click();
    await chooseAirport(form, "Origin", from, originName, waitFor);
    await chooseAirport(form, "Destination", to, destinationName, waitFor);
    await chooseDate(form, date, waitFor);
    checkPageIssue();

    const passengerCount = (kind) => form.querySelector(`input[name="Search/Passengers/${kind}"]`)?.value;
    const submit = form.querySelector("a.sensor-search");
    if (!oneWay.checked || passengerCount("adults") !== "1" || passengerCount("children") !== "0" ||
        passengerCount("infants") !== "0" || !visible(submit)) {
      throw new Error("四川航空官网未确认单程、1 名成人的查询条件");
    }
    return submit;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === "GET_SICHUAN_SEARCH_ISSUE") {
      const issue = getPageIssue();
      sendResponse(issue?.reason ? { pauseReason: issue.reason } : { error: issue?.message });
      return false;
    }
    if (request?.type !== "SUBMIT_SICHUAN_AIR_SEARCH") return false;
    if (submitting) {
      sendResponse({ error: "四川航空官网正在提交查询" });
      return false;
    }
    submitting = true;
    prepareSearch(request).then((submit) => {
      sendResponse({ submitted: true });
      setTimeout(() => {
        try {
          if (!getPageIssue()) submit.click();
        } finally {
          submitting = false;
        }
      }, 0);
    }, (error) => {
      submitting = false;
      sendResponse(error.pauseReason ? { pauseReason: error.pauseReason } : { error: error.message });
    });
    return true;
  });
})();
