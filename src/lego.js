import * as THREE from 'three';

// Classic Lego colors.
export const LEGO = {
  red: 0xc91a09,
  darkRed: 0x720e0f,
  white: 0xf4f4f4,
  yellow: 0xf2cd37,
  blue: 0x0055bf,
  lightBlue: 0x5a93db,
  tan: 0xe4cd9e,
  darkTan: 0x958a73,
  lightGray: 0xa0a5a9,
  darkGray: 0x6c6e68,
  black: 0x1b2a34,
  green: 0x237841,
  brightGreen: 0x4b9f4a,
  lime: 0xbbe90b,
  sandGreen: 0xa0bcac,
  orange: 0xfe8a18,
  brown: 0x582a12,
  reddishBrown: 0x82422a,
  medAzure: 0x36aebf,
  transClear: 0xd6eef2,
  transBlue: 0x7dbfdd,
};

/**
 * Lambert material with procedural Lego details in world space:
 *  - studs on upward-facing surfaces (`studs` = spacing in meters)
 *  - window grid on vertical faces (`windows` = true)
 * Detail fades out with distance (via screen-space derivatives) to avoid shimmering.
 */
export function legoMaterial({ studs = 0, windows = false, ...params } = {}) {
  const mat = new THREE.MeshLambertMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStud = { value: studs };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 lp = vec4(transformed, 1.0);
        vec3 ln = objectNormal;
        #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          ln = mat3(instanceMatrix) * ln;
        #endif
        vWPos = (modelMatrix * lp).xyz;
        vWNorm = normalize(mat3(modelMatrix) * ln);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNorm;
        uniform float uStud;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${studs ? `
        {
          float up = smoothstep(0.75, 0.95, vWNorm.y);
          vec2 sp = vWPos.xz / uStud;
          float fw = max(fwidth(sp.x), fwidth(sp.y));
          float fade = up * (1.0 - smoothstep(0.08, 0.3, fw));
          vec2 f = fract(sp) - 0.5;
          float d = length(f);
          float top = 1.0 - smoothstep(0.27, 0.31, d);
          float shadow = (1.0 - smoothstep(0.27, 0.36, length(f - vec2(0.06, 0.07)))) * (1.0 - top);
          float hi = (1.0 - smoothstep(0.0, 0.22, length(f + vec2(0.1, 0.1)))) * top;
          diffuseColor.rgb *= 1.0 + fade * (0.06 * top + 0.18 * hi - 0.28 * shadow);
        }` : ''}
        ${windows ? `
        {
          float side = 1.0 - smoothstep(0.2, 0.5, abs(vWNorm.y));
          vec2 t = normalize(vec2(-vWNorm.z, vWNorm.x) + 1e-5);
          vec2 g = vec2(dot(vWPos.xz, t) / 2.6, vWPos.y / 3.2);
          float fw = max(fwidth(g.x), fwidth(g.y));
          float fade = side * (1.0 - smoothstep(0.2, 0.6, fw));
          vec2 f = fract(g);
          float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.35, f.y) * step(f.y, 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.26, 0.36), win * fade * 0.85);
        }` : ''}`
      );
  };
  // Separate program cache key per detail combination.
  mat.customProgramCacheKey = () => `lego-${studs}-${windows}`;
  return mat;
}

/** A single Lego stud as geometry (for the airplane and props). */
export function studGeometry(radius = 0.3, height = 0.17) {
  const g = new THREE.CylinderGeometry(radius, radius, height, 16);
  g.translate(0, height / 2, 0);
  return g;
}
