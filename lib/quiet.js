'use strict';
/*
 * "Hide in full screen and presentations" (Windows only), the same check Lapis uses.
 * Asks Windows whether an app is full screen or presenting, with SHQueryUserNotificationState
 * from shell32.dll, called in-process through koffi. No screen capture, microphone or camera.
 * Anything that fails returns false, so the widget simply stays visible.
 */
// QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE, QUNS_APP
const BUSY_STATES = [2, 3, 4, 7];
let shQuery;
function queryState() {
  if (process.platform !== 'win32') return null;
  if (shQuery === undefined) {
    try {
      const koffi = require('koffi');
      shQuery = koffi.load('shell32.dll').func('long __stdcall SHQueryUserNotificationState(_Out_ int *state)');
    } catch (e) { shQuery = null; }
  }
  if (!shQuery) return null;
  try { const out = [0]; return shQuery(out) === 0 ? out[0] : null; } catch (e) { return null; }
}
const fullScreenBusy = () => BUSY_STATES.includes(queryState());

module.exports = { fullScreenBusy, queryState, BUSY_STATES };
