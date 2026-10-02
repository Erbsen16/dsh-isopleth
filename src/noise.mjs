// Self-written 2D value noise + fBm. No third-party noise code.
// Deterministic: identical (x, y, seedInt) always yields the identical value.

/** FNV-1a over the seed's string form -> 32-bit unsigned int. */
export function hashSeed(seed) {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer lattice hash -> [0, 1). */
function hash2i(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Quintic fade, C2-continuous: keeps contours free of lattice creases. */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bilinear-smoothstep value noise in [0, 1). */
export function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const ux = fade(x - x0);
  const uy = fade(y - y0);
  const a = hash2i(x0, y0, seed);
  const b = hash2i(x0 + 1, y0, seed);
  const c = hash2i(x0, y0 + 1, seed);
  const d = hash2i(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

/**
 * Fractional Brownian motion: octaves of value noise, amplitude-normalised to ~[0,1].
 * `seedInt` is a 32-bit int; each octave gets its own lattice phase.
 */
export function fbm(x, y, seedInt, { octaves = 6, gain = 0.5, lacunarity = 2 } = {}) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2D(x * freq, y * freq, (seedInt + Math.imul(o + 1, 0x9e3779b1)) | 0);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
