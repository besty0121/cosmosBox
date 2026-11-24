// Physical & Astronomical Constants in SI Units (kg, m, s, K, W)

export const G = 6.67430e-11; // Gravitational constant (m^3 kg^-1 s^-2)
export const C_LIGHT = 2.99792458e8; // Speed of light (m/s)
export const SIGMA_SB = 5.670374419e-8; // Stefan-Boltzmann constant (W m^-2 K^-4)

export const AU = 1.495978707e11; // Astronomical Unit (m)
export const LY = 9.46073047e15; // Light-year (m)
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86400;
export const WEEK = 7 * DAY;
export const MONTH = 30.4375 * DAY;
export const YEAR = 365.256363 * DAY;

// Reference Masses (kg)
export const M_SUN = 1.98847e30;
export const M_JUPITER = 1.89813e27;
export const M_SATURN = 5.6834e26;
export const M_EARTH = 5.9722e24;
export const M_MOON = 7.342e22;

// Reference Radii (m)
export const R_SUN = 6.9634e8;
export const R_JUPITER = 6.9911e7;
export const R_SATURN = 5.8232e7;
export const R_EARTH = 6.371e6;
export const R_MOON = 1.7374e6;

// Reference Luminosity (W)
export const L_SUN = 3.828e26;

// Scene Coordinate Scale: 1 AU = 160 Three.js world units
export const SCENE_UNITS_PER_AU = 160;
export const METERS_TO_SCENE = SCENE_UNITS_PER_AU / AU;
export const SCENE_TO_METERS = AU / SCENE_UNITS_PER_AU;

// Time scale presets (simulated seconds per real second)
export const TIME_PRESETS = [
  { label: '实时', value: 1 },
  { label: '1小时/秒', value: HOUR },
  { label: '1天/秒', value: DAY },
  { label: '1周/秒', value: WEEK },
  { label: '1月/秒', value: MONTH },
  { label: '3月/秒', value: 3 * MONTH },
  { label: '1年/秒', value: YEAR },
];

export function schwarzschildRadius(massKg: number): number {
  return (2 * G * massKg) / (C_LIGHT * C_LIGHT);
}

/**
 * Rough blackbody temperature (K) to sRGB hex string for stars & hot glow.
 */
export function temperatureToHex(tempK: number): string {
  const t = Math.max(1000, Math.min(40000, tempK)) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = Math.max(0, Math.min(255, 99.4708025861 * Math.log(t) - 161.1195681661));
  } else {
    r = Math.max(0, Math.min(255, 329.698727446 * Math.pow(t - 60, -0.1332047592)));
    g = Math.max(0, Math.min(255, 288.1221695283 * Math.pow(t - 60, -0.0755148492)));
  }

  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = Math.max(0, Math.min(255, 138.5177312231 * Math.log(t - 10) - 305.0447927307));
  }

  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const SUP_DIGITS: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

function toSuperscriptExp(exp: number): string {
  return String(exp)
    .split('')
    .map((ch) => SUP_DIGITS[ch] ?? ch)
    .join('');
}

export function formatMass(massKg: number): string {
  if (massKg >= 1e5 * M_SUN) {
    const solar = massKg / M_SUN;
    let exp = Math.floor(Math.log10(solar));
    let mant = solar / Math.pow(10, exp);
    if (mant >= 9.995) {
      exp += 1;
      mant /= 10;
    }
    return `${mant.toFixed(2)}×10${toSuperscriptExp(exp)} M☉`;
  }
  if (massKg >= 0.05 * M_SUN) {
    return `${(massKg / M_SUN).toFixed(3)} M☉`;
  }
  if (massKg >= 0.1 * M_JUPITER) {
    return `${(massKg / M_JUPITER).toFixed(2)} M♃`;
  }
  if (massKg >= 0.01 * M_EARTH) {
    return `${(massKg / M_EARTH).toFixed(3)} M⊕`;
  }
  if (massKg >= 0.01 * M_MOON) {
    return `${(massKg / M_MOON).toFixed(2)} M☾`;
  }
  return `${massKg.toExponential(2)} kg`;
}

export function formatRadius(radiusM: number): string {
  if (radiusM >= 1e4 * LY) {
    return `${(radiusM / (1e4 * LY)).toFixed(2)} 万光年`;
  }
  if (radiusM >= 0.1 * LY) {
    return `${Math.round(radiusM / LY).toLocaleString()} 光年`;
  }
  if (radiusM >= 0.1 * R_SUN) {
    return `${(radiusM / R_SUN).toFixed(2)} R☉`;
  }
  if (radiusM >= 0.2 * R_EARTH) {
    return `${(radiusM / R_EARTH).toFixed(2)} R⊕`;
  }
  return `${(radiusM / 1000).toFixed(0)} km`;
}

export function formatSimTime(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < DAY) {
    return `${(seconds / HOUR).toFixed(1)} 小时`;
  }
  if (abs < YEAR) {
    return `${(seconds / DAY).toFixed(1)} 天`;
  }
  return `${(seconds / YEAR).toFixed(2)} 年`;
}

export function formatTimeScale(secPerSec: number): string {
  if (secPerSec < 60) return `${secPerSec.toFixed(1)} 秒/秒`;
  if (secPerSec < HOUR) return `${(secPerSec / 60).toFixed(1)} 分钟/秒`;
  if (secPerSec < DAY) return `${(secPerSec / HOUR).toFixed(1)} 小时/秒`;
  if (secPerSec < MONTH) return `${(secPerSec / DAY).toFixed(1)} 天/秒`;
  if (secPerSec < YEAR) return `${(secPerSec / MONTH).toFixed(1)} 月/秒`;
  return `${(secPerSec / YEAR).toFixed(2)} 年/秒`;
}
