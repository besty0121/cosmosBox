export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BodyCategory =
  | 'star'
  | 'rocky'
  | 'gas_giant'
  | 'ice_giant'
  | 'moon'
  | 'asteroid'
  | 'comet'
  | 'black_hole'
  | 'neutron_star';

export type ScaleMode = 'playable' | 'real';

export type GalaxyVisualType =
  | 'andromeda'
  | 'dwarf_elliptical_compact'
  | 'dwarf_elliptical_diffuse';

export type GalaxySpectrumMode = 'optical' | 'infrared' | 'ultraviolet';

export type NebulaVisualType = 'pillars_of_creation' | 'ngc6611_cluster';

export type NebulaSpectrumMode = 'hst_optical' | 'jwst_nircam' | 'jwst_miri';

export type LaunchMode = 'orbit' | 'slingshot' | 'stationary';

export type CameraMode = 'orbit' | 'surface' | 'cinematic' | 'flight' | 'director';

export interface CelestialBody {
  id: string;
  name: string;
  category: BodyCategory;
  /** Mass in kg */
  mass: number;
  /** Physical radius in meters */
  radius: number;
  /** Position in meters (SI) */
  position: Vec3;
  /** Velocity in m/s (SI) */
  velocity: Vec3;
  /** Current acceleration in m/s^2 (SI) */
  acceleration: Vec3;

  // Thermal & surface properties
  /** Effective / surface temperature in Kelvin */
  temperature: number;
  /** Computed radiative equilibrium temperature in Kelvin */
  equilibriumTemp?: number;
  /** Radiated luminosity in Watts (mainly stars) */
  luminosity: number;
  /** Bond albedo [0..1] */
  albedo: number;
  /** Greenhouse warming factor [0..3] */
  greenhouse: number;
  /** Fraction of surface covered in liquid water [0..1] */
  waterFraction: number;
  /** Atmosphere thickness [0..2] */
  atmosphereDensity: number;
  /** Extra heat glow from recent impacts or tidal stress [0..1] */
  impactHeat: number;
  /** Tidal stress indicator [0..1] as body enters Roche limit */
  rocheStress?: number;
  /** Black hole accretion flare boost [0..1] when devouring matter */
  accretionFlare?: number;
  /** Habitability score [0..100] */
  habitability?: number;
  /** Geomagnetic aurora storm intensity [0..1.5] (0 = off, ~0.75 = Kp 5, 1.5 = G5 Kp 9 storm) */
  auroraIntensity?: number;
  /** Transient magnetosphere bow-shock shield flash [0..1] when struck by a solar CME */
  magnetosphereFlash?: number;
  /** Relativistic polar blazar jet power [0..1] ignited during black hole TDE / hyper-accretion */
  blazarJetPower?: number;
  /** Marks a compact degenerate White Dwarf capable of Roche-lobe accretion -> Type Ia Supernova at 1.44 M_sun */
  isWhiteDwarf?: boolean;
  /** Marks Jupiter-like magnetosphere host displaying UV polar aurora + Io plasma torus & flux tube */
  jupiterTorus?: boolean;
  /** Marks volcanic moon Io emitting ballistic sulfur umbrella plumes & feeding the Io plasma torus */
  volcanicIo?: boolean;
  /** Marks a massive foreground galaxy/dark-matter halo acting as a real-time GR gravitational lens */
  isGravitationalLens?: boolean;
  /** Elliptical quadrupole shear [0..0.32] (0 = circular Einstein Ring, ~0.24 = 4-image Einstein Cross) */
  lensShear?: number;
  /** Marks the primary distant background galaxy/quasar target for interactive gravitational lensing */
  isLensSource?: boolean;
  /** Marks a 3D volumetric galaxy assembly (Andromeda M31 and its satellites M32/M110) */
  galaxyType?: GalaxyVisualType;
  /** Dust absorption lane optical depth multiplier [0..1.8] for spiral galaxies */
  galaxyDustOpacity?: number;
  /** Multi-wavelength observation filter for galaxy visualization */
  galaxySpectrumMode?: GalaxySpectrumMode;
  /** Marks a 3D volumetric star-forming nebula or ionizing cluster (Pillars of Creation / NGC 6611) */
  nebulaType?: NebulaVisualType;
  /** Multi-telescope imaging mode (HST Optical / JWST NIRCam / JWST MIRI) */
  nebulaSpectrumMode?: NebulaSpectrumMode;
  /** Continuous infrared dust penetration factor [0 = opaque optical .. 1 = deep IR] */
  nebulaIrPenetration?: number;
  /** Volumetric dust column density multiplier [0.4..1.8] */
  nebulaDensity?: number;

  // Rotation & visual appearance
  /** Sidereal rotation period in seconds */
  rotationPeriod: number;
  /** Current rotation angle in radians */
  rotationAngle: number;
  /** Axial tilt in radians */
  axialTilt: number;
  /** Primary hex color */
  color: string;
  /** Secondary hex color (continents / bands / flare) */
  secondaryColor: string;
  /** Atmosphere glow hex color */
  atmosphereColor: string;
  /** Planetary ring properties */
  hasRings?: boolean;
  ringInner?: number; // multiplier of radius
  ringOuter?: number; // multiplier of radius
  ringColor?: string;
  /** Procedural noise seed */
  seed: number;

  // Orbit trail (in SI meters)
  trail: Vec3[];
  /** Optional parent body id hint for orbital telemetry */
  parentId?: string;
  alive: boolean;
}

export interface DebrisParticle {
  position: Vec3;
  velocity: Vec3;
  /** Base cool color RGB [0..1] */
  baseColor: [number, number, number];
  /** Temperature in K (hot debris glows incandescent orange/white and cools over time) */
  temperature: number;
  /** Visual size scale */
  size: number;
  /** Age in simulated seconds */
  age: number;
  /** Max lifetime in simulated seconds (long for rings, shorter for supernova ejecta) */
  maxAge: number;
  /** Kind of debris for rendering nuances */
  kind: 'impact' | 'roche' | 'supernova';
  alive: boolean;
}

export interface CollisionEvent {
  position: Vec3;
  survivorId: string;
  absorbedName: string;
  survivorName: string;
  impactEnergy: number;
  combinedRadius: number;
  color: string;
  timestamp: number;
  catastrophic?: boolean;
}

export interface TidalDisruptionEvent {
  position: Vec3;
  victimName: string;
  primaryName: string;
  isBlackHole: boolean;
  timestamp: number;
}

export interface SupernovaEvent {
  position: Vec3;
  starName: string;
  remnantCategory: 'neutron_star' | 'black_hole' | 'none';
  remnantId: string;
  color: string;
  timestamp: number;
  isTypeIa?: boolean;
}

export interface CmeWave {
  id: string;
  starId: string;
  starName: string;
  origin: Vec3;
  direction: Vec3;
  radiusMeters: number;
  maxRadiusMeters: number;
  halfAngleRad: number;
  intensity: number;
  color: string;
  hitBodyIds: string[];
}

export interface CmeImpactEvent {
  position: Vec3;
  starName: string;
  targetName: string;
  targetId: string;
  hasAurora: boolean;
  timestamp: number;
}

export interface TidalStreamLink {
  kind: 'tde' | 'roche_bridge';
  donorId: string;
  accretorId: string;
  intensity: number; // [0..1]
  color: string;
}

export interface KilonovaEvent {
  position: Vec3;
  nameA: string;
  nameB: string;
  remnantId: string;
  isBlackHoleMerger: boolean;
  timestamp: number;
}

export interface GravitationalWaveSource {
  active: boolean;
  center: Vec3;
  phase: number;
  amplitude: number;
  separationMeters: number;
}

export interface SimStepEvents {
  collisions: CollisionEvent[];
  tidalDisruptions: TidalDisruptionEvent[];
  supernovas: SupernovaEvent[];
  kilonovas: KilonovaEvent[];
  cmeImpacts: CmeImpactEvent[];
}

export interface SpawnTemplate {
  id: string;
  name: string;
  subtitle: string;
  category: BodyCategory;
  mass: number;
  radius: number;
  temperature: number;
  luminosity: number;
  albedo: number;
  greenhouse: number;
  waterFraction: number;
  atmosphereDensity: number;
  rotationPeriod: number;
  axialTilt: number;
  color: string;
  secondaryColor: string;
  atmosphereColor: string;
  hasRings?: boolean;
  ringInner?: number;
  ringOuter?: number;
  ringColor?: string;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  defaultTimeScale: number; // sim seconds per real second
  defaultCameraDistanceAU: number;
  defaultFocusBodyName?: string;
  defaultCameraAngles?: { azimuthDeg: number; elevationDeg: number };
  defaultShowGravityGrid?: boolean;
  autoLaunchCme?: boolean;
  createBodies: () => CelestialBody[];
  setupGalaxy?: (
    spawnSpiralDisk: (
      core: CelestialBody,
      count: number,
      innerRadiusM: number,
      outerRadiusM: number,
      tiltXDeg: number,
      tiltZDeg: number,
      spinDir: 1 | -1,
      coreHue: 'warm' | 'cool'
    ) => void,
    bodies: CelestialBody[]
  ) => void;
}

export interface ScreenLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  selected: boolean;
  subtitle: string;
}

export interface BodySnapshot {
  id: string;
  name: string;
  category: BodyCategory;
  mass: number;
  radius: number;
  densityKgM3: number;
  speed: number;
  temperature: number;
  equilibriumTemp: number;
  luminosity: number;
  albedo: number;
  greenhouse: number;
  waterFraction: number;
  atmosphereDensity: number;
  impactHeat: number;
  rocheStress: number;
  accretionFlare: number;
  habitability: number;
  auroraIntensity?: number;
  magnetosphereFlash?: number;
  blazarJetPower?: number;
  isWhiteDwarf?: boolean;
  isGravitationalLens?: boolean;
  lensShear?: number;
  galaxyType?: GalaxyVisualType;
  galaxyDustOpacity?: number;
  galaxySpectrumMode?: GalaxySpectrumMode;
  nebulaType?: NebulaVisualType;
  nebulaSpectrumMode?: NebulaSpectrumMode;
  nebulaIrPenetration?: number;
  nebulaDensity?: number;
  jupiterTorus?: boolean;
  volcanicIo?: boolean;
  rotationPeriod: number;
  axialTiltDeg: number;
  spectralClass: string | null;
  distanceToPrimaryAU: number | null;
  primaryName: string | null;
  color: string;
}

export type DirectorEasing = 'cinematicSlow' | 'easeInOut' | 'smoothstep' | 'linear';

export type DirectorResolution = 'viewport' | '720p' | '1080p';

export type DirectorFps = 30 | 60;

export interface DirectorKeyframe {
  id: string;
  name: string;
  /** Transition duration from previous keyframe into this keyframe (seconds) */
  durationSec: number;
  /** Stationary hold time at this keyframe (seconds) */
  holdSec: number;
  easing: DirectorEasing;
  anchorBodyId: string | null;
  anchorBodyName: string | null;
  /** Camera position in scene units relative to anchor / originMeters */
  position: Vec3;
  /** Floating origin fallback in SI meters when anchor body is absent or null */
  originMeters: Vec3;
  quaternion: [number, number, number, number];
  fov: number;
  timeScale: number;
  nebulaSpectrumMode?: NebulaSpectrumMode;
  nebulaIrPenetration?: number;
  galaxySpectrumMode?: GalaxySpectrumMode;
  galaxyDustOpacity?: number;
  auroraIntensity?: number;
  lensShear?: number;
}

export interface DirectorRecordingResult {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

export interface DirectorScriptFile {
  version: 1;
  scenarioId: string;
  exportedAt: number;
  keyframes: DirectorKeyframe[];
}
