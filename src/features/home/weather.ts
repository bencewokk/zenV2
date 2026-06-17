export interface Weather {
  tempC: number;
  code: number;
  label: string;
  place: string;
}

// WMO weather interpretation codes → short label.
const CODE_LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent showers",
  95: "Thunderstorm",
  96: "Thunderstorm + hail",
  99: "Thunderstorm + hail",
};

export function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 65) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌦️";
  return "⛈️";
}

async function resolveCoords(): Promise<{ lat: number; lon: number; place: string }> {
  // Try geolocation; fall back to Budapest if denied/unavailable.
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: 47.4979, lon: 19.0402, place: "Budapest" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, place: "Your location" }),
      () => resolve({ lat: 47.4979, lon: 19.0402, place: "Budapest" }),
      { timeout: 4000 }
    );
  });
}

export async function fetchWeather(): Promise<Weather> {
  const { lat, lon, place } = await resolveCoords();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather ${res.status}`);
  const json = (await res.json()) as { current: { temperature_2m: number; weather_code: number } };
  const code = json.current.weather_code;
  return {
    tempC: Math.round(json.current.temperature_2m),
    code,
    label: CODE_LABELS[code] ?? "—",
    place,
  };
}
