import { createSkidMarkSystem, disposeSkidMarkSystem } from './skid-mark-system.js';

export function initializeStageFeedback(stage, config) {
  if (!stage?.group) {
    return stage;
  }

  stage.skidMarks = createSkidMarkSystem(stage.group, config.vehicleFeedback?.skidMarks);
  return stage;
}

export function disposeStageFeedback(stage) {
  if (!stage?.skidMarks) {
    return;
  }

  disposeSkidMarkSystem(stage.skidMarks);
  stage.skidMarks = null;
}
