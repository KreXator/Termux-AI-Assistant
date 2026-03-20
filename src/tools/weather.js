/**
 * weather.js — Current weather via Open-Meteo
 *
 * No API key required. Uses:
 *   - Open-Meteo Geocoding API  → https://geocoding-api.open-meteo.com
 *   - Open-Meteo Forecast API   → https://api.open-meteo.com
 *
 * WMO weather codes: https://open-meteo.com/en/docs#weathervariables
 */
'use strict';

const axios = require('axios');

// ─── WMO code helpers ─────────────────────────────────────────────────────────

const WMO_EMOJI = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️', 77: '❄️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  85: '🌨️', 86: '❄️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

const WMO_DESC = {
  0: 'Clear sky',
  1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight showers', 81: 'Moderate showers', 82: 'Heavy showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};

function wmoEmoji(code) { return WMO_EMOJI[code] || '🌡️'; }
function wmoDesc(code)  { return WMO_DESC[code]  || `Conditions code ${code}`; }

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Get current weather for a city name.
 * @param {string} city
 * @returns {Promise<string>} formatted weather string
 */
async function getWeather(city) {
  // 1. Geocode city name
  const geoRes = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
    params: { name: city, count: 1, language: 'en', format: 'json' },
    timeout: 8_000,
  });

  const locations = geoRes.data.results;
  if (!locations?.length) return `❌ No location found for *${city}*. Try a more specific name.`;

  const { name, country, admin1, latitude, longitude } = locations[0];
  const locationStr = [name, admin1, country].filter(Boolean).join(', ');

  // 2. Fetch current weather
  const wxRes = await axios.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude,
      longitude,
      current: [
        'temperature_2m',
        'apparent_temperature',
        'weathercode',
        'windspeed_10m',
        'winddirection_10m',
        'relativehumidity_2m',
        'precipitation',
      ].join(','),
      timezone: 'auto',
    },
    timeout: 8_000,
  });

  const c    = wxRes.data.current;
  const code = c.weathercode;

  return (
    `${wmoEmoji(code)} *${locationStr}*\n\n` +
    `🌡️ Temperature: *${c.temperature_2m}°C* (feels like ${c.apparent_temperature}°C)\n` +
    `💧 Humidity: ${c.relativehumidity_2m}%\n` +
    `💨 Wind: ${c.windspeed_10m} km/h\n` +
    `🌂 Precipitation: ${c.precipitation} mm\n` +
    `📋 Conditions: ${wmoDesc(code)}`
  );
}

module.exports = { getWeather };
