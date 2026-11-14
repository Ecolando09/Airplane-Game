import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin, ReorientationPlugin, GLTFExtensionsPlugin, TileCompressionPlugin, UnloadTilesPlugin,
} from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * Google Photorealistic 3D Tiles, streamed through the Map Tiles API and placed
 * in the game's local frame (x east, z south, y up, origin at the map center,
 * y = 0 at the map's lowest ground). Needs a Google Maps API key with the Map
 * Tiles API enabled. Each game load starts one 3D Tiles session (billed by Google).
 */
export class GoogleWorld {
  /** @param opts.light fewer, coarser tiles (PSG1, Low graphics): smoother on small devices */
  constructor({ scene, camera, renderer, apiKey, lat, lon, height, light = false }) {
    this.camera = camera;
    const tiles = (this.tiles = new TilesRenderer());
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UnloadTilesPlugin());
    // Put (lat, lon, height) at the origin with +Y up. The library's frame faces
    // north along +Z; turning it 180° puts north along -Z like the rest of the game.
    tiles.registerPlugin(new ReorientationPlugin({
      lat: THREE.MathUtils.degToRad(lat), lon: THREE.MathUtils.degToRad(lon), height, azimuth: Math.PI, recenter: true,
    }));
    tiles.errorTarget = light ? 16 : 8;
    // Night: the photo city has no night version, so its colours are dimmed and tinted.
    this.mats = new Set();
    this.tint = new THREE.Color(1, 1, 1);
    tiles.addEventListener('load-model', ({ scene: model }) => {
      model?.traverse?.((o) => {
        for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
          if (!m.color) continue;
          this.mats.add(m);
          m.color.copy(this.tint);
        }
      });
    });
    tiles.addEventListener('dispose-model', ({ scene: model }) => {
      model?.traverse?.((o) => {
        for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) this.mats.delete(m);
      });
    });
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    scene.add(tiles.group);
    this.failed = false;
    tiles.addEventListener('load-error', (e) => {
      console.warn('3D tiles load error', e);
      this.errors = (this.errors || 0) + 1;
      if (this.errors > 3 && !this.loadedAny) this.failed = true;
    });
    tiles.addEventListener('load-model', () => (this.loadedAny = true));

    // Height tests against Google's huge photo mesh are expensive: only a few per
    // frame; beyond that, the last answer for that spot is reused.
    this.rayBudget = light ? 3 : 6;
    this.rays = 0;
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.cache = new Map();
    this.frame = 0;
  }

  /** 0 = day .. 1 = night (dark blue), with a warm tint for sunset in between. */
  setNight(v, sunset = false) {
    if (sunset) this.tint.setRGB(1, 0.78, 0.62);
    else this.tint.setRGB(1 - 0.8 * v, 1 - 0.77 * v, 1 - 0.6 * v);
    for (const m of this.mats) m.color.copy(this.tint);
  }

  update(renderer) {
    this.frame++;
    this.rays = 0;
    this.camera.updateMatrixWorld();
    this.tiles.setResolutionFromRenderer(this.camera, renderer);
    this.tiles.update();
  }

  /** Height of whatever is below (ground or rooftop), or null if no tile is loaded there. */
  heightAt(x, z) {
    // Cache per 3 m cell for a few frames; the plane asks several times a frame.
    const key = Math.round(x / 3) * 100000 + Math.round(z / 3);
    const hit = this.cache.get(key);
    if (hit && this.frame - hit.frame < 8) return hit.y;
    if (this.rays >= this.rayBudget) return hit ? hit.y : null; // over budget: stale answer, or the grid
    this.rays++;
    this.ray.set(new THREE.Vector3(x, 6000, z), new THREE.Vector3(0, -1, 0));
    const res = this.ray.intersectObject(this.tiles.group, true);
    const y = res.length ? res[0].point.y : null;
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(key, { y, frame: this.frame });
    return y;
  }

  get loading() {
    const s = this.tiles.stats;
    return s ? s.downloading + s.parsing : 0;
  }
}
