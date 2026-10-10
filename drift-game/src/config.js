// Every car stat and tuning value lives here. Units: meters, seconds, kg,
// newtons, kW, degrees (for angles you'd tweak by hand).

export const PHYSICS = {
  fixedDt: 1 / 120, // physics step (s); the loop runs as many as needed per frame
  maxSubSteps: 8, // cap per frame so a long hitch doesn't freeze the tab
  gravity: 9.81,
};

export const CARS = [
  {
    id: 'kumo',
    name: 'Kumo AE',
    color: { body: '#d63a2f', wheel: '#c8ccd2' },

    // Size. Collision box is length x width; axles sit at +-wheelbase/2 around
    // the center of mass, shifted by frontWeight.
    dims: { length: 4.2, width: 1.7, height: 1.3, wheelbase: 2.4, track: 1.45, wheelRadius: 0.31 },

    mass: 1150,
    frontWeight: 0.53, // share of the car's weight on the front axle
    cgHeight: 0.45, // center of mass height: more = more weight shift on brake/throttle
    inertiaScale: 1.05, // yaw inertia multiplier: higher = rotates lazier

    // Engine and brakes
    power: 95, // kW at the wheels; sets acceleration at speed and top speed
    maxDriveForce: 5600, // N; caps the push at low speed (traction)
    reverseForce: 3500,
    maxReverseSpeed: 8, // m/s
    brakeForce: 10000,
    drag: 0.55, // aero drag, N per (m/s)^2
    rollingResistance: 0.012, // share of weight
    throttleRise: 3.5, // keyboard throttle ramps 0->1 at this rate per second
    throttleFall: 6,

    // Tires. Each axle's sideways force rises with slip angle up to the peak,
    // then drops to its slide grip once the tire is sliding (the rear's drop is
    // what keeps a drift going). Past spinFrom the rear climbs back to spinGrip,
    // an arcade safety net so deep angles settle instead of spinning out.
    frontGrip: 1.05, // peak friction coefficient
    rearGrip: 1.0, // (tuning slider)
    peakSlipFront: 7, // deg
    peakSlipRear: 7, // deg
    frontSlideGrip: 0.85, // share of peak grip left once the tire slides
    rearSlideGrip: 0.7,
    slideFalloff: 10, // deg past the peak to reach the slide grip
    spinFrom: 40, // deg of rear slip where the anti-spin starts
    spinTo: 75,
    spinGrip: 1.15,

    // Drift behavior
    throttleOversteer: 0.5, // full throttle while cornering cuts rear grip by this share
    handbrakeGrip: 0.3, // rear grip multiplier while the handbrake is held
    handbrakeDrag: 0.35, // braking from the locked rear wheels, share of rear load
    handbrakeDriveCut: 0.6, // share of engine push lost while the handbrake is held
    yawDamping: 0.6, // 1/s; resists spinning, higher = calmer rotation

    // Steering
    steerLock: 40, // deg, max front wheel angle; limits how deep a drift you can hold (tuning slider)
    steerSlip: 10, // deg, how hard a held steering key makes the front tires bite at speed
    steerSpeed: 3.2, // rad/s, how fast the wheels turn toward the target
    selfAlign: 0.9, // with no steering key, wheels follow the slide this much (auto counter-steer)

    // Visual
    rideHeight: 0.14, // body gap above the wheels (tuning slider)
    bodyRoll: 0.022, // rad of lean per m/s^2 of sideways acceleration
    bodyPitch: 0.012, // rad of pitch per m/s^2 of forward acceleration
    // Side profile of the low-poly body: heights (m) above the body's bottom
    // edge, and z positions (m, + toward the front, 0 = center of the car).
    look: {
      nose: 0.42, // front edge of the hood
      cowl: 0.58, // hood height where the windshield starts
      deck: 0.62, // rear deck height
      tail: 0.6, // rear edge
      roof: 1.04,
      windshield: [0.86, 0.12], // z at its bottom and top
      rearWindow: [-0.92, -1.52], // z at its top and bottom
      cabinWidth: 0.8, // share of the body width
    },
  },
];

export const CAMERA = {
  chase: {
    distance: 6.4,
    height: 2.3,
    lookHeight: 1.0,
    lookAhead: 2.5,
    fov: 62,
    driftSwing: 0.35, // share of the drift angle the camera swings toward the slide
    maxSwing: 25, // deg
    yawFollow: 5.5, // 1/s, how quickly the camera swings around behind the car
    posFollow: 10, // 1/s, how quickly it catches up in position
  },
  hood: {
    offset: { x: 0, y: 1.15, z: 0.9 }, // from the car's center, in car space (z = forward)
    lookDistance: 20,
    fov: 72,
  },
};

export const FX = {
  smoke: {
    maxParticles: 500,
    slipStart: 3, // m/s of rear sideways slide before smoke appears
    slipFull: 10, // m/s for full smoke
    rate: 45, // particles per second per wheel at full slide
    life: 2.2, // s
    startSize: 0.7, // m
    endSize: 5,
    opacity: 0.42,
    rise: 0.7, // m/s
    color: '#e8e6e2',
  },
  skids: {
    maxSegments: 4000,
    slipStart: 2.5, // m/s of rear sideways slide before marks appear
    slipFull: 9,
    width: 0.24, // m
    minSegment: 0.3, // m between points
    opacity: 0.55,
    color: '#141414',
  },
};

export const DEBUG = {
  telemetry: true, // small readout of drift angle, steering and rear slip
};
