import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const parserSource = await readFile(
  new URL("../src/collectors/price-parser.js", import.meta.url),
  "utf8",
);
const context = vm.createContext({ console });
vm.runInContext(parserSource, context);
const parser = context.FlightPriceParser;

test("parses Chinese yuan fares and comma-separated amounts", () => {
  assert.equal(parser.parseListedFare("票面价 ¥ 1,280"), 1280);
  assert.equal(parser.parseListedFare("CNY 2,450.50"), 2450.5);
  assert.equal(parser.parseListedFare("￥699"), 699);
});

test("recognizes direct and one-stop itineraries", () => {
  assert.equal(parser.parseStopCount("直达"), 0);
  assert.equal(parser.parseStopCount("经停 1 次"), 1);
  assert.equal(parser.parseStopCount("中转"), 1);
});

test("parses only rows with an airline flight number and a clear fare", () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        parser.parseFlightRow(
          {
            flightText: "中国国际航空 CA 1234",
            fareText: "￥1,288",
            routeText: "直飞",
            cabin: "economy",
          },
          "CA",
        ),
      ),
    ),
    {
      flightNo: "CA1234",
      listedFareCny: 1288,
      stopCount: 0,
      cabin: "economy",
      fareProduct: null,
      departureTime: null,
      arrivalTime: null,
    },
  );
  assert.equal(
    parser.parseFlightRow(
      { flightText: "CA1234", fareText: "税费合计 ￥1,500", routeText: "直达" },
      "CA",
    ),
    null,
  );
  assert.equal(
    parser.parseFlightRow(
      { flightText: "中国国际航空", fareText: "￥1,280", routeText: "直达" },
      "CA",
    ),
    null,
  );
});

test("rejects prices without an explicit CNY marker", () => {
  assert.equal(parser.parseListedFare("1,280"), null);
  assert.equal(parser.parseListedFare("暂无报价"), null);
});
