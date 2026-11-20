import { getSeriesKey, getStopoverStatus, isNonstop } from "./domain.js";

export function filterObservations(observations, filters = {}) {
  const selectedValues = Array.isArray(filters.selectedValues)
    ? new Set(filters.selectedValues)
    : null;

  return observations.filter((observation) => {
    if (filters.planId && observation.planId !== filters.planId) {
      return false;
    }
    if (filters.travelDate && observation.travelDate !== filters.travelDate) {
      return false;
    }
    if (filters.tripType === "direct" && !isNonstop(observation)) return false;
    if (filters.tripType === "stopover" && getStopoverStatus(observation) !== true) return false;
    if (filters.tripType === "transfer" && !(observation.transferCount > 0)) return false;
    if (selectedValues) {
      if (selectedValues.size === 0) {
        return false;
      }
      if (
        filters.filterMode === "airline" &&
        !selectedValues.has(observation.airlineCode)
      ) {
        return false;
      }
      if (
        filters.filterMode === "flight" &&
        !selectedValues.has(observation.flightNo)
      ) {
        return false;
      }
    }
    return true;
  });
}

export function buildChartModel(observations, collectionDates = []) {
  const seriesByKey = new Map();

  for (const observation of observations) {
    const key = getSeriesKey(observation);
    let series = seriesByKey.get(key);
    if (!series) {
      series = {
        key,
        planId: observation.planId,
        travelDate: observation.travelDate,
        airlineCode: observation.airlineCode,
        flightNo: observation.flightNo,
        cabin: observation.cabin,
        fareProduct: observation.fareProduct || null,
        pointsByDate: new Map(),
      };
      seriesByKey.set(key, series);
    }

    const current = series.pointsByDate.get(observation.captureDate);
    if (!current || Date.parse(observation.capturedAt) > Date.parse(current.capturedAt)) {
      series.pointsByDate.set(observation.captureDate, {
        observationId: observation.id,
        captureDate: observation.captureDate,
        capturedAt: observation.capturedAt,
        listedFareCny: observation.listedFareCny,
      });
    }
  }

  const series = [...seriesByKey.values()]
    .map(({ pointsByDate, ...metadata }) => ({
      ...metadata,
      points: [...pointsByDate.values()].sort((left, right) =>
        left.captureDate.localeCompare(right.captureDate),
      ),
    }))
    .sort((left, right) =>
      [left.airlineCode, left.travelDate, left.flightNo, left.cabin].join("|")
        .localeCompare(
          [right.airlineCode, right.travelDate, right.flightNo, right.cabin].join("|"),
        ),
    );
  const captureDates = [
    ...new Set([
      ...observations.map((observation) => observation.captureDate),
      ...collectionDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
    ]),
  ].sort();

  const pointGroups = groupChartPoints(series);
  const lowestFareGroup = pointGroups.reduce((lowest, group) => (
    !lowest || group.listedFareCny < lowest.listedFareCny ||
    (group.listedFareCny === lowest.listedFareCny && group.captureDate > lowest.captureDate)
      ? group
      : lowest
  ), null);

  return { captureDates, series, pointGroups, lowestFareGroup };
}

function groupChartPoints(series, byAirline = false) {
  const groupsByPosition = new Map();
  for (const { airlineCode, points } of series) {
    for (const { observationId, captureDate, listedFareCny } of points) {
      const position = `${captureDate}|${listedFareCny}`;
      const key = byAirline ? `${position}|${airlineCode}` : position;
      let group = groupsByPosition.get(key);
      if (!group) {
        group = { key, captureDate, listedFareCny, observationIds: [], airlineCode };
        groupsByPosition.set(key, group);
      } else if (group.airlineCode !== airlineCode) {
        group.airlineCode = null;
      }
      group.observationIds.push(observationId);
    }
  }
  return [...groupsByPosition.values()];
}

function getHighFareCutoff(series) {
  const prices = series.flatMap(({ points }) => points.map(({ listedFareCny }) => listedFareCny))
    .sort((left, right) => left - right);
  const tailSize = Math.max(2, Math.ceil(prices.length * 0.1));
  for (let index = Math.max(2, prices.length - tailSize); index < prices.length; index += 1) {
    const lowerFare = prices[index - 1];
    if (prices[index] - lowerFare >= Math.max(350, lowerFare * 0.25)) return lowerFare;
  }
  return Infinity;
}

function buildPriceScale(groups, intervals) {
  if (!groups.length) return null;
  const { low, high } = groups.reduce((bounds, { listedFareCny }) => ({
    low: Math.min(bounds.low, listedFareCny), high: Math.max(bounds.high, listedFareCny),
  }), { low: Infinity, high: -Infinity });
  const padding = Math.max((high - low) * 0.08, 30);
  const lowerBound = Math.max(0, low - padding);
  const upperBound = high + padding;
  const idealStep = (upperBound - lowerBound) / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(idealStep));
  const step = [1, 2, 2.5, 5, 10].map((value) => value * magnitude).find((value) => value >= idealStep);
  const min = Math.floor(lowerBound / step) * step;
  const max = Math.ceil(upperBound / step) * step;
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => max - index * step);
  return { min, max, ticks };
}

export function buildPriceChartView(model, { focusLowPrices = true } = {}) {
  const dataDates = [...new Set(model.pointGroups.map(({ captureDate }) => captureDate))].sort();
  const distribution = dataDates.length <= 2;
  const groups = distribution
    ? groupChartPoints(model.series, true).sort((left, right) =>
      left.captureDate.localeCompare(right.captureDate) || left.airlineCode.localeCompare(right.airlineCode) ||
      left.listedFareCny - right.listedFareCny,
    )
    : model.pointGroups;
  const fareCutoff = focusLowPrices ? getHighFareCutoff(model.series) : Infinity;
  const pointGroups = groups.filter(({ listedFareCny }) => listedFareCny <= fareCutoff);
  const hiddenQuoteCount = groups.reduce((count, group) =>
    count + (group.listedFareCny > fareCutoff ? group.observationIds.length : 0), 0);
  const airlines = [...new Set(pointGroups.map(({ airlineCode }) => airlineCode).filter(Boolean))].sort();
  return {
    mode: distribution ? "distribution" : "trend",
    dataDates, airlines, pointGroups, fareCutoff, hiddenQuoteCount,
    scale: buildPriceScale(pointGroups, distribution ? 6 : 8),
    captureDates: model.captureDates,
    series: model.series,
  };
}

const MIN_DATE_LABEL_SPACING = 90;

export function selectChartDateLabels(captureDates, plotWidth) {
  const lastIndex = captureDates.length - 1;
  if (lastIndex <= 0) return captureDates;
  if (plotWidth < MIN_DATE_LABEL_SPACING) return [captureDates[lastIndex]];

  const minimumStep = Math.max(1, Math.ceil(lastIndex * MIN_DATE_LABEL_SPACING / plotWidth));
  const intervals = Math.floor(lastIndex / minimumStep);
  return Array.from({ length: intervals + 1 }, (_, index) =>
    captureDates[Math.round(index * lastIndex / intervals)],
  );
}

export function sortPriceHistoryRows(observations, priceOrder) {
  const direction = { ascending: 1, descending: -1 }[priceOrder] ?? 0;
  return [...observations].sort((left, right) =>
    direction * (left.listedFareCny - right.listedFareCny) ||
    right.captureDate.localeCompare(left.captureDate) ||
    left.travelDate.localeCompare(right.travelDate) ||
    left.airlineCode.localeCompare(right.airlineCode) ||
    left.flightNo.localeCompare(right.flightNo),
  );
}
