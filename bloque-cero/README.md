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
| F3 | Rondas 5v5, 3 ubicaciones de sitios (los defensores eligen), desactivador, HUD con reloj y 10 retratos | ✅ (bots provisionales hasta F5) |
| F4 | Preparación: refuerzos, barricadas, trampillas, drones, cámaras, cuerpo a cuerpo | ✅ |
| F5 | Bots: navegación, percepción, combate, tácticas | pendiente |
| F6 | Operadores 8 + 8 y contrajuego de gadgets | pendiente |
| F7 | Animaciones en primera y tercera persona | pendiente |
| F8 | Recarga por partes | pendiente |
| F9 | Audio 3D con oclusión | pendiente |
| F10 | Pulido, pruebas de partidas completas y publicación | pendiente |

## Partida rápida 5v5 (Fase 3)

Reglas de Siege, contra bots:

- **Selección** (25 s): 16 operadores (8 atacantes, 8 defensores), únicos por equipo, con
  arsenal a elegir. La defensa elige la ubicación: **Sótano** (Bodega / Sala de calderas),
  **Planta baja** (Cocina / Comedor) o **Planta alta** (Dormitorio principal / Estudio).
  El ataque elige punto de entrada: calle principal, jardín trasero o camino lateral.
- **Preparación** 45 s: la defensa se coloca; el ataque espera fuera (drones en la Fase 4).
- **Acción** 3:00: el portador del desactivador lo planta en A o B manteniendo F 7 s.
  Plantado, corre 45 s; la defensa lo inutiliza manteniendo F 7 s junto a él.
- **Victoria de ronda**: ataque si toda la defensa está eliminada o derribada, o si el
  desactivador completa sus 45 s; defensa si elimina al ataque antes de plantar, si se
  acaba el tiempo sin plantar o si inutiliza el desactivador. Tras plantar, eliminar al
  ataque no basta.
- **Partida**: el primero en 4 rondas; cambio de bando cada 3 (la 7.ª decide).
- HUD: reloj arriba al centro con los 10 retratos (tachados al morir, parpadean derribados),
  marcador (Tab), cartel de fin de ronda, pantalla final con el mejor jugador.
- Bots provisionales: los defensores sostienen el sitio y disparan a lo que ven; tus
  compañeros atacantes siguen tu rastro. La IA completa llega en la Fase 5.

## Preparación y fortificación (Fase 4)

- **Refuerzos** (defensa, 2 por operador): mira un tramo de pared blanda o una trampilla (desde
  arriba) y mantén **F** 4 s. La placa de acero se despliega con sus pistones hidráulicos y el
  golpe metálico final; la media pared de tu lado pasa a ser acero: ni balas, ni cuerpo a
  cuerpo, ni cargas normales la atraviesan (solo una brecha dura, en la Fase 6).
- **Barricadas** (ilimitadas): mira una puerta o ventana y mantén **F** 1,5 s. Se agujerean a
  balazos y se rompen a golpes (**V**, unos tres golpes para pasar agachado).
- **Drones** (2 por atacante): en la preparación el ataque ve por su dron (**WASD**, **Espacio**
  salta, **clic** marca enemigos 6 s). Cabe por huecos bajos; se destruye de un disparo. En la
  acción, **5** lanza o recupera el dron. El objetivo se localiza al verlo (dron o en persona) y
  entonces aparecen los marcadores A y B.
- **Cámaras** (defensa): **5** para verlas, **A/D** para cambiar, **clic** marca. Seis cámaras
  fijas (dentro y fuera); se destruyen de un disparo.
- Los bots defensores refuerzan el sitio y ponen barricadas durante la preparación, y disparan a
  los drones que ven; los bots atacantes conducen sus drones hacia la casa y marcan defensores.
- Durante la preparación el ataque aún no está desplegado: no se le puede disparar.

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
| F | Reforzar, poner barricada, plantar / inutilizar el desactivador, reanimar (mantener) / presionar la herida si estás derribado |
| V | Golpe cuerpo a cuerpo (rompe barricadas y pladur) |
| 5 | Dron (ataque) / cámaras (defensa) |
| Tab | Marcador |
| Clic / Espacio | (Muerto) cambiar de compañero observado |
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
node tools/smoke3.mjs <carpeta>  # partida completa en el navegador (selección → final)
node tools/smoke4.mjs <carpeta>  # refuerzos, barricadas, golpes, drones y cámaras en el navegador
node tools/mapslice.mjs <carpeta> # cortes cenitales del mapa por planta
```

### Arquitectura

- `src/world/` mundo de vóxeles (chunks de 32³), materiales, trazado de rayos, destrucción, constructor de mapas y el mapa Villa.
- `src/sim/` simulación sin render (corre en Node): física de personaje, operadores, armas,
  plantilla de 16 operadores (`operators.js`), partida por rondas (`match.js`), fortificación
  (`fortify.js`), drones y cámaras (`recon.js`) y bots (`bots.js`).
- `src/client/` sesiones de juego (campo de pruebas, partida), control del jugador y puente
  eventos → sonido/efectos/HUD.
- `src/render/` Three.js: texturas PBR procedurales, mallado voraz por celdas de 16³, shader PBR con volumen de luz y sombra del sol, efectos, arma en primera persona, post-proceso (bloom + ACES).
- `src/audio/` síntesis de sonido con Web Audio (sin archivos).
- `src/ui/`, `src/input/` HUD, interfaz de partida (selección, reloj, marcador), emblemas
  de operador dibujados con Canvas, menús y controles.

### Rendimiento (Fase 1)

- Mapa completo: ~170 llamadas de dibujo por pasada y ~65 000 triángulos gracias al mallado voraz y a las regiones de 8 m.
- Coste de CPU por fotograma: 2–4 ms. Remallado tras una bala: ~1 ms (celdas de 16³); la luz de una brecha se recalcula en trozos de 1,5 ms.
- Calidad adaptativa: si el juego baja de 55 FPS durante 2 s, reduce la resolución interna, el MSAA y el bloom hasta volver a 60.
- Partida 5v5: la simulación de 10 operadores con bots cuesta ~0,16 ms por tick (60 ticks/s).
