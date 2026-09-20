#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uSunDirection;

varying vec3 vObjectPosition;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float facing = max(dot(viewDir, n), 0.0);
  float rim = pow(1.0 - facing, 2.55);
  float daylight = 0.18 + 0.82 * smoothstep(-0.24, 0.32, dot(n, normalize(uSunDirection)));
  vec3 dusk = vec3(0.94, 0.28, 0.08);
  vec3 sky = vec3(0.16, 0.58, 1.0);
  vec3 color = mix(dusk, sky, daylight);
  gl_FragColor = vec4(color * rim * daylight, rim * daylight * 0.88);
}
