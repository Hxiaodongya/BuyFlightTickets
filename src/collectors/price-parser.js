(function installFlightPriceParser(root) {
  const FLIGHT_NUMBER_PATTERN = /\b(?:CA|CZ)\s*\d{2,4}\b/gi;
  const CNY_FARE_PATTERN = /(?:CNY\s*|[¥￥]\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d,.])/i;
  const CLOCK_PATTERN = /\b(?:[01]\d|2[0-3]):[0-5]\d\b/;
  const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;
  const ARRIVAL_DAY_MARKER = /(?:[+＋][ \t]*\d+(?:[ \t]*[天日])?|次日)/;
  const ARRIVAL_PREFIX = new RegExp(`${ARRIVAL_DAY_MARKER.source}\\s*$`);
  const ARRIVAL_SUFFIX = new RegExp(`^\\s*(?:${ARRIVAL_DAY_MARKER.source}|${DATE_PATTERN.source})`);

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

  function parseRoute(value, segmentCount = 0) {
    const rawText = String(value ?? "");
    const withoutDeniedStopovers = rawText.replace(/(?:无须|无需|无|不)\s*经停/g, "");
    const text = withoutDeniedStopovers.replace(/(?:无须|无需|不用|不必|不需要?|无|不)\s*(?:中转|转机)/g, "");
    const direct = /直达|直飞|\b(?:non[- ]?stop|direct)\b/i.test(text);
    const stopover = /经停|\b(?:technical|en[- ]?route) stops?\b/i.test(text);
    const explicitStopovers = text.match(/经停[ \t]*(\d+)[ \t]*次/);
    const explicitTransfers = text.match(/(?:中转|转机|(?:^|\s)转)[ \t]*(\d+)[ \t]*次|\b(\d+)[ \t]+transfers?\b/i);
    const transfer = /中转|转机|(?:^|\s)转(?=[\s:：\d]|$)|\btransfers?\b/i.test(text);
    const segmentTransfers = segmentCount > 0 ? segmentCount - 1 : null;
    let transferCount = segmentTransfers;
    if (explicitTransfers) transferCount = Number(explicitTransfers[1] ?? explicitTransfers[2]);
    else if (transfer) transferCount = Math.max(1, segmentTransfers ?? 0);
    else if (direct || stopover) transferCount = 0;

    const stopoverCount = explicitStopovers ? Number(explicitStopovers[1]) : Number(stopover);
    const hasStopover = stopoverCount > 0 ? true : (transferCount === 0 || withoutDeniedStopovers !== rawText ? false : null);
    return {
      stopCount: transferCount === null ? null : transferCount + stopoverCount,
      transferCount,
      hasStopover,
      stopoverName: hasStopover ? text.match(/经停[ \t]*[·:：][ \t]*([\p{Script=Han}]+|[A-Z]{3}\b)/u)?.[1] ?? null : null,
    };
  }

  function parseFlightRow(record, airlineCode) {
    const code = String(airlineCode ?? "").toUpperCase();
    const flightText = String(record.flightNo ?? record.flightText ?? "");
    const flightNumbers = (flightText.match(FLIGHT_NUMBER_PATTERN) ?? [])
      .map((value) => value.replaceAll(/\s+/g, "").toUpperCase())
      .filter((value) => value.startsWith(code));
    const flightNo = [...new Set(flightNumbers)].join("+");
    const listedFareCny = parseListedFare(record.fareText);
    if (!flightNo || listedFareCny === null) {
      return null;
    }

    return {
      flightNo,
      listedFareCny,
      ...parseRoute(record.routeText, record.segmentCount),
      cabin: record.cabin || null,
      fareProduct: record.fareProduct || null,
      ...readSchedule(record.departure, record.arrival, record.duration),
    };
  }

  function isVisible(element) {
    return element != null && element.getClientRects().length > 0;
  }

  function textOf(element) {
    return (element?.innerText ?? element?.textContent ?? "").trim();
  }

  function readSchedule(departure = "", arrival = "", duration = "", date = "") {
    const dayOffset = arrival.match(/[+＋]\s*(\d+)/)?.[1];
    const elapsed = duration.match(/(?:(\d+)\s*(?:小时|时|h)(?:\s*(\d+)\s*(?:分钟|分|m))?|(\d+)\s*(?:分钟|分|m))/i);
    return {
      departureTime: departure.match(CLOCK_PATTERN)?.[0] ?? null,
      arrivalTime: arrival.match(CLOCK_PATTERN)?.[0] ?? null,
      arrivalDate: date.match(DATE_PATTERN)?.[0] ?? arrival.match(DATE_PATTERN)?.[0] ?? null,
      arrivalDayOffset: dayOffset !== undefined ? Number(dayOffset) : (/次日/.test(arrival) ? 1 : null),
      durationMinutes: elapsed ? Number(elapsed[1] ?? 0) * 60 + Number(elapsed[2] ?? elapsed[3] ?? 0) : null,
    };
  }

  function collectAirChinaRows(document) {
    const cards = document.querySelectorAll(
      '[class*="style_tableContentWrapper__"] [class*="style_singleFightWrapper__"]',
    );
    return [...cards].filter(isVisible).map((card) => {
      const flightNumbers = [...card.querySelectorAll('[class*="shared-flights_number__"]')]
        .filter(isVisible)
        .map(textOf)
        .filter(Boolean);
      const segmentCount = [...card.querySelectorAll('[class*="baseContent_aircraftWrapper__"]')]
        .filter(isVisible).length;
      const fare = card.querySelector(
        '[class*="cabinContent_economy__"] [class*="cabinContent_price__"]',
      );
      const layover = textOf(card.querySelector('[class*="baseContent_layover__"]'));
      return parseFlightRow({
        flightText: flightNumbers.join(" "),
        fareText: isVisible(fare) ? textOf(fare) : "",
        routeText: layover,
        segmentCount,
        cabin: "economy",
        departure: textOf(card.querySelector(
          '[class*="baseContent_departure__"] [class*="baseContent_time__"]',
        )),
        arrival: textOf(card.querySelector('[class*="baseContent_arrive__"]') ?? card.querySelector(
          '[class*="baseContent_arrive__"] [class*="baseContent_time__"]',
        )),
        duration: textOf(card.querySelector('[class*="baseContent_totalTime__"]')),
      }, "CA");
    }).filter(Boolean);
  }

  function collectChinaSouthernRows(document) {
    const cards = document.querySelectorAll(".zls-flight-cell");
    return [...cards].filter(isVisible).map((card) => {
      const rowText = textOf(card);
      const [departure, arrival] = rowText.matchAll(new RegExp(CLOCK_PATTERN.source, "g"));
      let arrivalText = "";
      if (arrival) {
        const betweenTimes = rowText.slice(departure.index + departure[0].length, arrival.index);
        const afterArrival = rowText.slice(arrival.index + arrival[0].length);
        const prefix = betweenTimes.match(ARRIVAL_PREFIX)?.[0] ?? "";
        const suffix = afterArrival.match(ARRIVAL_SUFFIX)?.[0] ?? "";
        arrivalText = `${prefix} ${arrival[0]} ${suffix}`;
      }
      const duration = rowText.match(/(?:总(?:用时|时长|耗时|历时)|全程(?:用时|时长|耗时|历时)?)[\s:：]*(\d[^\n]*)/)?.[1];
      const fare = card.querySelector('[data-cabin="3"]');
      return parseFlightRow({
        flightText: rowText,
        fareText: isVisible(fare) ? textOf(fare) : "",
        routeText: rowText,
        cabin: "economy",
        departure: departure?.[0],
        arrival: arrivalText,
        duration,
      }, "CZ");
    }).filter(Boolean);
  }

  function collectLoongAir(document) {
    const cards = [...document.querySelectorAll(".search .flights .flight_item")];
    const visibleCards = cards.filter(isVisible);
    const rows = [];
    let flightNumberCardCount = 0;
    let economyFareCardCount = 0;

    for (const card of visibleCards) {
      const heading = card.querySelector(".fight_card");
      if (!isVisible(heading)) continue;
      const segmentNumbers = [...heading.querySelectorAll(".left .top .icomoon")]
        .filter(isVisible)
        .map((element) => textOf(element).match(/^([A-Z0-9]{2})\s*(\d{2,4})(?=\s*(?:-|$))/i))
        .filter(Boolean)
        .map(([, code, number]) => `${code.toUpperCase()}${number}`);
      const hasLoongAirFlight = segmentNumbers.some((number) => number.startsWith("GJ"));
      if (hasLoongAirFlight) flightNumberCardCount += 1;

      const fare = heading.querySelector(".right li:has(> b.eco) > h4");
      const listedFareCny = isVisible(fare) && !heading.querySelector(".right .tax_total_tip")
        ? parseListedFare(textOf(fare))
        : null;
      if (listedFareCny !== null) economyFareCardCount += 1;
      if (!hasLoongAirFlight || listedFareCny === null) continue;

      const [departure, arrival] = heading.querySelectorAll(".center .center_item .time p");
      const [departureDate, arrivalDate] = heading.querySelectorAll(".center .center_item .date");
      rows.push({
        flightNo: [...new Set(segmentNumbers)].join("+"),
        listedFareCny,
        travelDate: textOf(departureDate).match(DATE_PATTERN)?.[0] ?? null,
        ...parseRoute(textOf(heading.querySelector(".center_trip")), segmentNumbers.length),
        cabin: "economy",
        fareProduct: null,
        ...readSchedule(
          textOf(departure),
          textOf(arrival?.parentElement ?? arrival),
          textOf(heading.querySelector(".center .center_arrow_wrap .stop_over")),
          textOf(arrivalDate),
        ),
      });
    }

    return {
      rows,
      diagnostics: {
        candidateCount: cards.length,
        visibleCardCount: visibleCards.length,
        flightNumberCardCount,
        economyFareCardCount,
        parsedRowCount: rows.length,
      },
    };
  }

  function collectVisibleRows(document, airlineCode) {
    if (airlineCode === "CA") return collectAirChinaRows(document);
    if (airlineCode === "CZ") return collectChinaSouthernRows(document);
    if (airlineCode === "GJ") return collectLoongAir(document).rows;
    return [];
  }

  function collectVisibleRowsWithDiagnostics(document, airlineCode) {
    if (airlineCode === "GJ") return collectLoongAir(document);
    const selectors = {
      CA: {
        card: '[class*="style_tableContentWrapper__"] [class*="style_singleFightWrapper__"]',
        fare: '[class*="cabinContent_economy__"] [class*="cabinContent_price__"]',
      },
      CZ: {
        card: ".zls-flight-cell",
        fare: '[data-cabin="3"]',
      },
    }[airlineCode];
    const cards = selectors ? [...document.querySelectorAll(selectors.card)] : [];
    const visibleCards = cards.filter(isVisible);
    const rows = collectVisibleRows(document, airlineCode);

    return {
      rows,
      diagnostics: {
        candidateCount: cards.length,
        visibleCardCount: visibleCards.length,
        flightNumberCardCount: visibleCards.filter((card) =>
          (textOf(card).match(FLIGHT_NUMBER_PATTERN) ?? []).length > 0,
        ).length,
        economyFareCardCount: visibleCards.filter((card) =>
          isVisible(card.querySelector(selectors?.fare)),
        ).length,
        parsedRowCount: rows.length,
      },
    };
  }

  function detectPageIssue(value, { includeNoFlights = true } = {}) {
    const text = String(value ?? "");
    if (/验证码|安全验证|请完成验证|captcha|robot check/i.test(text)) {
      return { reason: "human-verification" };
    }
    if (/访问受限|异常访问|access denied|temporarily blocked/i.test(text)) {
      return { message: "航司页面限制了本次访问，未保存价格" };
    }
    if (/请先登录|登录后查看|login to continue/i.test(text)) {
      return { message: "航司页面要求登录，未保存价格" };
    }
    if (includeNoFlights && /暂无航班|没有(?:符合条件|可预订)的航班|无航班|no flights found/i.test(text)) {
      return { message: "该日期没有可展示的航班" };
    }
    return null;
  }

  root.FlightPriceParser = Object.freeze({
    collectVisibleRows,
    collectVisibleRowsWithDiagnostics,
    detectPageIssue,
    parseFlightRow,
    parseListedFare,
    parseRoute,
  });
})(globalThis);
