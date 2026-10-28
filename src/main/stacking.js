'use strict';

// Resting on the taskbar, her legs hang over it, so her window has to stay above the taskbar's. Windows has
// no levels among the windows that are always on top: whichever was raised last is over the other, and the
// taskbar raises itself when a window opens, a program is switched to, a menu or a preview comes up. The
// window watcher (windows.ps1) says whether the taskbar is over her; this says what to do about it.

// false: nothing; 'soft': put her window on top again; 'hard': it did not stay (the taskbar was still over her
// at the last look, after she was raised): lower her and raise her again, which always puts her on top.
function needsRaise(data, previous, rest) {
  if (rest !== 'taskbar' || !data) return false;
  if (data.over) return previous?.over ? 'hard' : 'soft';
  if (data.taskbar && !previous?.taskbar) return 'soft'; // a click on the taskbar: it comes up over her
  return false;
}

module.exports = { needsRaise };
