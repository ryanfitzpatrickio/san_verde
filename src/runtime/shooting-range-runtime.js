import {
  setRangeLastShot,
  setRangeScore,
  setRangeShots,
  setRangeStatus,
  setRangeTitle,
  setRangeVisible
} from '../ui/hud-store.js';

export function createShootingRangeRuntime({ state, setStatus }) {
  function getRange(context) {
    return context?.stage?.shootingRange || null;
  }

  function updateFrame(context) {
    const range = getRange(context);
    const playerPosition =
      !state.driveMode && state.characterVehicleState === 'on_foot'
        ? context?.characterController?.position || null
        : null;
    range?.updatePlayer?.(playerPosition);
    syncHud(context);
  }

  function syncHud(context) {
    if (state.driveMode || state.characterVehicleState !== 'on_foot') {
      setRangeVisible(false);
      setRangeTitle('');
      setRangeStatus('');
      setRangeScore('');
      setRangeShots('');
      setRangeLastShot('');
      return;
    }

    const hudState = getRange(context)?.getHudState?.() || null;
    setRangeVisible(Boolean(hudState?.visible));
    setRangeTitle(hudState?.title || '');
    setRangeStatus(hudState?.status || '');
    setRangeScore(hudState?.score || '');
    setRangeShots(hudState?.shots || '');
    setRangeLastShot(hudState?.lastShot || '');
  }

  function getPlayerHint(context) {
    if (state.driveMode || state.characterVehicleState !== 'on_foot') {
      return '';
    }
    return getRange(context)?.getInteractionHint?.() || '';
  }

  function startNearestSession(context) {
    if (
      !context?.characterController ||
      state.driveMode ||
      state.characterVehicleState !== 'on_foot' ||
      state.weaponWheelOpen
    ) {
      return false;
    }

    const result = getRange(context)?.startSessionAtPlayer?.(context.characterController.position);
    if (!result?.ok) {
      if (result?.message) {
        setStatus(result.message);
      }
      syncHud(context);
      return false;
    }

    setStatus(result.message);
    syncHud(context);
    return true;
  }

  function handleWeaponShot(context, shot) {
    const range = getRange(context);
    if (!range || (shot?.weaponId !== 'pistol' && shot?.weaponId !== 'shotgun')) {
      return null;
    }

    const result = range.handleShotRay?.(shot.origin, shot.direction) || null;
    if (result?.message) {
      setStatus(result.message);
    }
    syncHud(context);
    return result;
  }

  return {
    getPlayerHint,
    handleWeaponShot,
    startNearestSession,
    syncHud,
    updateFrame
  };
}
