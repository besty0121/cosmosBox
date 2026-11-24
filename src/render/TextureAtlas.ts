import * as THREE from 'three';
import { CelestialBody } from '../types/cosmos';
import { AndromedaDiskMaps, bakeAndromedaDiskMaps } from './AndromedaBaker';

export interface PlanetTextures {
  earthDay: THREE.Texture;
  earthNight: THREE.Texture;
  earthClouds: THREE.Texture;
  earthSpecular: THREE.Texture;
  earthNormal: THREE.Texture;
  moon: THREE.Texture;
  sun: THREE.Texture;
  mercury: THREE.Texture;
  venus: THREE.Texture;
  mars: THREE.Texture;
  jupiter: THREE.Texture;
  saturn: THREE.Texture;
  saturnRing: THREE.Texture;
  uranus: THREE.Texture;
  neptune: THREE.Texture;
  milkyWay: THREE.Texture;
}

class TextureAtlasManager {
  private textures: PlanetTextures | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private andromedaMaps: AndromedaDiskMaps | null = null;
  private loader = new THREE.TextureLoader();

  public init(renderer: THREE.WebGLRenderer): PlanetTextures {
    this.renderer = renderer;
    if (this.textures) return this.textures;

    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const loadTex = (path: string, isSRGB = true, repeat = true): THREE.Texture => {
      const tex = this.loader.load(path);
      tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = maxAniso;
      tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    };

    const milkyWay = loadTex('/textures/2k_milky_way.jpg', true, true);
    milkyWay.mapping = THREE.EquirectangularReflectionMapping;

    const saturnRing = loadTex('/textures/2k_saturn_ring_alpha.png', true, false);

    this.textures = {
      earthDay: loadTex('/textures/2k_earth_daymap.jpg', true),
      earthNight: loadTex('/textures/2k_earth_nightmap.jpg', true),
      earthClouds: loadTex('/textures/2k_earth_clouds.jpg', false),
      earthSpecular: loadTex('/textures/2k_earth_specular.jpg', false),
      earthNormal: loadTex('/textures/2k_earth_normal.jpg', false),
      moon: loadTex('/textures/2k_moon.jpg', true),
      sun: loadTex('/textures/2k_sun.jpg', true),
      mercury: loadTex('/textures/2k_mercury.jpg', true),
      venus: loadTex('/textures/2k_venus_atmosphere.jpg', true),
      mars: loadTex('/textures/2k_mars.jpg', true),
      jupiter: loadTex('/textures/2k_jupiter.jpg', true),
      saturn: loadTex('/textures/2k_saturn.jpg', true),
      saturnRing,
      uranus: loadTex('/textures/2k_uranus.jpg', true),
      neptune: loadTex('/textures/2k_neptune.jpg', true),
      milkyWay,
    };

    return this.textures;
  }

  public get(): PlanetTextures | null {
    return this.textures;
  }

  public getAndromedaMaps(): AndromedaDiskMaps | null {
    if (!this.andromedaMaps && this.renderer) {
      this.andromedaMaps = bakeAndromedaDiskMaps(this.renderer, 2048);
    }
    return this.andromedaMaps;
  }

  /**
   * Resolves which real NASA/ESA 2K texture best represents a given celestial body.
   */
  public resolvePlanetProfile(body: CelestialBody):
    | 'earth'
    | 'moon'
    | 'mercury'
    | 'venus'
    | 'mars'
    | 'jupiter'
    | 'saturn'
    | 'uranus'
    | 'neptune'
    | 'ice'
    | 'lava' {
    const n = body.name;
    if (n.includes('地球') || n.includes('宜居') || n.includes('三体行星') || n.includes('海洋')) {
      return 'earth';
    }
    if (n.includes('水星')) return 'mercury';
    if (n.includes('金星') || n.includes('泰坦')) return 'venus';
    if (n.includes('火星') || n.includes('荒漠')) return 'mars';
    if (n.includes('木星')) return 'jupiter';
    if (n.includes('土星') || n.includes('环状')) return 'saturn';
    if (n.includes('天王星')) return 'uranus';
    if (n.includes('海王星') || n.includes('蓝环')) return 'neptune';
    if (n.includes('冰封') || n.includes('冰卫星')) return 'ice';
    if (n.includes('熔岩')) return 'lava';

    if (body.category === 'moon' || body.category === 'asteroid' || body.category === 'comet') return 'moon';
    if (body.category === 'gas_giant') return body.hasRings ? 'saturn' : 'jupiter';
    if (body.category === 'ice_giant') return 'neptune';
    if (body.waterFraction > 0.25) return 'earth';
    if (body.temperature > 900) return 'lava';
    if (body.temperature < 180) return 'ice';
    return 'mars';
  }
}

export const textureAtlas = new TextureAtlasManager();
