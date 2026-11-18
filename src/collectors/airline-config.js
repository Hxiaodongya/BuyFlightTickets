export const airlineAdapters = Object.freeze({
  CA: Object.freeze({
    buildSearchUrl({ plan, travelDate }) {
      const route = `${plan.originCode.toLowerCase()}-${plan.destinationCode.toLowerCase()}`;
      return `https://www.airchina.com.cn/flight/oneway/${route}/${travelDate}`;
    },
  }),
  CZ: Object.freeze({
    pushResult: true,
    buildSearchUrl() {
      return "https://b2c.csair.com/B2CNew/flight/search";
    },
  }),
});
