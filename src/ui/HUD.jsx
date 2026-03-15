import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import {
  engineName, engineGear, engineRpm, vehicleSpeed,
  playerMode, playerHint,
  uiOpen, performanceOpen,
  playerHidden, setPlayerHidden,
  controlsHidden, setControlsHidden,
  loadPct, loadLabel, loadDone,
  minimapLabel, minimapVisible, setMinimapCanvasRef,
  perfFps, perfFrame, perfDraws, perfPeakDraws, perfRenderCalls,
  perfTriangles, perfPeakTriangles, perfGeometries, perfTextures, perfBreakdown,
} from './hud-store.js';

function EngineOverlay() {
  return (
    <div class="engine-overlay">
      <div class="engine-chip engine-chip-wide">
        <span class="label">Engine</span>
        <span class="value">{engineName()}</span>
      </div>
      <div class="engine-chip">
        <span class="label">Gear</span>
        <span class="value">{engineGear()}</span>
      </div>
      <div class="engine-chip">
        <span class="label">RPM</span>
        <span class="value">{engineRpm()}</span>
      </div>
      <div class="engine-chip">
        <span class="label">Speed</span>
        <span class="value">{vehicleSpeed()}</span>
      </div>
    </div>
  );
}

function PlayerOverlay() {
  function hide() {
    setPlayerHidden(true);
    localStorage.setItem('controlsHidden', '1');
  }
  return (
    <div class="player-overlay">
      <div class="player-status-row">
        <span class="label">Target</span>
        <span class="value">{playerMode()}</span>
      </div>
      <div class="player-controls-row">
        <span class="player-hint">{playerHint()}</span>
        <button class="player-overlay-hide" onClick={hide}>Hide</button>
      </div>
    </div>
  );
}

function PerformanceOverlay() {
  return (
    <div class="performance-overlay">
      <div class="performance-chip"><span class="label">FPS 1s</span><span class="value">{perfFps()}</span></div>
      <div class="performance-chip"><span class="label">CPU Avg</span><span class="value">{perfFrame()}</span></div>
      <div class="performance-chip"><span class="label">Draws/Frame</span><span class="value">{perfDraws()}</span></div>
      <div class="performance-chip"><span class="label">Peak/1s</span><span class="value">{perfPeakDraws()}</span></div>
      <div class="performance-chip"><span class="label">Render Total</span><span class="value">{perfRenderCalls()}</span></div>
      <div class="performance-chip"><span class="label">Tri</span><span class="value">{perfTriangles()}</span></div>
      <div class="performance-chip"><span class="label">Peak Tri</span><span class="value">{perfPeakTriangles()}</span></div>
      <div class="performance-chip"><span class="label">Geo</span><span class="value">{perfGeometries()}</span></div>
      <div class="performance-chip"><span class="label">Tex</span><span class="value">{perfTextures()}</span></div>
      <div class="performance-breakdown">{perfBreakdown()}</div>
    </div>
  );
}

function ControlsOverlay() {
  function hide() {
    setControlsHidden(true);
    localStorage.setItem('controlsOverlayHidden', '1');
  }
  return (
    <div class="controls-overlay">
      <div class="controls-overlay-header">
        <span class="label">Controls</span>
        <button class="player-overlay-hide" onClick={hide}>Hide</button>
      </div>
      <div class="controls-grid">
        <span class="controls-cat">On foot</span>
        <span class="controls-desc"><kbd>WASD</kbd> move <kbd>Shift</kbd> run <kbd>Space</kbd> jump</span>
        <span class="controls-cat" />
        <span class="controls-desc"><kbd>F</kbd> enter car at driver door</span>
        <span class="controls-cat">Driving</span>
        <span class="controls-desc"><kbd>WASD</kbd> drive <kbd>F</kbd> exit car</span>
        <span class="controls-cat" />
        <span class="controls-desc"><kbd>Q</kbd><kbd>E</kbd> shift <kbd>N</kbd> neutral <span class="controls-note">(sim)</span></span>
        <span class="controls-cat">Camera</span>
        <span class="controls-desc">Mouse drag orbit · Scroll zoom</span>
      </div>
    </div>
  );
}

function MinimapOverlay() {
  return (
    <div class="minimap-overlay" classList={{ 'is-hidden': !minimapVisible() }}>
      <div class="minimap-frame">
        <canvas class="minimap-canvas" width="256" height="256" ref={setMinimapCanvasRef} />
        <div class="minimap-cardinal">N</div>
      </div>
      <div class="minimap-caption">
        <span class="label">Map</span>
        <span class="value">{minimapLabel()}</span>
      </div>
    </div>
  );
}

function LoadScreen() {
  return (
    <div class="load-screen" classList={{ 'load-screen-done': loadDone() }}>
      <div class="load-card">
        <div class="load-title">San Verde</div>
        <div class="load-bar-track">
          <div class="load-bar-fill" style={{ width: `${loadPct()}%` }} />
        </div>
        <div class="load-label">{loadLabel()}</div>
      </div>
    </div>
  );
}

function HUD() {
  return (
    <>
      <LoadScreen />
      <Show when={uiOpen()}>
        <EngineOverlay />
      </Show>
      <Show when={uiOpen() && !playerHidden()}>
        <PlayerOverlay />
      </Show>
      <Show when={performanceOpen()}>
        <PerformanceOverlay />
      </Show>
      <Show when={!controlsHidden()}>
        <ControlsOverlay />
      </Show>
      <MinimapOverlay />
    </>
  );
}

export function mountHUD(container) {
  render(HUD, container);
}
