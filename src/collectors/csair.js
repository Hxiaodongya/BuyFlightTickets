(function installChinaSouthernCollector() {
  const parser = globalThis.FlightPriceParser;
  const pendingSearchKey = "__flight_price_tracker_pending_search__";

  function describe(element) {
    if (!element) {
      return "";
    }
    const label = element.id
      ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.innerText
      : "";
    return [
      element.name,
      element.id,
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      label,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function findInput(pattern) {
    return [...document.querySelectorAll("input, select")].find((input) =>
      pattern.test(describe(input)),
    );
  }

  function setValue(element, value) {
    if (!element || element.readOnly || element.disabled) {
      return false;
    }
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setCabin(element, cabin) {
    const cabinPatterns = {
      economy: /经济|economy|coach/i,
      business: /公务|商务|business/i,
      first: /头等|first/i,
    };
    if (element instanceof HTMLSelectElement) {
      const option = [...element.options].find((candidate) =>
        cabinPatterns[cabin].test(`${candidate.value} ${candidate.textContent}`),
      );
      if (!option) {
        return false;
      }
      return setValue(element, option.value);
    }
    const labels = { economy: "经济舱", business: "公务舱", first: "头等舱" };
    return setValue(element, labels[cabin]);
  }

  function setPassengerCount(element, count) {
    if (element instanceof HTMLSelectElement) {
      const option = [...element.options].find((candidate) => {
        const value = candidate.value.trim();
        const label = candidate.textContent.trim();
        return value === String(count) || label === String(count) ||
          label === `${count}位成人` || label === `${count}成人`;
      });
      return option ? setValue(element, option.value) : false;
    }
    return setValue(element, String(count));
  }

  function findAirportInput(pattern) {
    return findInput(pattern);
  }

  function prepareSearch(request) {
    const oneWay = [...document.querySelectorAll('button, [role="tab"], label')].find(
      (element) => /^单程$/.test(element.innerText?.trim() ?? ""),
    );
    oneWay?.click();

    const origin = findAirportInput(/origin|from|出发/);
    const destination = findAirportInput(/destination|to|到达/);
    const departureDate =
      document.querySelector('input[type="date"]') ||
      findInput(/depart.*date|date.*depart|出发日期|日期/);

    if (!origin || !destination || !departureDate) {
      throw new Error("未识别到南航公开单程查询表单，未提交搜索");
    }
    if (
      !setValue(origin, request.plan.originCode) ||
      !setValue(destination, request.plan.destinationCode) ||
      !setValue(departureDate, request.travelDate)
    ) {
      throw new Error("南航查询表单不允许设置公开查询条件，未提交搜索");
    }

    const passengerInput = findInput(/adult|passenger|成人|乘客/);
    if (request.plan.adultCount !== 1 && !passengerInput) {
      throw new Error("未识别到南航成人乘客数选项，未提交搜索");
    }
    if (passengerInput && !setPassengerCount(passengerInput, request.plan.adultCount)) {
      throw new Error("无法设置南航成人乘客数，未提交搜索");
    }

    const cabinInput = [...document.querySelectorAll("select, input")].find((input) =>
      /cabin|舱位/i.test(describe(input)),
    );
    if (request.plan.cabin !== "economy" && !cabinInput) {
      throw new Error("未识别到南航舱位选项，未提交搜索");
    }
    if (cabinInput) {
      if (!setCabin(cabinInput, request.plan.cabin)) {
        throw new Error("无法设置南航舱位，未提交搜索");
      }
    }

    const searchButton = [...document.querySelectorAll('button, input[type="submit"]')].find(
      (element) => /^(查询|搜索|搜索航班)$/.test(
        (element.innerText || element.value || "").trim(),
      ),
    );
    if (!searchButton) {
      throw new Error("未识别到南航查询按钮，未提交搜索");
    }
    return searchButton;
  }

  function waitForResults(timeoutMs = 25_000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      let observer;
      let timer;

      const finish = (error, rows) => {
        observer?.disconnect();
        clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve(rows);
        }
      };

      const check = () => {
        const error = parser.detectPageError(document.body?.innerText);
        if (error) {
          finish(new Error(error));
          return;
        }

        const rows = parser.collectVisibleRows(document, "CZ");
        if (rows.length > 0) {
          finish(null, rows);
          return;
        }
        if (Date.now() >= deadline) {
          finish(new Error("未识别到南航航班列表中的明确票面价"));
          return;
        }
        timer = setTimeout(check, 500);
      };

      observer = new MutationObserver(check);
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      check();
    });
  }

  async function pushResult(request, rows, error = null) {
    try {
      await chrome.runtime.sendMessage({
        type: "COLLECTION_RESULT_PUSH",
        requestId: request.requestId,
        airlineCode: "CZ",
        rows: rows.map((row) => ({ ...row, sourceUrl: location.href })),
        ...(error ? { error: error.message } : {}),
      });
    } finally {
      try {
        const pending = JSON.parse(sessionStorage.getItem(pendingSearchKey) ?? "null");
        if (pending?.requestId === request.requestId) {
          sessionStorage.removeItem(pendingSearchKey);
        }
      } catch {
        sessionStorage.removeItem(pendingSearchKey);
      }
    }
  }

  function continuePendingSearch(request) {
    void waitForResults()
      .then((rows) => pushResult(request, rows))
      .catch((error) => pushResult(request, [], error));
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type !== "GET_COLLECTION_REQUEST" || request.airlineCode !== "CZ") {
      return false;
    }

    const pageError = parser.detectPageError(document.body?.innerText);
    if (pageError) {
      sendResponse({
        type: "COLLECTION_RESULT",
        requestId: request.requestId,
        airlineCode: "CZ",
        rows: [],
        error: pageError,
      });
      return false;
    }

    if (parser.collectVisibleRows(document, "CZ").length === 0) {
      try {
        const searchButton = prepareSearch(request);
        sessionStorage.setItem(pendingSearchKey, JSON.stringify(request));
        sendResponse({
          type: "COLLECTION_PENDING",
          requestId: request.requestId,
          airlineCode: "CZ",
        });
        searchButton.click();
        continuePendingSearch(request);
      } catch (error) {
        sendResponse({
          type: "COLLECTION_RESULT",
          requestId: request.requestId,
          airlineCode: "CZ",
          rows: [],
          error: error.message,
        });
      }
      return false;
    }

    waitForResults()
      .then((rows) =>
        sendResponse({
          type: "COLLECTION_RESULT",
          requestId: request.requestId,
          airlineCode: "CZ",
          rows: rows.map((row) => ({ ...row, sourceUrl: location.href })),
        }),
      )
      .catch((error) =>
        sendResponse({
          type: "COLLECTION_RESULT",
          requestId: request.requestId,
          airlineCode: "CZ",
          rows: [],
          error: error.message,
        }),
      );
    return true;
  });

  try {
    const pendingRequest = JSON.parse(sessionStorage.getItem(pendingSearchKey) ?? "null");
    if (pendingRequest?.type === "GET_COLLECTION_REQUEST" && pendingRequest.airlineCode === "CZ") {
      continuePendingSearch(pendingRequest);
    }
  } catch {
    sessionStorage.removeItem(pendingSearchKey);
  }
})();
