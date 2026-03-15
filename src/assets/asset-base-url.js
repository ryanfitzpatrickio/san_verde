const ASSETS_BASE = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const PUBLIC_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

export function resolveModelUrl(path) {
  return ASSETS_BASE + path;
}

export function resolvePublicUrl(path) {
  return PUBLIC_BASE + path;
}
