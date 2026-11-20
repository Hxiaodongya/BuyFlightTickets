(function installFlightResultCollector() {
  const parser = globalThis.FlightPriceParser;
  const airline = {
    "www.airchina.com.cn": { code: "CA", name: "国航" },
    "b2c.csair.com": { code: "CZ", name: "南航" },
    "www.loongair.cn": { code: "GJ", name: "长龙航空" },
  }[location.hostname];
  if (!airline) return;
  const loongAir = airline.code === "GJ" ? globalThis.FlightTrackerLoongAir : null;
  if (airline.code === "GJ" && !loongAir) return;

  const nextNotice = "确认，查看下一个提示";
  const finalNotice = "我知道了";
  const resultStableDuration = 1_000;
  let verificationWatch;
  const actionControlSelector = [
    "button",
    '[role="button"]',
    "a",
    "[tabindex]",
    "[onclick]",
    '[class*="btn" i]',
    '[class*="button" i]',
    '[class*="query" i]',
    '[class*="search" i]',
  ].join(",");

  function normalizeLabel(element) {
    return String(element?.innerText ?? element?.textContent ?? "")
      .replaceAll(/\s+/g, "")
      .replaceAll(/[▼▾⌄∨]/g, "");
  }

  function isInteractiveControl(element) {
    return ["BUTTON", "A"].includes(String(element.tagName ?? "").toUpperCase()) ||
      element.getAttribute?.("role") === "button" ||
      element.hasAttribute?.("tabindex") ||
      element.hasAttribute?.("onclick");
  }

  function preferInteractiveControl(elements) {
    return elements.find(isInteractiveControl) ?? elements[0] ?? null;
  }

  function findAirChinaNotice() {
    for (const noticeElement of document.querySelectorAll('[class*="model_btn__"]')) {
      const label = normalizeLabel(noticeElement);
      if ((label !== nextNotice && label !== finalNotice) || noticeElement.getClientRects().length === 0) {
        continue;
      }

      const nestedControls = [...noticeElement.querySelectorAll(actionControlSelector)]
        .filter((element) => element.getClientRects().length > 0)
        .filter((element) => normalizeLabel(element) === label)
        .filter(isInteractiveControl);
      const button = preferInteractiveControl(nestedControls) ?? noticeElement;
      return {
        button,
        label,
        signature: getAirChinaNoticeSignature(noticeElement, label),
      };
    }
    return null;
  }

  function getVisibleAirChinaNoticeLabels() {
    if (airline.code !== "CA") return [];
    return [...document.querySelectorAll('[class*="model_btn__"]')]
      .filter((element) => element.getClientRects().length > 0)
      .map(normalizeLabel)
      .filter(Boolean)
      .slice(0, 4);
  }

  function formatCollectionDiagnostics(diagnostics) {
    const details = [
      `卡片 ${diagnostics.visibleCardCount}/${diagnostics.candidateCount}`,
      `含航班号 ${diagnostics.flightNumberCardCount}`,
      `含经济舱价 ${diagnostics.economyFareCardCount}`,
      `识别 ${diagnostics.parsedRowCount}`,
    ];
    if (diagnostics.visibleNoticeLabels?.length) {
      details.push(`提示按钮 ${diagnostics.visibleNoticeLabels.join("/")}`);
    }
    if (Number.isInteger(diagnostics.noticeClickCount)) {
      details.push(`点击 ${diagnostics.noticeClickCount} 次`);
    }
    return `（${details.join("，")}）`;
  }

  function makeCollectionError(message, diagnostics) {
    const error = new Error(`${message}${formatCollectionDiagnostics(diagnostics)}`);
    error.diagnostics = diagnostics;
    return error;
  }

  function getAirChinaNoticeSignature(button, label) {
    let container = button.parentElement;
    while (container && container !== document.body) {
      const content = normalizeLabel(container);
      if (content && content !== label) return content;
      container = container.parentElement;
    }
    return normalizeLabel(document.body) || label;
  }

  function findAirChinaRequeryButton() {
    const controls = [...document.querySelectorAll(actionControlSelector)]
      .filter((element) => element.getClientRects().length > 0);
    const exactMatches = controls.filter((element) => normalizeLabel(element) === "重新查询");
    const labeledMatches = exactMatches.length > 0
      ? exactMatches
      : controls.filter((element) => normalizeLabel(element).startsWith("重新查询"));
    return preferInteractiveControl(labeledMatches);
  }

  function findAirChinaSearchButton() {
    const controls = [...document.querySelectorAll(actionControlSelector)]
      .filter((element) => element.getClientRects().length > 0);
    const exactMatches = controls.filter((element) => normalizeLabel(element) === "查询");
    const labeledMatches = exactMatches.length > 0
      ? exactMatches
      : controls.filter((element) => normalizeLabel(element).startsWith("查询"));
    return preferInteractiveControl(labeledMatches);
  }

  function findChinaSouthernNotice() {
    for (const body of document.querySelectorAll(".trave-dialog-body")) {
      if (body.getClientRects().length === 0) continue;
      const title = normalizeLabel(body.querySelector(".subTitle"));
      const content = normalizeLabel(body);
      if (
        title !== "重要提示" ||
        !content.includes("舱位及价格实时变动") ||
        !content.includes("机型仅供参考")
      ) {
        continue;
      }

      let dialog = body.parentElement;
      while (dialog) {
        const className = String(dialog.className ?? "");
        const hasDialogContainerClass = className.split(/\s+/).includes("trave-dialog");
        if (dialog.getAttribute?.("role") === "dialog" || hasDialogContainerClass) {
          break;
        }
        dialog = dialog.parentElement;
      }
      let container = body;
      let button = null;
      while (dialog && container) {
        const matchingButtons = [...(container.querySelectorAll?.(actionControlSelector) ?? [])]
          .filter((element) => element.getClientRects().length > 0)
          .filter((element) => ["确认", "确定", "继续", "知道了", "我知道了"].includes(normalizeLabel(element)));
        button = preferInteractiveControl(matchingButtons);
        if (button || container === dialog) break;
        container = container.parentElement;
      }
      return {
        button,
        label: "南航重要提示",
      };
    }
    return null;
  }

  function matchesSearch(expectedUrl) {
    if (loongAir) return loongAir.matchesResult(expectedUrl);
    const currentUrl = new URL(location.href);
    return currentUrl.origin === expectedUrl.origin &&
      currentUrl.pathname === expectedUrl.pathname &&
      [...expectedUrl.searchParams].every(([name, value]) => currentUrl.searchParams.get(name) === value);
  }

  function detectCurrentPageIssue(options) {
    return loongAir
      ? loongAir.getPageIssue(options)
      : parser.detectPageIssue(document.body?.innerText, options);
  }

  function watchVerificationResults(request) {
    if (!request?.requestId || request.airlineCode !== airline.code || !request.searchUrl) return false;
    if (verificationWatch?.requestId === request.requestId) return true;
    if (verificationWatch) clearInterval(verificationWatch.timer);

    const expectedUrl = new URL(request.searchUrl);
    let signature = null;
    let stableSince;
    let sending = false;
    const timer = setInterval(async () => {
      if (sending) return;
      if (!matchesSearch(expectedUrl) || loongAir?.isLoading() || detectCurrentPageIssue()) {
        signature = null;
        return;
      }
      const collection = parser.collectVisibleRowsWithDiagnostics(document, airline.code);
      if (!collection.rows.length) {
        signature = null;
        return;
      }
      const currentSignature = JSON.stringify(collection);
      if (currentSignature !== signature) {
        stableSince = Date.now();
        signature = currentSignature;
        return;
      }
      if (Date.now() - stableSince < resultStableDuration) return;

      sending = true;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "VERIFICATION_RESULTS_READY",
          requestId: request.requestId,
          airlineCode: airline.code,
          ...collection,
        });
        if (!response?.retry) {
          clearInterval(timer);
          if (verificationWatch?.timer === timer) verificationWatch = undefined;
        }
      } catch {
        signature = null;
      } finally {
        sending = false;
      }
    }, 500);
    verificationWatch = { requestId: request.requestId, timer };
    return true;
  }

  async function waitForResults(searchUrl) {
    const expectedUrl = new URL(searchUrl);
    if (loongAir) {
      const submission = await loongAir.submitSearch(expectedUrl);
      if (submission.pauseReason) return submission;
    }
    const deadline = Date.now() + 25_000;
    const acknowledged = new Set();
    let airChinaNoticeSequenceStarted = false;
    let airChinaNoticeSequenceComplete = false;
    let requeryTriggered = false;
    let searchSubmitted = false;
    let lastRowsSignature = null;
    let rowsStableSince = null;
    let latestRows = [];
    let noticeClickCount = 0;
    let latestDiagnostics = {
      candidateCount: 0,
      visibleCardCount: 0,
      flightNumberCardCount: 0,
      economyFareCardCount: 0,
      parsedRowCount: 0,
      noticeClickCount,
      visibleNoticeLabels: [],
    };

    while (true) {
      const pageIssue = detectCurrentPageIssue({ includeNoFlights: false });
      if (pageIssue?.reason === "human-verification") return { pauseReason: pageIssue.reason };
      if (pageIssue) throw new Error(pageIssue.message);
      if (!matchesSearch(expectedUrl)) {
        throw new Error(`${airline.name}结果页与查询的航线或日期不匹配，未保存价格`);
      }

      const collection = parser.collectVisibleRowsWithDiagnostics(document, airline.code);
      const isLoongAirLoading = loongAir?.isLoading();
      latestRows = isLoongAirLoading ? [] : collection.rows;
      const notice = airline.code === "CA" && latestRows.length > 0
        ? null
        : airline.code === "CA"
          ? findAirChinaNotice()
          : airline.code === "CZ" ? findChinaSouthernNotice() : null;
      if (airline.code === "CA" && notice?.label === nextNotice) {
        airChinaNoticeSequenceStarted = true;
      }
      const acknowledgmentKey = airline.code === "CA" ? notice?.signature : notice?.label;
      if (notice?.button && !acknowledged.has(acknowledgmentKey)) {
        notice.button.click();
        noticeClickCount += 1;
        acknowledged.add(acknowledgmentKey);
        if (airline.code === "CA" && notice.label === finalNotice) {
          airChinaNoticeSequenceComplete = true;
        }
      }
      const waitingForNotice = Boolean(notice) ||
        (airline.code === "CA" && latestRows.length === 0 &&
          airChinaNoticeSequenceStarted && !airChinaNoticeSequenceComplete);
      latestDiagnostics = {
        ...collection.diagnostics,
        ...(airline.code === "CA"
          ? {
              noticeClickCount,
              visibleNoticeLabels: getVisibleAirChinaNoticeLabels(),
            }
          : {}),
      };
      if (!waitingForNotice) {
        if (latestRows.length > 0) {
          const signature = JSON.stringify({
            rows: latestRows,
            diagnostics: collection.diagnostics,
          });
          if (signature !== lastRowsSignature) {
            lastRowsSignature = signature;
            rowsStableSince = Date.now();
          } else if (Date.now() - rowsStableSince >= resultStableDuration) {
            return {
              rows: latestRows.map((row) => ({ ...row, sourceUrl: location.href })),
              diagnostics: latestDiagnostics,
            };
          }
        } else {
          lastRowsSignature = null;
          rowsStableSince = null;
        }

        if (latestRows.length === 0 && airline.code === "CA" && !requeryTriggered) {
          const button = findAirChinaRequeryButton();
          if (button) {
            requeryTriggered = true;
            button.click();
          }
        } else if (latestRows.length === 0 && airline.code === "CA" && !searchSubmitted) {
          const button = findAirChinaSearchButton();
          if (button) {
            searchSubmitted = true;
            button.click();
          }
        }
      }

      if (Date.now() >= deadline) {
        if (isLoongAirLoading) {
          throw makeCollectionError("长龙航空官网航班列表仍在加载，未保存价格", latestDiagnostics);
        }
        const message = waitingForNotice
          ? airline.code === "CA"
            ? "国航官网提示未关闭，未保存价格"
            : "南航重要提示未确认，未保存价格"
          : latestRows.length > 0
            ? "航班列表仍在变化，未保存不完整结果"
          : airline.code === "CA" && !requeryTriggered
            ? "未找到国航“重新查询”按钮，未触发查询"
            : airline.code === "CA" && !searchSubmitted
              ? "未找到国航“查询”按钮，未提交查询"
              : detectCurrentPageIssue()?.message ?? `未识别到${airline.name}航班列表中的经济舱票面价`;
        throw makeCollectionError(message, latestDiagnostics);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === "OPEN_LOONG_AIR_QUOTE" && loongAir) {
      loongAir.submitSearch(new URL(request.searchUrl)).then(
        sendResponse,
        (error) => sendResponse({ error: error.message }),
      );
      return true;
    }
    if (request?.type === "WATCH_VERIFICATION_RESULTS") {
      sendResponse({ watching: watchVerificationResults(request) });
      return false;
    }
    if (request?.type !== "GET_COLLECTION_REQUEST" || request.airlineCode !== airline.code) {
      return false;
    }

    const response = {
      type: "COLLECTION_RESULT",
      requestId: request.requestId,
      airlineCode: airline.code,
    };
    waitForResults(request.searchUrl).then(
      ({ rows, diagnostics, pauseReason }) => sendResponse(pauseReason
        ? { ...response, type: "COLLECTION_PAUSED", reason: pauseReason }
        : { ...response, rows, diagnostics }),
      (error) => sendResponse({
        ...response,
        rows: [],
        diagnostics: error.diagnostics,
        error: error.message,
      }),
    );
    return true;
  });

  chrome.runtime.sendMessage({ type: "GET_VERIFICATION_WATCH" })
    .then(watchVerificationResults)
    .catch(() => {});
})();
