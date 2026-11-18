import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeInput {
  constructor({ name, id = "", placeholder = "", type = "text", attributes = {} }) {
    this.name = name;
    this.id = id;
    this.placeholder = placeholder;
    this.type = type;
    this.attributes = attributes;
    this.readOnly = false;
    this.disabled = false;
    this._value = "";
    this.clickCount = 0;
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = String(value ?? "");
  }

  getAttribute(name) {
    return this.attributes[name] ?? this[name] ?? null;
  }

  dispatchEvent(event) {
    this.onDispatch?.(event, this);
  }

  focus() {}

  click() {
    this.clickCount += 1;
  }

  getClientRects() {
    return [{}];
  }
}

class FakeSelect extends FakeInput {
  constructor(options) {
    super(options);
    this.options = options.options;
  }
}

Object.defineProperty(
  FakeSelect.prototype,
  "value",
  Object.getOwnPropertyDescriptor(FakeInput.prototype, "value"),
);

class FakeButton {
  constructor(text) {
    this.innerText = text;
    this.clickCount = 0;
  }

  click() {
    this.clickCount += 1;
  }

  getClientRects() {
    return [{}];
  }
}

class FakeListbox {
  constructor() {
    this.options = [];
  }

  querySelectorAll() {
    return this.options;
  }
}

async function createFormFixture({
  omitAdults = false,
  omitCabin = false,
  unrelatedOriginOption = false,
  omitOriginSuggestion = false,
  wrongOriginSelection = false,
  noOriginSelection = false,
  hideOriginSuggestionWithoutSelection = false,
} = {}) {
  const originListbox = new FakeListbox();
  const destinationListbox = new FakeListbox();
  const origin = new FakeInput({
    name: "origin",
    placeholder: "出发城市",
    attributes: { "aria-controls": "origin-options" },
  });
  const destination = new FakeInput({
    name: "destination",
    placeholder: "到达城市",
    attributes: { "aria-controls": "destination-options" },
  });
  const travelDate = new FakeInput({ name: "departureDate", type: "date" });
  const adults = new FakeSelect({
    name: "adultCount",
    options: [
      { value: "1", textContent: "1位成人" },
      { value: "2", textContent: "2位成人" },
    ],
  });
  const cabin = new FakeSelect({
    name: "cabin",
    options: [
      { value: "economy", textContent: "经济舱" },
      { value: "business", textContent: "公务舱" },
    ],
  });
  const fields = [origin, destination, travelDate, adults, cabin];
  if (omitAdults) {
    fields.splice(fields.indexOf(adults), 1);
  }
  if (omitCabin) {
    fields.splice(fields.indexOf(cabin), 1);
  }
  const cityOptions = [];
  const oneWay = new FakeButton("单程");
  const search = new FakeButton("查询");

  function makeCityOption(
    input,
    cityName,
    listbox = null,
    selectedValue = cityName,
    confirmSelection = true,
    hideWithoutSelection = false,
  ) {
    const option = {
      innerText: cityName,
      textContent: cityName,
      clickCount: 0,
      selected: false,
      getAttribute(name) {
        if (name === "role") {
          return "option";
        }
        return name === "aria-selected" && this.selected ? "true" : null;
      },
      getClientRects() {
        return this.hidden ? [] : [{}];
      },
      hidden: false,
      click() {
        this.clickCount += 1;
        if (confirmSelection) {
          this.selected = true;
          input.value = selectedValue;
        } else if (hideWithoutSelection) {
          this.hidden = true;
        }
      },
    };
    listbox?.options.push(option);
    cityOptions.push(option);
    return option;
  }

  const unrelatedOption = unrelatedOriginOption
    ? makeCityOption(new FakeInput({ name: "other" }), "杭州")
    : null;

  for (const [field, listbox] of [[origin, originListbox], [destination, destinationListbox]]) {
    field.onDispatch = (event, input) => {
      if (event.type !== "input" || (field === origin && omitOriginSuggestion)) {
        return;
      }
      const selectedValue = field === origin && wrongOriginSelection ? "上海" : input.value;
      const confirmSelection = field !== origin || !(noOriginSelection || hideOriginSuggestionWithoutSelection);
      const hideWithoutSelection = field === origin && hideOriginSuggestionWithoutSelection;
      makeCityOption(input, input.value, listbox, selectedValue, confirmSelection, hideWithoutSelection);
    };
  }

  const document = {
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "input, select" || selector === "select, input") {
        return fields;
      }
      if (selector.includes("[role=\"option\"]")) {
        return cityOptions;
      }
      if (selector.includes("[role=\"tab\"]")) {
        return [oneWay];
      }
      if (selector.includes("input[type=\"submit\"]")) {
        return [search];
      }
      return [];
    },
    getElementById(id) {
      return {
        "origin-options": originListbox,
        "destination-options": destinationListbox,
      }[id] ?? null;
    },
  };
  const context = vm.createContext({
    CSS: { escape: (value) => value },
    document,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    HTMLInputElement: FakeInput,
    HTMLSelectElement: FakeSelect,
    setTimeout,
    clearTimeout,
  });
  const source = await readFile(
    new URL("../src/collectors/city-form.js", import.meta.url),
    "utf8",
  );
  vm.runInContext(source, context);

  return {
    context,
    origin,
    destination,
    travelDate,
    adults,
    cabin,
    oneWay,
    search,
    originListbox,
    destinationListbox,
    unrelatedOption,
  };
}

function makeRequest() {
  return {
    plan: {
      originCityName: "杭州",
      destinationCityName: "长春",
    },
    travelDate: "2027-02-04",
  };
}

test("selects a city suggestion associated with its input and fixes the fare defaults", async () => {
  const fixture = await createFormFixture({ unrelatedOriginOption: true });
  const button = await fixture.context.FlightCityForm.prepareSearch(
    makeRequest(),
    "南航",
  );

  assert.equal(fixture.origin.value, "杭州");
  assert.equal(fixture.destination.value, "长春");
  assert.equal(fixture.travelDate.value, "2027-02-04");
  assert.equal(fixture.adults.value, "1");
  assert.equal(fixture.cabin.value, "economy");
  assert.equal(fixture.oneWay.clickCount, 1);
  assert.equal(button, fixture.search);
  assert.equal(fixture.unrelatedOption.clickCount, 0);
  assert.equal(fixture.originListbox.options[0].clickCount, 1);
  assert.equal(fixture.destinationListbox.options[0].clickCount, 1);
});

test("refuses to search when passenger count or cabin cannot be confirmed", async () => {
  const missingAdults = await createFormFixture({ omitAdults: true });
  await assert.rejects(
    missingAdults.context.FlightCityForm.prepareSearch(makeRequest(), "南航"),
    /成人乘客数.*未提交搜索/,
  );

  const missingCabin = await createFormFixture({ omitCabin: true });
  await assert.rejects(
    missingCabin.context.FlightCityForm.prepareSearch(makeRequest(), "南航"),
    /经济舱.*未提交搜索/,
  );
});

test("refuses unmatched or incorrectly selected city suggestions", async () => {
  const missingSuggestion = await createFormFixture({ omitOriginSuggestion: true });
  await assert.rejects(
    missingSuggestion.context.FlightCityForm.prepareSearch(makeRequest(), "南航"),
    /未能确认.*杭州.*未提交搜索/,
  );

  const wrongSelection = await createFormFixture({ wrongOriginSelection: true });
  await assert.rejects(
    wrongSelection.context.FlightCityForm.prepareSearch(makeRequest(), "南航"),
    /未能确认.*杭州.*未提交搜索/,
  );

  const unconfirmedSelection = await createFormFixture({ noOriginSelection: true });
  await assert.rejects(
    unconfirmedSelection.context.FlightCityForm.prepareSearch(makeRequest(), "南航"),
    /未能确认.*杭州.*未提交搜索/,
  );

  const dismissedSuggestion = await createFormFixture({ hideOriginSuggestionWithoutSelection: true });
  await assert.rejects(
    dismissedSuggestion.context.FlightCityForm.prepareSearch(makeRequest(), "南航"),
    /未能确认.*杭州.*未提交搜索/,
  );
});
