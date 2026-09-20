#include <common>
#include <logdepthbuf_pars_fragment>
#include "/lygia/generative/snoise.glsl"

uniform vec3 uSunDirection;

varying vec3 vObjectPosition;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

float planetFbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.52;
  for (int i = 0; i < 5; i++) {
    value += amplitude * snoise(p);
    p = p * 2.03 + vec3(7.1, 11.7, 4.3);
    amplitude *= 0.48;
  }
  return value;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vObjectPosition);
  vec3 n = normalize(vWorldNormal);
  float latitude = abs(p.y);

  float continental = planetFbm(p * 1.18 + vec3(2.4, -1.1, 4.7));
  float detail = planetFbm(p * 5.7 + vec3(-5.2, 8.4, 1.6));
  float ridges = 1.0 - abs(snoise(p * 12.0 + vec3(3.0, 9.0, 2.0)));
  float elevation = continental + detail * 0.18 + ridges * 0.08 - latitude * 0.035;
  float land = smoothstep(0.055, 0.105, elevation);
  float coast = smoothstep(0.02, 0.12, elevation);

  vec3 deepOcean = vec3(0.008, 0.055, 0.16);
  vec3 shelfOcean = vec3(0.015, 0.24, 0.40);
  vec3 ocean = mix(deepOcean, shelfOcean, coast * 0.72);

  float moisture = planetFbm(p * 3.3 + vec3(19.0, 2.0, -8.0)) * 0.5 + 0.5;
  float warmth = 1.0 - smoothstep(0.25, 0.9, latitude);
  float desert = smoothstep(0.48, 0.72, warmth) * smoothstep(0.34, 0.62, 1.0 - moisture);
  vec3 vegetation = mix(vec3(0.075, 0.20, 0.08), vec3(0.20, 0.36, 0.12), moisture);
  vec3 dryLand = vec3(0.58, 0.42, 0.22);
  vec3 highland = vec3(0.34, 0.30, 0.23);
  vec3 terrain = mix(vegetation, dryLand, desert);
  terrain = mix(terrain, highland, smoothstep(0.30, 0.62, elevation));

  float polar = smoothstep(0.76, 0.92, latitude + detail * 0.05);
  vec3 color = mix(ocean, terrain, land);
  color = mix(color, vec3(0.82, 0.90, 0.94), polar);

  float diffuse = max(dot(n, normalize(uSunDirection)), 0.0);
  float twilight = smoothstep(-0.18, 0.12, dot(n, normalize(uSunDirection)));
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float oceanGlint = pow(max(dot(reflect(-normalize(uSunDirection), n), viewDir), 0.0), 72.0) * (1.0 - land);
  color *= 0.12 + 0.88 * diffuse;
  color += vec3(0.015, 0.035, 0.075) * twilight;
  color += vec3(0.55, 0.72, 0.86) * oceanGlint * 0.8;

  gl_FragColor = vec4(color, 1.0);
}
