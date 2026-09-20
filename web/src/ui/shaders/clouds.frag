#include <common>
#include <logdepthbuf_pars_fragment>
#include "/lygia/generative/snoise.glsl"

uniform vec3 uSunDirection;
uniform float uTime;

varying vec3 vObjectPosition;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

float cloudFbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.56;
  for (int i = 0; i < 4; i++) {
    value += amplitude * snoise(p);
    p = p * 2.08 + vec3(5.3, 9.2, -3.8);
    amplitude *= 0.48;
  }
  return value;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vObjectPosition);
  float latitude = abs(p.y);
  float bands = sin((p.y + cloudFbm(p * 2.1) * 0.12) * 31.0) * 0.09;
  vec3 drift = vec3(uTime * 0.004, 0.0, -uTime * 0.002);
  float broad = cloudFbm(p * 3.2 + drift);
  float wisps = cloudFbm(p * 9.0 - drift * 1.7);
  float field = broad * 0.72 + wisps * 0.28 + bands - latitude * 0.08;
  float alpha = smoothstep(0.17, 0.49, field) * 0.72;
  if (alpha < 0.01) discard;

  vec3 n = normalize(vWorldNormal);
  float light = 0.30 + 0.70 * max(dot(n, normalize(uSunDirection)), 0.0);
  vec3 color = mix(vec3(0.52, 0.62, 0.70), vec3(1.0), light);
  gl_FragColor = vec4(color, alpha);
}
