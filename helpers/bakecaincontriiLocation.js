const cities = require("../constants/cities");

const BAKECAINCONTRII_CITY_ALIASES = Object.freeze({
  // Bakecaincontrii publishes this municipality under the Milano area.
  vimodrone: "Milano",
});

const normalizeCityName = (value) => `${value || ""}`
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s*\([A-Z]{2}\)\s*$/i, "")
  .replace(/[^a-z0-9]+/gi, " ")
  .trim()
  .toLowerCase();

const citiesByNormalizedName = new Map(
  Object.keys(cities).map((name) => [normalizeCityName(name), name])
);

const resolveBakecaincontriiCity = (requestedCity) => {
  const normalized = normalizeCityName(requestedCity);
  const alias = BAKECAINCONTRII_CITY_ALIASES[normalized];
  const canonicalName = alias || citiesByNormalizedName.get(normalized) || "";
  return {
    requestedCity: `${requestedCity || ""}`.trim(),
    canonicalName,
    id: canonicalName ? cities[canonicalName] : "",
  };
};

module.exports = {
  normalizeCityName,
  resolveBakecaincontriiCity,
};
