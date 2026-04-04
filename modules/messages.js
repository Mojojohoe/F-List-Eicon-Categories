/**
 * messages.js — Message bar module
 *
 * Displays a fixed notification bar below the header.
 * Handles timing, slide-in, slide-out, and mid-timer updates
 * entirely internally. Caller just pushes a message.
 *
 * API:
 *   showMessage(text, duration?)
 *     text     — string to display
 *     duration — ms before auto-hide (default 2500)
 *
 * Requires in HTML:
 *   <div id="msg-bar"><span id="msg-text"></span></div>
 *
 * Requires in CSS: see styles block below (inject once at init).
 */

const CSS = `
#msg-bar {
  position: fixed;
  top: var(--header-h, 54px);
  left: 0; right: 0;
  height: 32px;
  background: #172617;
  border-bottom: 1px solid #2a4a2a;
  display: flex;
  align-items: center;
  padding: 0 16px;
  overflow: hidden;
  z-index: 99;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-100%);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
#msg-bar.visible {
  opacity: 1;
  transform: translateY(0);
}
#msg-bar.hiding {
  opacity: 0;
  transform: translateY(-100%);
  transition: opacity 0.35s ease, transform 0.35s ease;
}
#msg-text {
  font-size: 0.78rem;
  color: #6dbf6d;
  font-family: monospace;
  white-space: nowrap;
  will-change: transform, opacity;
}
@keyframes _msgOut {
  from { transform: translateX(0);     opacity: 1; }
  to   { transform: translateX(48px);  opacity: 0; }
}
@keyframes _msgIn {
  from { transform: translateX(-48px); opacity: 0; }
  to   { transform: translateX(0);     opacity: 1; }
}
`;

const bar  = document.getElementById('msg-bar');
const text = document.getElementById('msg-text');

let hideTimer   = null;
let fadeTimer   = null;
let swapTimer   = null;
let isVisible   = false;

// Inject CSS once
const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);

export function showMessage(msg, duration = 2500) {
  clearTimeout(hideTimer);
  clearTimeout(fadeTimer);
  clearTimeout(swapTimer);

  if (isVisible) {
    // Bar is already up — slide old text out right, then bring new text in from left
    text.style.animation = '_msgOut 0.12s ease-in forwards';
    swapTimer = setTimeout(() => {
      text.textContent = msg;
      text.style.animation = '_msgIn 0.16s ease-out forwards';
      scheduleHide(duration);
    }, 120);
  } else {
    // Fresh appearance — just set text and slide bar down
    text.style.animation = 'none';
    text.textContent = msg;
    bar.classList.remove('hiding');
    void bar.offsetWidth; // force reflow to restart CSS transition
    bar.classList.add('visible');
    isVisible = true;
    scheduleHide(duration);
  }
}

function scheduleHide(duration) {
  hideTimer = setTimeout(() => {
    bar.classList.add('hiding');
    fadeTimer = setTimeout(() => {
      bar.classList.remove('visible', 'hiding');
      isVisible = false;
    }, 380);
  }, duration);
}
