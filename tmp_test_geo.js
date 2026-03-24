const axios = require('axios');

async function testGeo() {
  const city = "Zielona Góra";
  try {
    const geoRes = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: { name: city, count: 1, language: 'pl', format: 'json' },
      timeout: 8_000,
    });
    console.log('Results:', JSON.stringify(geoRes.data.results, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testGeo();
