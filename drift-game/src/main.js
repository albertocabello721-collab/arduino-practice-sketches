import './style.css';
import { CARS, PHYSICS } from './config.js';
import { createRenderer, World } from './scene/world.js';
import { CarPhysics } from './physics/carPhysics.js';
import { CarModel } from './car/carModel.js';
import { createPracticeLot } from './maps/practiceLot.js';
import { Input } from './input/input.js';
import { CameraRig } from './camera/cameraRig.js';
import { TireSmoke } from './fx/tireSmoke.js';
import { SkidMarks } from './fx/skidMarks.js';
import { Hud } from './ui/hud.js';

const renderer = createRenderer(document.getElementById('app'));
const world = new World();
const map = createPracticeLot(renderer);
world.scene.add(map.group);

const carDef = CARS[0];
const physics = new CarPhysics(carDef);
const model = new CarModel(carDef);
world.scene.add(model.root);

const smoke = new TireSmoke();
const skids = new SkidMarks();
world.scene.add(smoke.points, skids.mesh);

const input = new Input();
const rig = new CameraRig(window.innerWidth / window.innerHeight);
const hud = new Hud(document.body);

// Physics runs at a fixed rate; rendering blends between the last two steps.
const prev = { x: 0, y: 0, z: 0, heading: 0 };
const pose = { x: 0, y: 0, z: 0, heading: 0 };

function rememberPose() {
  prev.x = physics.x;
  prev.y = physics.y;
  prev.z = physics.z;
  prev.heading = physics.heading;
}

function placeCar({ x, z, heading }) {
  physics.reset(x, z, heading);
  physics.y = map.groundHeight(x, z);
  rememberPose();
  rig.snap();
}

// rear tire contact points, for smoke and skid marks
const rearWheels = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
];
function updateRearWheels() {
  const fx = Math.sin(pose.heading);
  const fz = Math.cos(pose.heading);
  const ax = pose.x - fx * physics.b;
  const az = pose.z - fz * physics.b;
  const half = carDef.dims.track / 2;
  rearWheels[0].x = ax + fz * half;
  rearWheels[0].z = az - fx * half;
  rearWheels[1].x = ax - fz * half;
  rearWheels[1].z = az + fx * half;
  for (const w of rearWheels) w.y = map.groundHeight(w.x, w.z);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  rig.setAspect(w / h);
  smoke.setViewport(h * renderer.getPixelRatio(), rig.camera.fov);
}
window.addEventListener('resize', resize);
resize();
placeCar(map.spawn);

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (input.consume('reset')) placeCar(map.resetPose(physics));
  if (input.consume('camera')) {
    rig.toggle();
    smoke.setViewport(window.innerHeight * renderer.getPixelRatio(), rig.camera.fov);
  }

  const drive = input.drive();
  acc += dt;
  let steps = 0;
  while (acc >= PHYSICS.fixedDt && steps < PHYSICS.maxSubSteps) {
    rememberPose();
    physics.step(PHYSICS.fixedDt, drive, map);
    acc -= PHYSICS.fixedDt;
    steps++;
  }
  if (steps === PHYSICS.maxSubSteps) acc = 0;

  const t = acc / PHYSICS.fixedDt;
  pose.x = prev.x + (physics.x - prev.x) * t;
  pose.y = prev.y + (physics.y - prev.y) * t;
  pose.z = prev.z + (physics.z - prev.z) * t;
  pose.heading = prev.heading + (physics.heading - prev.heading) * t;

  map.update(dt, physics);
  model.update(pose, physics, dt);
  updateRearWheels();
  smoke.update(dt, physics, rearWheels);
  skids.update(physics, rearWheels);
  rig.update(dt, pose, physics);
  world.update(rig.camera, pose.x, pose.y, pose.z);
  hud.update(dt, physics);

  renderer.render(world.scene, rig.camera);
}
requestAnimationFrame(frame);
