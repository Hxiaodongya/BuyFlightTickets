(function installChinaSouthernCollector() {
  const parser = globalThis.FlightPriceParser;
  const cityForm = globalThis.FlightCityForm;
  const pendingSearchKey = "__flight_price_tracker_pending_search__";

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
      if (!cityForm) {
        sendResponse({
          type: "COLLECTION_RESULT",
          requestId: request.requestId,
          airlineCode: "CZ",
          rows: [],
          error: "南航城市查询组件不可用，未提交搜索",
        });
        return false;
      }
      cityForm.prepareSearch(request, "南航")
        .then((searchButton) => {
          sessionStorage.setItem(pendingSearchKey, JSON.stringify(request));
          sendResponse({
            type: "COLLECTION_PENDING",
            requestId: request.requestId,
            airlineCode: "CZ",
          });
          searchButton.click();
          continuePendingSearch(request);
        })
        .catch((error) => {
          sendResponse({
            type: "COLLECTION_RESULT",
            requestId: request.requestId,
            airlineCode: "CZ",
            rows: [],
            error: error.message,
          });
        });
      return true;
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
