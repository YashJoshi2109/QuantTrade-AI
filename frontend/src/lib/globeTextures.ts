/**
 * Self-hosted globe textures (public/globe). Same imagery as three-globe's
 * example earth-blue-marble.jpg / earth-topology.png, re-encoded as WebP at
 * 2048x1024 / 1024x512 (~150KB + ~10KB instead of ~1.8MB from unpkg), so they
 * are served from our origin with long-lived cache headers.
 */
export const GLOBE_TEXTURE_URL = '/globe/earth-blue-marble.webp'
export const GLOBE_BUMP_URL = '/globe/earth-topology.webp'
