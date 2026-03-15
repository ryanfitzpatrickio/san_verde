const ASSETS_BASE = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');

export function resolveModelUrl(path) {
  return ASSETS_BASE + path;
}
