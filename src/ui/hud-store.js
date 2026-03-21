import { createSignal } from 'solid-js';

// Engine overlay
export const [engineName, setEngineName] = createSignal('Mustang 390ci V8');
export const [engineGear, setEngineGear] = createSignal('1');
export const [engineRpm, setEngineRpm] = createSignal('850 rpm');
export const [vehicleSpeed, setVehicleSpeed] = createSignal('0 mph');

// Player overlay
export const [playerMode, setPlayerMode] = createSignal('On foot');
export const [playerHint, setPlayerHint] = createSignal('WASD move, Shift run, F enter car');

// Overlay visibility
export const [uiOpen, setUiOpen] = createSignal(!localStorage.getItem('uiDismissed'));
export const [performanceOpen, setPerformanceOpen] = createSignal(false);
export const [playerHidden, setPlayerHidden] = createSignal(!!localStorage.getItem('controlsHidden'));
export const [controlsHidden, setControlsHidden] = createSignal(!!localStorage.getItem('controlsOverlayHidden'));

// Load screen
export const [loadPct, setLoadPct] = createSignal(0);
export const [loadLabel, setLoadLabel] = createSignal('Loading…');
export const [loadDone, setLoadDone] = createSignal(false);

// Minimap
export const [minimapLabel, setMinimapLabel] = createSignal('');
export const [minimapVisible, setMinimapVisible] = createSignal(false);
export let minimapCanvasEl = null;
export function setMinimapCanvasRef(el) { minimapCanvasEl = el; }

// Performance overlay
export const [perfFps, setPerfFps] = createSignal('0');
export const [perfFrame, setPerfFrame] = createSignal('0.0 ms');
export const [perfDraws, setPerfDraws] = createSignal('0');
export const [perfPeakDraws, setPerfPeakDraws] = createSignal('0');
export const [perfRenderCalls, setPerfRenderCalls] = createSignal('0');
export const [perfTriangles, setPerfTriangles] = createSignal('0');
export const [perfPeakTriangles, setPerfPeakTriangles] = createSignal('0');
export const [perfGeometries, setPerfGeometries] = createSignal('0');
export const [perfTextures, setPerfTextures] = createSignal('0');
export const [perfBreakdown, setPerfBreakdown] = createSignal('Top: n/a');
export const [trafficDebug, setTrafficDebug] = createSignal('Traffic: n/a');
