(function installFlightCityForm() {
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

  function cityOptionMatches(element, cityName) {
    const dataCityName = element.getAttribute?.("data-city-name");
    if (dataCityName === cityName) {
      return true;
    }
    const label = String(element.innerText ?? element.textContent ?? "")
      .replaceAll(/\s+/g, " ")
      .trim();
    if (label === cityName) {
      return true;
    }
    if (!label.startsWith(cityName)) {
      return false;
    }
    const suffix = label.slice(cityName.length);
    return /^(?:市(?:$|\s)|\s|[（(·/，,]|[A-Z]{3}(?:$|\s))/i.test(suffix);
  }

  function findCityOption(input, cityName) {
    const relatedIds = `${input.getAttribute("aria-controls") ?? ""} ${input.getAttribute("aria-owns") ?? ""}`
      .split(/\s+/)
      .filter(Boolean);
    let roots = [...new Set(relatedIds.map((id) => document.getElementById(id)).filter(Boolean))];

    if (roots.length === 0) {
      for (let ancestor = input.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const listboxes = [
          ...(ancestor.matches?.('[role="listbox"]') ? [ancestor] : []),
          ...ancestor.querySelectorAll('[role="listbox"]'),
        ];
        if (listboxes.length > 0) {
          roots = listboxes;
          break;
        }
      }
    }

    const options = roots.flatMap((root) => [
      ...(root.matches?.('[role="option"], [data-city-name]') ? [root] : []),
      ...root.querySelectorAll('[role="option"], [data-city-name]'),
    ]);
    const matchingOptions = [...new Set(options)]
      .filter((element) =>
        (!element.getClientRects || element.getClientRects().length > 0) &&
        cityOptionMatches(element, cityName),
      )
      .sort((left, right) =>
        String(left.innerText ?? left.textContent ?? "").length -
        String(right.innerText ?? right.textContent ?? "").length,
      );
    return matchingOptions.length === 1 ? matchingOptions[0] : null;
  }

  function isCitySelectionConfirmed(input, option, cityName, previousValue) {
    const selectedValue = String(input.value ?? "").trim();
    if (!cityOptionMatches({ innerText: selectedValue, textContent: selectedValue }, cityName)) {
      return false;
    }

    return option.getAttribute?.("aria-selected") === "true" || selectedValue !== previousValue;
  }

  async function selectCity(pattern, cityName, airlineName) {
    const input = findInput(pattern);
    if (!input || !cityName) {
      throw new Error(`未识别到${airlineName}的城市输入项，未提交搜索`);
    }

    if (input.readOnly || input.disabled) {
      input.click();
    } else if (!setValue(input, cityName)) {
      throw new Error(`无法填写${airlineName}的${cityName}城市，未提交搜索`);
    }

    const deadline = Date.now() + 1800;
    let option;
    while (Date.now() < deadline) {
      option = findCityOption(input, cityName);
      if (option) {
        const previousValue = String(input.value ?? "").trim();
        option.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (isCitySelectionConfirmed(input, option, cityName, previousValue)) {
          return;
        }
        throw new Error(`未能确认${airlineName}已选择${cityName}，未提交搜索`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`未能确认${airlineName}已选择${cityName}，未提交搜索`);
  }

  function setPassengerCount(element) {
    if (element instanceof HTMLSelectElement) {
      const option = [...element.options].find((candidate) => {
        const value = String(candidate.value).trim();
        const label = String(candidate.textContent).trim();
        return value === "1" || label === "1" || label === "1位成人" || label === "1成人";
      });
      return option ? setValue(element, option.value) : false;
    }
    return setValue(element, "1");
  }

  function setEconomyCabin(element) {
    if (element instanceof HTMLSelectElement) {
      const option = [...element.options].find((candidate) =>
        /经济|economy|coach/i.test(`${candidate.value} ${candidate.textContent}`),
      );
      return option ? setValue(element, option.value) : false;
    }
    return setValue(element, "经济舱");
  }

  async function prepareSearch(request, airlineName) {
    const oneWay = [...document.querySelectorAll('button, [role="tab"], label')].find(
      (element) => /^单程$/.test(element.innerText?.trim() ?? ""),
    );
    oneWay?.click();

    const departureDate =
      document.querySelector('input[type="date"]') ||
      findInput(/depart.*date|date.*depart|出发日期|日期/);
    if (!departureDate) {
      throw new Error(`未识别到${airlineName}单程查询日期，未提交搜索`);
    }

    await selectCity(/origin|from|出发/, request.plan.originCityName, airlineName);
    await selectCity(/destination|to|到达/, request.plan.destinationCityName, airlineName);
    if (!setValue(departureDate, request.travelDate)) {
      throw new Error(`无法设置${airlineName}的出发日期，未提交搜索`);
    }

    const passengerInput = findInput(/adult|passenger|成人|乘客/);
    if (!passengerInput) {
      throw new Error(`未识别到${airlineName}成人乘客数选项，未提交搜索`);
    }
    if (!setPassengerCount(passengerInput)) {
      throw new Error(`无法将${airlineName}人数设为一位成人，未提交搜索`);
    }

    const cabinInput = [...document.querySelectorAll("select, input")].find((input) =>
      /cabin|舱位/i.test(describe(input)),
    );
    if (!cabinInput) {
      throw new Error(`未识别到${airlineName}经济舱选项，未提交搜索`);
    }
    if (!setEconomyCabin(cabinInput)) {
      throw new Error(`无法将${airlineName}舱位设为经济舱，未提交搜索`);
    }

    const searchButton = [...document.querySelectorAll('button, input[type="submit"]')].find(
      (element) => /^(查询|搜索|搜索航班)$/.test(
        (element.innerText || element.value || "").trim(),
      ),
    );
    if (!searchButton) {
      throw new Error(`未识别到${airlineName}查询按钮，未提交搜索`);
    }
    return searchButton;
  }

  globalThis.FlightCityForm = Object.freeze({ prepareSearch });
})();
