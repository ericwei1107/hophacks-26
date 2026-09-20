#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vObjectPosition;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

void main() {
  vObjectPosition = normalize(position);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
