# Bloque Cero

Shooter táctico 5 contra 5 por rondas inspirado en Rainbow Six Siege, con destrucción
de vóxeles de 12,5 cm: cada bala abre un agujero en el pladur, las cargas abren
boquetes y el ladrillo aguanta.

**Jugar:** abre `dist/bloque-cero.html` en Chrome, Edge o Firefox (hace falta WebGL2).
Es un único archivo HTML autónomo: no necesita servidor ni conexión.

## Estado

| Fase | Contenido | Estado |
| --- | --- | --- |
| F1 | Motor de vóxeles, mapa Villa, materiales PBR, iluminación, movimiento FPS, asomarse, disparos que agujerean | ✅ |
| F2 | Operadores tácticos, zonas de impacto, derribo con sangrado, reanimación, arsenal de 11 armas | ✅ |
| F3 | Rondas 5v5, 3 ubicaciones de sitios (los defensores eligen), desactivador, HUD con reloj y 10 retratos | pendiente |
| F4 | Preparación: refuerzos, barricadas, trampillas, drones, cámaras | pendiente |
| F5 | Bots: navegación, percepción, combate, tácticas | pendiente |
| F6 | Operadores 8 + 8 y contrajuego de gadgets | pendiente |
| F7 | Animaciones en primera y tercera persona | pendiente |
| F8 | Recarga por partes | pendiente |
| F9 | Audio 3D con oclusión | pendiente |
| F10 | Pulido, pruebas de partidas completas y publicación | pendiente |

## Controles

| Tecla | Acción |
| --- | --- |
| WASD / Mayús | Moverse / correr |
| C / Z | Agacharse / cuerpo a tierra |
| Q / E | Asomarse a izquierda / derecha (alterna, configurable) |
| Espacio | Saltar obstáculo (alféizares, mesas, muros bajos) |
| Clic / clic derecho | Disparar / apuntar |
| R | Recargar |
| 1–4, rueda | Cambiar de arma |
| F | Reanimar a un compañero (mantener) / presionar la herida si estás derribado |
| G | (Campo de pruebas) carga de brecha en la pared que miras |
| J / K / L | (Campo de pruebas) derribar al compañero / reiniciar el campo / cambiar de arsenal |
| F3 | Medidor de rendimiento |
| Esc | Pausa |

## Desarrollo

```bash
npm install
npm run build        # genera dist/bloque-cero.html y dist/artifact.html
npm test             # tests de simulación en Node (sin navegador)
node tools/smoke.mjs <carpeta>   # prueba de humo en Chromium headless con capturas
node tools/mapslice.mjs <carpeta> # cortes cenitales del mapa por planta
```

### Arquitectura

- `src/world/` mundo de vóxeles (chunks de 32³), materiales, trazado de rayos, destrucción, constructor de mapas y el mapa Villa.
- `src/sim/` simulación sin render (corre en Node): física de personaje, operadores, armas y partida.
- `src/render/` Three.js: texturas PBR procedurales, mallado voraz por celdas de 16³, shader PBR con volumen de luz y sombra del sol, efectos, arma en primera persona, post-proceso (bloom + ACES).
- `src/audio/` síntesis de sonido con Web Audio (sin archivos).
- `src/ui/`, `src/input/` HUD, menús y controles.

### Rendimiento (Fase 1)

- Mapa completo: ~170 llamadas de dibujo por pasada y ~65 000 triángulos gracias al mallado voraz y a las regiones de 8 m.
- Coste de CPU por fotograma: 2–4 ms. Remallado tras una bala: ~1 ms (celdas de 16³); la luz de una brecha se recalcula en trozos de 1,5 ms.
- Calidad adaptativa: si el juego baja de 55 FPS durante 2 s, reduce la resolución interna, el MSAA y el bloom hasta volver a 60.
