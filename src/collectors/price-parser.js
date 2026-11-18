(function installFlightPriceParser(root) {
  const FLIGHT_NUMBER_PATTERN = /\b(?:CA|CZ)\s*\d{2,4}\b/gi;
  const CNY_FARE_PATTERN = /(?:CNY\s*|[¥￥]\s*)(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;

  function parseListedFare(value) {
    const text = String(value ?? "").trim();
    if (!text || /(税费|含税|总价|总额|合计|服务费)/i.test(text)) {
      return null;
    }

    const match = text.match(CNY_FARE_PATTERN);
    if (!match) {
      return null;
    }

    const fare = Number(match[1].replaceAll(",", ""));
    return Number.isFinite(fare) && fare > 0 ? fare : null;
  }

  function parseStopCount(value) {
    const text = String(value ?? "");
    if (/直达|直飞|nonstop|non-stop|direct/i.test(text)) {
      return 0;
    }

    const explicitCount = text.match(/(?:经停|中转|stop)\s*(\d+)\s*(?:次|站|stop)?/i);
    if (explicitCount) {
      return Number(explicitCount[1]);
    }
    if (/经停|中转|transfer|\bstop\b/i.test(text)) {
      return 1;
    }
    return null;
  }

  function parseFlightRow(record, airlineCode) {
    const code = String(airlineCode ?? "").toUpperCase();
    const flightText = String(record.flightNo ?? record.flightText ?? "");
    const flightNumbers = [...new Set(
      flightText.match(FLIGHT_NUMBER_PATTERN) ?? [],
    )]
      .map((value) => value.replaceAll(/\s+/g, "").toUpperCase())
      .filter((value) => value.startsWith(code));
    const flightNo = flightNumbers.join("+");
    const listedFareCny = parseListedFare(record.fareText);
    const stopCount = Number.isInteger(record.stopCount)
      ? record.stopCount
      : parseStopCount(record.routeText);

    if (!flightNo || listedFareCny === null || stopCount === null || stopCount < 0) {
      return null;
    }

    return {
      flightNo,
      listedFareCny,
      stopCount,
      cabin: record.cabin || null,
      fareProduct: record.fareProduct || null,
      departureTime: record.departureTime || null,
      arrivalTime: record.arrivalTime || null,
    };
  }

  function isVisible(element) {
    if (!element || typeof element.getClientRects !== "function") {
      return true;
    }
    return element.getClientRects().length > 0;
  }

  function collectVisibleRows(document, airlineCode) {
    const selector = [
      "li",
      "tr",
      "article",
      "[data-flight]",
      '[class*="flight-item" i]',
      '[class*="flightItem"]',
      '[class*="flight-list" i] > *',
      '[class*="flightList"] > *',
    ].join(",");
    const candidates = [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .sort((left, right) => left.textContent.length - right.textContent.length);
    const collected = new Map();

    for (const candidate of candidates) {
      const flightText = candidate.innerText || candidate.textContent || "";
      const matchedFlightNumbers = [...new Set(
        flightText.match(FLIGHT_NUMBER_PATTERN) ?? [],
      )]
        .map((value) => value.replaceAll(/\s+/g, "").toUpperCase())
        .filter((value) => value.startsWith(airlineCode));
      if (matchedFlightNumbers.length === 0) {
        continue;
      }

      const fareNodes = [
        ...candidate.querySelectorAll(
          '[class*="price" i], [class*="fare" i], [data-price]',
        ),
      ].filter(isVisible);
      const fares = [...new Set(
        fareNodes
          .map((node) => parseListedFare(node.innerText || node.textContent))
          .filter((fare) => fare !== null),
      )];
      if (fares.length !== 1) {
        continue;
      }

      const row = parseFlightRow(
        {
          flightText: matchedFlightNumbers.join(" "),
          fareText: `¥${fares[0]}`,
          routeText: flightText,
          cabin:
            candidate.querySelector('[class*="cabin" i]')?.textContent?.trim() ??
            null,
          fareProduct:
            candidate.querySelector('[class*="product" i]')?.textContent?.trim() ??
            null,
          departureTime:
            candidate.querySelector('[class*="depart" i]')?.textContent?.trim() ??
            null,
          arrivalTime:
            candidate.querySelector('[class*="arrive" i]')?.textContent?.trim() ??
            null,
        },
        airlineCode,
      );

      if (row) {
        collected.set(
          `${row.flightNo}|${row.listedFareCny}|${row.stopCount}`,
          row,
        );
      }
    }

    return [...collected.values()];
  }

  function detectPageError(value) {
    const text = String(value ?? "");
    if (/验证码|安全验证|请完成验证|captcha|robot check/i.test(text)) {
      return "页面要求人工验证，未保存价格";
    }
    if (/访问受限|异常访问|access denied|temporarily blocked/i.test(text)) {
      return "航司页面限制了本次访问，未保存价格";
    }
    if (/请先登录|登录后查看|login to continue/i.test(text)) {
      return "航司页面要求登录，未保存价格";
    }
    if (/暂无航班|没有符合条件的航班|无航班|no flights found/i.test(text)) {
      return "该日期没有可展示的航班";
    }
    return null;
  }

  root.FlightPriceParser = Object.freeze({
    collectVisibleRows,
    detectPageError,
    parseFlightRow,
    parseListedFare,
    parseStopCount,
  });
})(globalThis);
