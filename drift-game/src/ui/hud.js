// On-screen HUD: speed, a key legend, and (with DEBUG.telemetry) live
// physics numbers that help when tuning config.js.

import { DEBUG } from '../config.js';

const KEYS = [
  ['W S', 'throttle / brake'],
  ['A D', 'steer'],
  ['Space', 'handbrake'],
  ['R', 'reset'],
  ['C', 'camera'],
];

export class Hud {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-speed"><span class="hud-speed-value">0</span><span class="hud-speed-unit">km/h</span></div>
      <div class="hud-telemetry"${DEBUG.telemetry ? '' : ' hidden'}></div>
      <ul class="hud-keys">${KEYS.map(([k, label]) => `<li><kbd>${k}</kbd>${label}</li>`).join('')}</ul>`;
    container.appendChild(this.root);
    this.speedEl = this.root.querySelector('.hud-speed-value');
    this.telemetryEl = this.root.querySelector('.hud-telemetry');
    this.lastSpeed = -1;
    this.timer = 0;
    this.frames = 0;
  }

  update(dt, phys) {
    const kmh = Math.round(phys.speed * 3.6);
    if (kmh !== this.lastSpeed) {
      this.speedEl.textContent = kmh;
      this.lastSpeed = kmh;
    }
    if (!DEBUG.telemetry) return;
    this.timer += dt;
    this.frames++;
    if (this.timer < 0.25) return;
    const fps = Math.round(this.frames / this.timer);
    this.timer = 0;
    this.frames = 0;
    this.telemetryEl.textContent =
      `angle ${Math.abs(phys.driftAngle).toFixed(0)}°  ·  steer ${((phys.steer * 180) / Math.PI).toFixed(0)}°  ·  ` +
      `rear slip ${phys.rearSlip.toFixed(1)} m/s  ·  ${fps} fps`;
  }
}
