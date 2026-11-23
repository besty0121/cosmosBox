import * as THREE from 'three';
import { L_SUN, METERS_TO_SCENE, M_EARTH, SCENE_UNITS_PER_AU } from '../../physics/constants';
import { computeRocheLimit } from '../../physics/thermodynamics';
import { lenVec3 } from '../../physics/vec3';
import { CelestialBody, Vec3 } from '../../types/cosmos';
import { BodyRenderer } from '../BodyRenderer';

export interface ScienceOverlayFlags {
  showHabitableZone: boolean;
  showVectors: boolean;
  showRocheLimits: boolean;
}

/**
 * Scientific 3D Overlays:
 * - Stellar Habitable Zone Annuli (conservative liquid-water orbital band per star)
 * - 3D Velocity (cyan) & Gravitational Acceleration (amber-red) Vector Arrows
 * - Fluid Roche Limit / Black Hole Tidal Disruption Boundary Rings
 */
export class ScienceOverlays {
  private scene: THREE.Scene;

  // Habitable zone rings keyed by star id
  private hzMeshes = new Map<string, THREE.Mesh>();

  // Velocity & acceleration arrow pairs keyed by body id
  private velArrows = new Map<string, THREE.ArrowHelper>();
  private accArrows = new Map<string, THREE.ArrowHelper>();

  // Roche limit rings keyed by primary body id
  private rocheRings = new Map<string, THREE.LineLoop>();

  private tmpDir = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public sync(
    flags: ScienceOverlayFlags,
    bodies: CelestialBody[],
    bodyRenderer: BodyRenderer,
    originMeters: Vec3,
    camera: THREE.PerspectiveCamera,
    selectedBodyId: string | null
  ): void {
    this.syncHabitableZones(flags.showHabitableZone, bodies, originMeters);
    this.syncVectors(flags.showVectors, bodies, bodyRenderer, camera);
    this.syncRocheLimits(flags.showRocheLimits, bodies, bodyRenderer, originMeters, selectedBodyId);
  }

  private syncHabitableZones(visible: boolean, bodies: CelestialBody[], originMeters: Vec3): void {
    const activeStarIds = new Set<string>();

    if (visible) {
      for (const b of bodies) {
        if (!b.alive || b.category !== 'star' || b.luminosity <= 0) continue;
        activeStarIds.add(b.id);

        // Conservative habitable zone bounds in AU: [0.82 * sqrt(L/Lsun), 1.67 * sqrt(L/Lsun)]
        const sqrtL = Math.sqrt(b.luminosity / L_SUN);
        const innerScene = Math.max(4, 0.82 * sqrtL * SCENE_UNITS_PER_AU);
        const outerScene = Math.max(innerScene + 8, 1.67 * sqrtL * SCENE_UNITS_PER_AU);

        let mesh = this.hzMeshes.get(b.id);
        if (!mesh) {
          const geo = new THREE.RingGeometry(0.49, 1.0, 128);
          const mat = new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: /* glsl */ `
              varying vec3 vPos;
              void main() {
                vPos = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader: /* glsl */ `
              varying vec3 vPos;
              void main() {
                float r = length(vPos.xy);
                float t = clamp((r - 0.49) / 0.51, 0.0, 1.0);
                // Soft glowing emerald habitable sweet spot, warm amber inner edge, icy blue outer edge
                float bell = sin(t * 3.14159265);
                vec3 innerEdge = vec3(1.0, 0.58, 0.22);
                vec3 sweetSpot = vec3(0.20, 0.92, 0.55);
                vec3 outerEdge = vec3(0.32, 0.72, 1.0);

                vec3 col = t < 0.35
                  ? mix(innerEdge, sweetSpot, t / 0.35)
                  : mix(sweetSpot, outerEdge, (t - 0.35) / 0.65);

                float edgeHighlight = exp(-pow(t * 14.0, 2.0)) * 0.45 + exp(-pow((1.0 - t) * 14.0, 2.0)) * 0.45;
                float alpha = clamp(bell * 0.19 + edgeHighlight * 0.28, 0.0, 0.42);
                gl_FragColor = vec4(col, alpha);
              }
            `,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.renderOrder = -1;
          this.scene.add(mesh);
          this.hzMeshes.set(b.id, mesh);
        }

        mesh.visible = true;
        mesh.position.set(
          (b.position.x - originMeters.x) * METERS_TO_SCENE,
          (b.position.y - originMeters.y) * METERS_TO_SCENE,
          (b.position.z - originMeters.z) * METERS_TO_SCENE
        );
        mesh.scale.setScalar(outerScene);
      }
    }

    for (const [id, mesh] of this.hzMeshes.entries()) {
      if (!activeStarIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.hzMeshes.delete(id);
      }
    }
  }

  private syncVectors(
    visible: boolean,
    bodies: CelestialBody[],
    bodyRenderer: BodyRenderer,
    camera: THREE.PerspectiveCamera
  ): void {
    const aliveIds = new Set<string>();

    if (visible) {
      for (const b of bodies) {
        if (!b.alive) continue;
        const vis = bodyRenderer.getVisual(b.id);
        if (!vis) continue;
        aliveIds.add(b.id);

        const camDist = camera.position.distanceTo(vis.renderedPos);
        const baseScale = Math.max(vis.renderedRadius * 2.4, camDist * 0.065);

        // Velocity vector (cyan)
        let vArrow = this.velArrows.get(b.id);
        if (!vArrow) {
          vArrow = new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(),
            10,
            0x45e6ff,
            2.2,
            1.1
          );
          this.scene.add(vArrow);
          this.velArrows.set(b.id, vArrow);
        }

        const speed = lenVec3(b.velocity);
        if (speed > 10) {
          vArrow.visible = true;
          vArrow.position.copy(vis.renderedPos);
          this.tmpDir.set(b.velocity.x, b.velocity.y, b.velocity.z).normalize();
          vArrow.setDirection(this.tmpDir);
          const vLen = baseScale * (0.45 + Math.min(2.2, Math.log10(speed / 100 + 1) * 0.55));
          vArrow.setLength(vLen, vLen * 0.22, vLen * 0.11);
        } else {
          vArrow.visible = false;
        }

        // Gravitational acceleration vector (amber-crimson)
        let aArrow = this.accArrows.get(b.id);
        if (!aArrow) {
          aArrow = new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(),
            10,
            0xff6e4a,
            2.0,
            1.0
          );
          this.scene.add(aArrow);
          this.accArrows.set(b.id, aArrow);
        }

        const accMag = lenVec3(b.acceleration);
        if (accMag > 1e-7) {
          aArrow.visible = true;
          aArrow.position.copy(vis.renderedPos);
          this.tmpDir.set(b.acceleration.x, b.acceleration.y, b.acceleration.z).normalize();
          aArrow.setDirection(this.tmpDir);
          const aLen = baseScale * (0.35 + Math.min(1.6, (Math.log10(accMag) + 6) * 0.22));
          aArrow.setLength(Math.max(baseScale * 0.35, aLen), Math.max(baseScale * 0.08, aLen * 0.22), Math.max(baseScale * 0.04, aLen * 0.11));
        } else {
          aArrow.visible = false;
        }
      }
    }

    for (const [id, arrow] of this.velArrows.entries()) {
      if (!aliveIds.has(id)) {
        this.scene.remove(arrow);
        this.velArrows.delete(id);
      }
    }
    for (const [id, arrow] of this.accArrows.entries()) {
      if (!aliveIds.has(id)) {
        this.scene.remove(arrow);
        this.accArrows.delete(id);
      }
    }
  }

  private syncRocheLimits(
    visible: boolean,
    bodies: CelestialBody[],
    bodyRenderer: BodyRenderer,
    originMeters: Vec3,
    selectedBodyId: string | null
  ): void {
    const activeIds = new Set<string>();

    if (visible) {
      // Reference rocky/icy moon probe to show fluid Roche zone around massive bodies
      const refMoon: CelestialBody = {
        id: 'probe',
        name: 'probe',
        category: 'moon',
        mass: 7.34e22,
        radius: 1.74e6,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        acceleration: { x: 0, y: 0, z: 0 },
        temperature: 200,
        luminosity: 0,
        albedo: 0.1,
        greenhouse: 0,
        waterFraction: 0,
        atmosphereDensity: 0,
        impactHeat: 0,
        rotationPeriod: 86400,
        rotationAngle: 0,
        axialTilt: 0,
        color: '#aaa',
        secondaryColor: '#666',
        atmosphereColor: '#000',
        seed: 0,
        trail: [],
        alive: true,
      };

      const selectedBody = selectedBodyId ? bodies.find((b) => b.id === selectedBodyId && b.alive) : null;

      for (const b of bodies) {
        if (!b.alive) continue;
        // Show Roche ring around black holes, gas giants, stars, or the currently selected planet
        const showForBody =
          b.category === 'black_hole' ||
          b.category === 'gas_giant' ||
          b.category === 'ice_giant' ||
          b.id === selectedBodyId ||
          b.mass >= 0.5 * M_EARTH;

        if (!showForBody) continue;
        activeIds.add(b.id);

        const probe =
          selectedBody && selectedBody.id !== b.id && b.mass > selectedBody.mass * 12
            ? selectedBody
            : refMoon;
        const rocheM = computeRocheLimit(b, probe);
        const vis = bodyRenderer.getVisual(b.id);
        const minVisualR = vis ? vis.renderedRadius * 2.35 : 2;
        const ringRadiusScene = Math.max(rocheM * METERS_TO_SCENE, minVisualR);

        let loop = this.rocheRings.get(b.id);
        if (!loop) {
          const segs = 96;
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i < segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
          }
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          const mat = new THREE.LineDashedMaterial({
            color: b.category === 'black_hole' ? 0xff4d79 : 0xff7b42,
            dashSize: 0.12,
            gapSize: 0.08,
            transparent: true,
            opacity: 0.78,
          });
          loop = new THREE.LineLoop(geo, mat);
          loop.computeLineDistances();
          this.scene.add(loop);
          this.rocheRings.set(b.id, loop);
        }

        loop.visible = true;
        loop.position.set(
          (b.position.x - originMeters.x) * METERS_TO_SCENE,
          (b.position.y - originMeters.y) * METERS_TO_SCENE,
          (b.position.z - originMeters.z) * METERS_TO_SCENE
        );
        loop.scale.setScalar(ringRadiusScene);
      }
    }

    for (const [id, loop] of this.rocheRings.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(loop);
        loop.geometry.dispose();
        (loop.material as THREE.Material).dispose();
        this.rocheRings.delete(id);
      }
    }
  }

  public dispose(): void {
    for (const m of this.hzMeshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const a of this.velArrows.values()) this.scene.remove(a);
    for (const a of this.accArrows.values()) this.scene.remove(a);
    for (const r of this.rocheRings.values()) {
      this.scene.remove(r);
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    this.hzMeshes.clear();
    this.velArrows.clear();
    this.accArrows.clear();
    this.rocheRings.clear();
  }
}
