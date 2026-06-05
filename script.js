const form = document.querySelector("#forecast-form");
const postalInput = document.querySelector("#postal-code");
const countrySelect = document.querySelector("#country-code");
const statusMessage = document.querySelector("#status-message");
const forecastGrid = document.querySelector("#forecast-grid");
const currentSummary = document.querySelector("#current-summary");
const submitButton = document.querySelector("#submit-button");
const unitButtons = document.querySelectorAll(".unit-button");

const state = {
  unit: "fahrenheit",
  lastLocation: null
};

const weatherCodeMap = new Map([
  [0, ["Sunny", "clear"]],
  [1, ["Mostly sunny", "clear"]],
  [2, ["Partly cloudy", "cloud"]],
  [3, ["Cloudy", "cloud"]],
  [45, ["Fog", "fog"]],
  [48, ["Rime fog", "fog"]],
  [51, ["Light drizzle", "rain"]],
  [53, ["Drizzle", "rain"]],
  [55, ["Heavy drizzle", "rain"]],
  [56, ["Freezing drizzle", "rain"]],
  [57, ["Freezing drizzle", "rain"]],
  [61, ["Light rain", "rain"]],
  [63, ["Rain", "rain"]],
  [65, ["Heavy rain", "rain"]],
  [66, ["Freezing rain", "rain"]],
  [67, ["Freezing rain", "rain"]],
  [71, ["Light snow", "snow"]],
  [73, ["Snow", "snow"]],
  [75, ["Heavy snow", "snow"]],
  [77, ["Snow grains", "snow"]],
  [80, ["Rain showers", "rain"]],
  [81, ["Rain showers", "rain"]],
  [82, ["Heavy showers", "rain"]],
  [85, ["Snow showers", "snow"]],
  [86, ["Heavy snow showers", "snow"]],
  [95, ["Thunderstorms", "storm"]],
  [96, ["Thunderstorms with hail", "storm"]],
  [99, ["Thunderstorms with hail", "storm"]]
]);

form.addEventListener("submit", handleSubmit);

unitButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextUnit = button.dataset.unit;
    if (!nextUnit || nextUnit === state.unit) {
      return;
    }

    setUnit(nextUnit);

    if (state.lastLocation) {
      fetchAndRenderForecast(state.lastLocation);
    }
  });
});

function setUnit(unit) {
  state.unit = unit;
  unitButtons.forEach((button) => {
    const isActive = button.dataset.unit === unit;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

async function handleSubmit(event) {
  event.preventDefault();

  const postalCode = postalInput.value.trim();
  const countryCode = countrySelect.value;

  if (!postalCode) {
    setStatus("Add a postal code.", "error");
    postalInput.focus();
    return;
  }

  setLoading(true);
  setStatus("Finding that sky...");
  state.lastLocation = null;

  try {
    const location = await fetchLocation(countryCode, postalCode);
    state.lastLocation = location;
    await fetchAndRenderForecast(location);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

async function fetchAndRenderForecast(location) {
  setLoading(true);
  setStatus("Building a 5-day outlook...");

  try {
    const forecast = await fetchForecast(location);
    renderForecast(location, forecast);
    setStatus("Forecast updated.");
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

async function fetchLocation(countryCode, postalCode) {
  const normalizedPostalCode = normalizePostalCode(countryCode, postalCode);
  const endpoint = `https://api.zippopotam.us/${countryCode}/${encodeURIComponent(normalizedPostalCode)}`;
  const response = await fetch(endpoint);

  if (response.status === 404) {
    throw new Error("No matching place found for that postal code.");
  }

  if (!response.ok) {
    throw new Error("Postal lookup is unavailable right now.");
  }

  const data = await response.json();
  const place = data.places?.[0];
  const latitude = Number(place?.latitude);
  const longitude = Number(place?.longitude);

  if (!place || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new Error("That postal code did not return usable coordinates.");
  }

  return {
    postalCode: data["post code"] ?? postalCode,
    country: data.country ?? countrySelect.selectedOptions[0]?.textContent ?? countryCode.toUpperCase(),
    countryCode,
    placeName: place["place name"] ?? "Selected place",
    stateName: place.state ?? "",
    stateAbbreviation: place["state abbreviation"] ?? "",
    latitude,
    longitude
  };
}

async function fetchForecast(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,weather_code,wind_speed_10m,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
    temperature_unit: state.unit,
    wind_speed_unit: state.unit === "fahrenheit" ? "mph" : "kmh",
    timezone: "auto",
    forecast_days: "5"
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);

  if (!response.ok) {
    let reason = "Weather data is unavailable right now.";
    try {
      const payload = await response.json();
      reason = payload.reason || reason;
    } catch {
      // Keep the friendly default if the API returns a non-JSON error.
    }
    throw new Error(reason);
  }

  const forecast = await response.json();

  if (!forecast.daily?.time?.length) {
    throw new Error("The forecast response did not include daily weather.");
  }

  return forecast;
}

function normalizePostalCode(countryCode, postalCode) {
  const compactCode = postalCode.trim().replace(/\s+/g, "");

  if (countryCode === "us") {
    const fiveDigitZip = compactCode.match(/\d{5}/);
    return fiveDigitZip ? fiveDigitZip[0] : compactCode;
  }

  return compactCode.toLowerCase();
}

function renderForecast(location, forecast) {
  const days = buildDailyForecast(forecast.daily);
  const currentCode = forecast.current?.weather_code ?? days[0]?.code ?? 0;
  const currentCondition = getCondition(currentCode);
  const temperatureUnit = getTemperatureUnit();
  const currentTemperature = forecast.current?.temperature_2m;

  document.body.dataset.weather = currentCondition.theme;
  renderCurrentSummary(location, currentTemperature, currentCondition, temperatureUnit);
  forecastGrid.replaceChildren(...days.map((day) => createForecastCard(day, temperatureUnit)));
}

function buildDailyForecast(daily) {
  return daily.time.map((date, index) => {
    const code = daily.weather_code?.[index] ?? 0;
    return {
      date,
      code,
      condition: getCondition(code),
      high: daily.temperature_2m_max?.[index],
      low: daily.temperature_2m_min?.[index],
      rain: daily.precipitation_probability_max?.[index],
      wind: daily.wind_speed_10m_max?.[index]
    };
  });
}

function renderCurrentSummary(location, temperature, condition, temperatureUnit) {
  const textBlock = document.createElement("div");
  const label = document.createElement("p");
  const heading = document.createElement("h2");
  const place = document.createElement("p");
  const summaryCondition = document.createElement("div");
  const conditionIcon = createWeatherIcon(condition.theme);
  const conditionText = document.createElement("span");
  const temp = document.createElement("div");

  label.className = "summary-label";
  label.textContent = "Today";

  heading.textContent = `${condition.label}`;

  place.className = "place-name";
  place.textContent = formatLocation(location);

  summaryCondition.className = "summary-condition";
  conditionIcon.classList.add("small-weather-icon");
  conditionText.textContent = "Now";
  summaryCondition.append(conditionIcon, conditionText);

  textBlock.append(label, heading, place, summaryCondition);

  temp.className = "summary-temp";
  temp.textContent = Number.isFinite(temperature) ? `${Math.round(temperature)}${temperatureUnit}` : "--";

  currentSummary.replaceChildren(textBlock, temp);
}

function createForecastCard(day, temperatureUnit) {
  const card = document.createElement("article");
  const dateBlock = document.createElement("div");
  const dayName = document.createElement("h3");
  const dateLabel = document.createElement("p");
  const temps = document.createElement("div");
  const high = document.createElement("span");
  const low = document.createElement("span");
  const condition = document.createElement("p");
  const meta = document.createElement("div");

  card.className = "forecast-card";
  dateBlock.className = "date-block";

  dayName.className = "day-name";
  dayName.textContent = formatDay(day.date);

  dateLabel.className = "date-label";
  dateLabel.textContent = formatDate(day.date);

  dateBlock.append(dayName, dateLabel);

  temps.className = "temps";
  high.className = "temp-high";
  high.textContent = formatTemperature(day.high, temperatureUnit);
  low.className = "temp-low";
  low.textContent = formatTemperature(day.low, temperatureUnit);
  temps.append(high, low);

  condition.className = "condition-text";
  condition.textContent = day.condition.label;

  meta.className = "meta-row";
  meta.append(
    createMetaItem("Rain", formatPercent(day.rain)),
    createMetaItem("Wind", formatWind(day.wind))
  );

  card.append(dateBlock, createWeatherIcon(day.condition.theme), temps, condition, meta);
  return card;
}

function createWeatherIcon(theme) {
  const icon = document.createElement("div");
  icon.className = `weather-icon weather-${theme}`;
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = `
    <span class="icon-sun"></span>
    <span class="icon-cloud"></span>
    <span class="icon-rain one"></span>
    <span class="icon-rain two"></span>
    <span class="icon-rain three"></span>
    <span class="icon-bolt"></span>
    <span class="icon-fog one"></span>
    <span class="icon-fog two"></span>
    <span class="icon-snow one"></span>
    <span class="icon-snow two"></span>
    <span class="icon-snow three"></span>
  `;
  return icon;
}

function createMetaItem(labelText, valueText) {
  const item = document.createElement("div");
  const label = document.createElement("span");
  const value = document.createElement("strong");

  item.className = "meta-item";
  label.textContent = labelText;
  value.textContent = valueText;
  item.append(label, value);
  return item;
}

function getCondition(code) {
  const [label, theme] = weatherCodeMap.get(Number(code)) ?? ["Mixed skies", "cloud"];
  return { label, theme };
}

function formatLocation(location) {
  const region = location.stateAbbreviation || location.stateName;
  return [location.placeName, region, location.country].filter(Boolean).join(", ");
}

function formatDay(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function formatTemperature(value, unit) {
  return Number.isFinite(value) ? `${Math.round(value)}${unit}` : "--";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

function formatWind(value) {
  const unit = state.unit === "fahrenheit" ? "mph" : "km/h";
  return Number.isFinite(value) ? `${Math.round(value)} ${unit}` : "--";
}

function getTemperatureUnit() {
  return state.unit === "fahrenheit" ? "F" : "C";
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.querySelector("span:last-child").textContent = isLoading ? "Checking..." : "Get forecast";
}

function setStatus(message, tone = "") {
  statusMessage.textContent = message;
  statusMessage.className = tone ? `status-message ${tone}` : "status-message";
}

function showError(message) {
  document.body.dataset.weather = "cloud";
  setStatus(message, "error");
  const empty = document.createElement("article");
  const copy = document.createElement("p");
  empty.className = "forecast-card empty-card";
  copy.textContent = "Try another postal code or country.";
  empty.append(copy);
  forecastGrid.replaceChildren(empty);
}
