(function installAirChinaCollector() {
  const parser = globalThis.FlightPriceParser;

  function waitForResults(timeoutMs = 20_000) {
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

        const rows = parser.collectVisibleRows(document, "CA");
        if (rows.length > 0) {
          finish(null, rows);
          return;
        }
        if (Date.now() >= deadline) {
          finish(new Error("未识别到国航航班列表中的明确票面价"));
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

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type !== "GET_COLLECTION_REQUEST" || request.airlineCode !== "CA") {
      return false;
    }

    waitForResults()
      .then((rows) =>
        sendResponse({
          type: "COLLECTION_RESULT",
          requestId: request.requestId,
          airlineCode: "CA",
          rows: rows.map((row) => ({ ...row, sourceUrl: location.href })),
        }),
      )
      .catch((error) =>
        sendResponse({
          type: "COLLECTION_RESULT",
          requestId: request.requestId,
          airlineCode: "CA",
          rows: [],
          error: error.message,
        }),
      );
    return true;
  });
})();
