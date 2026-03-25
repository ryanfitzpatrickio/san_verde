const ASSETS_BASE = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const PUBLIC_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const ASSETS_BASE_PREFIXES = ['/models/', '/textures/', '/full textures/'];

function shouldUseAssetsBase(path) {
  return Boolean(
    ASSETS_BASE &&
    typeof path === 'string' &&
    ASSETS_BASE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export function resolveModelUrl(path) {
  return (shouldUseAssetsBase(path) ? ASSETS_BASE : PUBLIC_BASE) + path;
}

export function resolvePublicUrl(path) {
  return PUBLIC_BASE + path;
}
