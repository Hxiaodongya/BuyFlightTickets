(function installLoongAirSearch() {
  const homeHash = "#/web/home";
  const resultsHash = "#/web/ticket/search";
  const formSelector = ".menu_box_search .search_form_row";
  const citySuggestionRetryDelay = 4_000;
  const challengeFrames = 'iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[title*="验证"]';
  const antiFraudCodeMention = /(长龙航空不会以[^。！？]{0,100}向旅客索要银行卡号和)验证\s*码/g;
  const parser = globalThis.FlightPriceParser;

  const visible = (element) => Boolean(element?.getClientRects().length);
  const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 150));
  const textOf = (element) => String(element?.innerText ?? element?.textContent ?? "").trim();

  function getSearchFields(url) {
    const from = url.searchParams.get("flightTrackerFrom");
    const to = url.searchParams.get("flightTrackerTo");
    const date = url.searchParams.get("flightTrackerDate");
    if (!/^[A-Z]{3}$/.test(from ?? "") || !/^[A-Z]{3}$/.test(to ?? "") || from === to ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return null;
    return { from, to, date };
  }

  function matchesTrackerTab(expectedUrl) {
    const current = new URL(location.href);
    return expectedUrl.origin === "https://www.loongair.cn" && expectedUrl.pathname === "/" &&
      expectedUrl.hash === homeHash && current.origin === expectedUrl.origin &&
      current.pathname === expectedUrl.pathname && current.search === expectedUrl.search;
  }

  function matchesResult(expectedUrl) {
    const fields = getSearchFields(expectedUrl);
    if (!fields || !matchesTrackerTab(expectedUrl) || location.hash !== resultsHash) return false;
    try {
      const submitted = JSON.parse(sessionStorage.getItem("indexSearchInfo"));
      const { AirportFrom, AirportTo, DepartureTime } = submitted?.indexJumpInfo ?? {};
      const codeOf = (value) => String(value ?? "").replace(/^citycode-/i, "").toUpperCase();
      return submitted?.istab === 0 && codeOf(AirportFrom) === fields.from &&
        codeOf(AirportTo) === fields.to && DepartureTime === fields.date;
    } catch {
      return false;
    }
  }

  function getPageIssue(options) {
    const text = document.body?.innerText ?? "";
    if (/人机验证|拖动滑块|拖动下方滑块|security verification/i.test(text) ||
        [...document.querySelectorAll(challengeFrames)].some(visible)) {
      return { reason: "human-verification" };
    }
    return parser.detectPageIssue(text.replace(antiFraudCodeMention, "$1"), options);
  }

  function focusInput(input) {
    let focusReceived = false;
    const recordFocus = () => { focusReceived = true; };
    const capture = { capture: true };
    input.addEventListener("focus", recordFocus, capture);
    input.focus();
    input.removeEventListener("focus", recordFocus, capture);
    if (!focusReceived) input.dispatchEvent(new Event("focus"));
  }

  function typeValue(input, value) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function chooseCity(input, code, waitFor) {
    const waitForInput = () => waitFor(() => visible(input) && !input.disabled, "长龙航空的城市输入框已不可用");
    const waitForOption = (retryAt = Infinity) => waitFor(() => {
      const listId = input.closest(".el-autocomplete")?.getAttribute("aria-owns");
      const list = listId ? document.getElementById(listId) : null;
      if (list?.classList.contains("is-loading")) return null;
      const option = visible(list)
        ? [".city", ".airport"].flatMap((selector) => [...list.querySelectorAll(selector)])
          .find((item) => visible(item) && [...item.querySelectorAll(".AirportCode")].some((label) => textOf(label) === code))
        : null;
      return option || Date.now() >= retryAt ? { option } : null;
    }, `等待长龙航空官网城市联想超时，未出现匹配 ${code} 的城市或机场选项`);

    focusInput(input);
    await waitForRender();
    await waitForInput();
    typeValue(input, code);
    let selection = await waitForOption(Date.now() + citySuggestionRetryDelay);
    if (!selection.option) {
      await waitForInput();
      focusInput(input);
      typeValue(input, "");
      await waitForRender();
      await waitForInput();
      typeValue(input, code);
      selection = await waitForOption();
    }
    selection.option.click();
    await waitFor(() => input.value && input.value !== code, `长龙航空未确认选择 ${code}`);
  }

  async function submitSearch(expectedUrl) {
    const fields = getSearchFields(expectedUrl);
    const deadline = Date.now() + 16_000;
    if (!fields || !matchesTrackerTab(expectedUrl)) throw new Error("长龙航空查询页与请求不匹配");

    function checkPage() {
      const issue = getPageIssue({ includeNoFlights: false });
      if (issue?.reason) throw Object.assign(new Error("长龙航空需要人工验证"), { pauseReason: issue.reason });
      if (issue) throw new Error(issue.message);
      if (!matchesTrackerTab(expectedUrl)) throw new Error("长龙航空查询已离开原标签页地址");
    }

    async function waitFor(lookup, errorMessage) {
      do {
        checkPage();
        const match = lookup();
        if (match) return match;
        await waitForRender();
      } while (Date.now() < deadline);
      throw new Error(errorMessage);
    }

    try {
      checkPage();
      if (matchesResult(expectedUrl)) return { submitted: true };
      if (location.hash !== homeHash) throw new Error("长龙航空结果与原航线或日期不匹配");
      const { cities, dateInput, submit } = await waitFor(() => {
        const form = document.querySelector(formSelector);
        if (!visible(form)) return null;
        const cities = [...form.querySelectorAll(".search_group_cities .select_citylist input")].filter(visible);
        const dateInput = form.querySelector(".date_box .el-date-editor input");
        const submit = form.querySelector(".hero_primary_btn");
        if (cities.length !== 2 || !visible(dateInput) || !visible(submit) || submit.disabled) return null;
        return { cities, dateInput, submit };
      }, "未找到长龙航空官网的机票查询表单");

      await chooseCity(cities[0], fields.from, waitFor);
      await chooseCity(cities[1], fields.to, waitFor);
      checkPage();
      if (dateInput.value !== fields.date) {
        focusInput(dateInput);
        await waitForRender();
        checkPage();
        typeValue(dateInput, fields.date);
        dateInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
        await waitForRender();
      }
      checkPage();
      if (dateInput.value !== fields.date || location.hash !== homeHash) {
        throw new Error("长龙航空未确认指定的出行日期，未提交查询");
      }
      if (!visible(submit) || submit.disabled) throw new Error("长龙航空的查询按钮已不可用");
      submit.click();
      await waitFor(() => matchesResult(expectedUrl), "长龙航空未进入指定航线和日期的查询结果");
      return { submitted: true };
    } catch (error) {
      if (error.pauseReason) return { pauseReason: error.pauseReason };
      throw error;
    }
  }

  globalThis.FlightTrackerLoongAir = Object.freeze({
    submitSearch,
    matchesResult,
    getPageIssue,
    isLoading() {
      const mask = document.querySelector(".search .flights > .el-loading-mask");
      return visible(mask) && !mask.classList.contains("el-loading-fade-leave-active");
    },
  });
})();
