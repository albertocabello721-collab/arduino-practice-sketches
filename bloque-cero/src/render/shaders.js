// GLSL compartido: iluminación PBR (GGX), volumen de luz ambiente, sombra del sol
// y luces dinámicas (fogonazos, explosiones). Todo en espacio lineal HDR; el
// tone mapping ACES se aplica en el post-proceso.

export const MAX_DYN_LIGHTS = 6;

export const LIGHTING_GLSL = /* glsl */ `
uniform sampler3D uLight;
uniform vec3 uLightMin;
uniform vec3 uLightInvSize;
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uWarmColor;
uniform vec3 uCoolColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec4 uDynPos[${MAX_DYN_LIGHTS}];   // xyz posición, w radio
uniform vec4 uDynCol[${MAX_DYN_LIGHTS}];   // rgb color*intensidad
uniform int uDynCount;
uniform float uAmbientMin;

const float PI = 3.14159265;

float shadowAt(vec3 wp, vec3 n) {
  // las caras que no miran al sol no reciben luz directa: no hace falta consultar la sombra
  if (dot(n, uSunDir) <= 0.0) return 0.0;
  vec4 sc = uShadowMatrix * vec4(wp + n * 0.035, 1.0);
  vec3 p = sc.xyz / sc.w;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float t = uShadowTexel * 0.75;
  // 4 tomas con PCF por hardware (16 comparaciones filtradas)
  float s = texture(uShadowMap, vec3(p.xy + vec2(t, t), p.z - 0.0008));
  s += texture(uShadowMap, vec3(p.xy + vec2(-t, t), p.z - 0.0008));
  s += texture(uShadowMap, vec3(p.xy + vec2(t, -t), p.z - 0.0008));
  s += texture(uShadowMap, vec3(p.xy + vec2(-t, -t), p.z - 0.0008));
  return s * 0.25;
}

// canales del volumen: r cielo, g cálida, b fría (0..1)
vec3 ambientAt(vec3 wp, vec3 n) {
  vec3 lp = (wp + n * 0.14 - uLightMin) * uLightInvSize;
  vec3 L;
  if (any(lessThan(lp, vec3(0.0))) || any(greaterThan(lp, vec3(1.0)))) L = vec3(wp.y > -0.2 ? 1.0 : 0.0, 0.0, 0.0);
  else L = texture(uLight, lp).rgb;
  float sky = L.r * L.r;
  float warm = L.g * L.g * (3.0 - 2.0 * L.g);
  float cool = L.b * L.b * (3.0 - 2.0 * L.b);
  // cielo: más azul si la normal mira arriba, más cálido (rebote del suelo) si mira abajo
  vec3 skyCol = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
  return skyCol * sky + uWarmColor * warm + uCoolColor * cool + vec3(uAmbientMin);
}

float D_GGX(float NdH, float a) { float a2 = a * a; float d = NdH * NdH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d + 1e-5); }
float G_Smith(float NdV, float NdL, float r) { float k = (r + 1.0) * (r + 1.0) / 8.0; return (NdV / (NdV * (1.0 - k) + k)) * (NdL / (NdL * (1.0 - k) + k)); }
vec3 F_Schlick(float c, vec3 F0) { return F0 + (1.0 - F0) * pow(1.0 - c, 5.0); }

vec3 brdfLight(vec3 n, vec3 v, vec3 l, vec3 albedo, float rough, float metal, vec3 radiance) {
  float NdL = max(dot(n, l), 0.0);
  if (NdL <= 0.0) return vec3(0.0);
  vec3 h = normalize(v + l);
  float NdV = max(dot(n, v), 1e-3), NdH = max(dot(n, h), 0.0), VdH = max(dot(v, h), 0.0);
  float a = max(rough * rough, 0.002);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F_Schlick(VdH, F0);
  vec3 spec = D_GGX(NdH, a) * G_Smith(NdV, NdL, rough) * F / (4.0 * NdV * NdL + 1e-4);
  vec3 kd = (1.0 - F) * (1.0 - metal);
  return (kd * albedo / PI + spec) * radiance * NdL;
}

vec3 shade(vec3 wp, vec3 n, vec3 geoN, vec3 v, vec3 albedo, float rough, float metal, float ao, float sunVis) {
  vec3 amb = ambientAt(wp, geoN);
  float NdV = max(dot(n, v), 1e-3);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 Fa = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
  vec3 col = (1.0 - Fa) * (1.0 - metal) * albedo * amb * ao;
  // especular ambiente aproximado: reflejo difuso del entorno según rugosidad
  col += Fa * amb * ao * (0.35 + 0.65 * (1.0 - rough)) * 0.8;
  if (sunVis > 0.0) col += brdfLight(n, v, uSunDir, albedo, rough, metal, uSunColor * sunVis) * PI;
  for (int i = 0; i < ${MAX_DYN_LIGHTS}; i++) {
    if (i >= uDynCount) break;
    vec4 lp = uDynPos[i];
    vec3 d = lp.xyz - wp;
    float dist = length(d);
    if (dist > lp.w) continue;
    float att = pow(clamp(1.0 - dist / lp.w, 0.0, 1.0), 2.0) / (1.0 + dist * dist);
    col += brdfLight(n, v, d / dist, albedo, rough, metal, uDynCol[i].rgb * att) * PI;
  }
  return col;
}

vec3 applyFog(vec3 col, float dist, vec3 wp) {
  float f = 1.0 - exp(-dist * uFogDensity);
  return mix(col, uFogColor, clamp(f, 0.0, 0.85));
}

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
`;

export const WORLD_VERT = /* glsl */ `
precision highp float;
precision highp int;
invariant gl_Position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec4 position;
in vec4 aData;
out vec3 vWorld;
out float vAO;
flat out int vFace;
flat out int vLayer;
flat out int vTint;
flat out int vFlags;
void main() {
  vec4 wp = modelMatrix * vec4(position.xyz, 1.0);
  vWorld = wp.xyz;
  vFace = int(position.w + 0.5);
  vLayer = int(aData.x + 0.5);
  vAO = aData.y / 3.0;
  vTint = int(aData.z + 0.5);
  vFlags = int(aData.w + 0.5);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const WORLD_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler3D;
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormal;
uniform vec4 uLayerInfo[64];     // x escala uv, y fuerza normal, z emisivo, w recorte
uniform vec3 uTints[32];
uniform vec3 cameraPosition;
uniform float uGlass;            // 1 en la pasada de cristal
uniform float uEmissive;         // intensidad de lámparas
uniform float uTime;
${LIGHTING_GLSL}
in vec3 vWorld;
in float vAO;
flat in int vFace;
flat in int vLayer;
flat in int vTint;
flat in int vFlags;
out vec4 fragColor;

void faceFrame(int f, out vec3 N, out vec3 T, out vec3 B, out vec2 uv, vec3 p) {
  if (f == 0) { N = vec3(1,0,0); T = vec3(0,0,-1); B = vec3(0,1,0); uv = vec2(-p.z, p.y); }
  else if (f == 1) { N = vec3(-1,0,0); T = vec3(0,0,1); B = vec3(0,1,0); uv = vec2(p.z, p.y); }
  else if (f == 2) { N = vec3(0,1,0); T = vec3(1,0,0); B = vec3(0,0,-1); uv = vec2(p.x, -p.z); }
  else if (f == 3) { N = vec3(0,-1,0); T = vec3(1,0,0); B = vec3(0,0,1); uv = vec2(p.x, p.z); }
  else if (f == 4) { N = vec3(0,0,1); T = vec3(1,0,0); B = vec3(0,1,0); uv = vec2(p.x, p.y); }
  else { N = vec3(0,0,-1); T = vec3(-1,0,0); B = vec3(0,1,0); uv = vec2(-p.x, p.y); }
}

void main() {
  vec3 N, T, B; vec2 uv;
  faceFrame(vFace, N, T, B, uv, vWorld);
  vec4 info = uLayerInfo[vLayer];
  uv *= info.x;
  float layer = float(vLayer);
  vec4 A = texture(uAlbedo, vec3(uv, layer));
  vec4 NT = texture(uNormal, vec3(uv, layer));
#ifdef CUTOUT
  if (NT.a < 0.5) discard;
#endif
  vec3 albedo = A.rgb * uTints[vTint];
  // variación a gran escala para romper la repetición del patrón
  float macro = vnoise(vWorld.xz * 0.37 + vWorld.zy * 0.29 + vWorld.y * 0.21);
  albedo *= 0.9 + macro * 0.2;
  float rough = clamp(A.a + (macro - 0.5) * 0.12, 0.03, 1.0);
  float metal = info.w > 0.5 ? 0.0 : NT.a;
  vec2 tn = (NT.rg * 2.0 - 1.0) * info.y;
  vec3 n = normalize(T * tn.x + B * tn.y + N * sqrt(max(1.0 - dot(tn, tn), 0.05)));
  vec3 V = normalize(cameraPosition - vWorld);
  // oclusión: AO de vértice (suavizado) × cavidad de la textura
  float ao = mix(0.22, 1.0, vAO * vAO * (3.0 - 2.0 * vAO)) * mix(1.0, NT.b, 0.8);
  if ((vFlags & 1) == 1) ao *= 0.8;   // caras rotas: un poco más oscuras
  float sunVis = shadowAt(vWorld, N);
  vec3 col = shade(vWorld, n, N, V, albedo, rough, metal, ao, sunVis);
  if (info.z > 0.5) col = albedo * (info.z > 1.5 ? 2.2 : uEmissive);   // lámparas (tinte = color) y pantallas
  float dist = length(cameraPosition - vWorld);
  col = applyFog(col, dist, vWorld);
  float alpha = 1.0;
  if (uGlass > 0.5) {
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    alpha = clamp(0.16 + fres * 0.7, 0.0, 0.92);
    col += uSkyColor * fres * 0.4;
  }
  fragColor = vec4(col, alpha);
}
`;

// Cielo: degradado físico aproximado con disco solar y horizonte con bruma.
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
export const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 30.0 + pow(sd, 18.0) * 0.35 + pow(sd, 3.0) * 0.08);
  // nubes altas suaves
  if (d.y > 0.02) {
    vec2 cp = d.xz / (d.y + 0.15) * 1.6;
    float c = vn(cp) * 0.55 + vn(cp * 2.3) * 0.3 + vn(cp * 5.1) * 0.15;
    c = smoothstep(0.55, 0.85, c) * smoothstep(0.02, 0.25, d.y);
    col = mix(col, uHorizon * 1.25 + uSunColor * 0.1, c * 0.55);
  }
  // colinas lejanas
  float ang = atan(d.z, d.x);
  float hill = 0.035 + vn(vec2(ang * 6.0, 1.0)) * 0.05 + vn(vec2(ang * 17.0, 3.0)) * 0.02;
  if (d.y < hill) col = mix(vec3(0.05, 0.07, 0.06), uHorizon * 0.55, smoothstep(-0.02, hill, d.y) * 0.6);
  if (d.y < 0.0) col = vec3(0.04, 0.05, 0.04);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Pre-pasada de profundidad: mismo vértice que el mundo, fragmento trivial
// (solo descarta en materiales con recorte, como hojas o escaleras de mano).
export const PREPASS_FRAG = /* glsl */ `
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;
