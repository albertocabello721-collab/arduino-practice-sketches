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
| F2 | Operadores tácticos, zonas de impacto, derribo con sangrado, reanimación, arsenal | ✅ |
| F3 | Rondas 5v5, 3 ubicaciones de sitios (los defensores eligen), desactivador, HUD con reloj y 10 retratos | ✅ |
| F4 | Preparación: refuerzos, barricadas, trampillas, drones, cámaras, cuerpo a cuerpo | ✅ |
| F5 | Bots: navegación, percepción, combate, tácticas por bando, órdenes (H), marcas (T), chat de equipo, depuración (P) | ✅ |
| F6 | Operadores 8 + 8 y contrajuego de gadgets | en curso: arsenal ✅ · plantilla de 16 ✅ · granadas ✅ · resto de gadgets y habilidades en camino |
| F7 | Animaciones en primera y tercera persona | pendiente |
| F8 | Recarga por partes | pendiente |
| F9 | Audio 3D con oclusión | pendiente |
| F10 | Pulido, pruebas de partidas completas y publicación | pendiente |

## Arsenal (Fase 6)

Las 10 armas de la tabla del documento:

| Arma | Tipo | Daño | Cadencia | Cargador | Recarga táctica / vacía |
| --- | --- | --- | --- | --- | --- |
| FA-7 Halcón | Fusil de asalto | 44 | 780 | 30+1 | 2,4 / 3,1 s |
| FA-9 Lince | Fusil de asalto | 39 | 860 | 30+1 | 2,3 / 3,0 s |
| SF-45 Avispa | Subfusil | 33 | 870 | 30+1 | 2,1 / 2,8 s |
| SF-9 Mamba | Subfusil | 27 | 950 | 40+1 | 2,2 / 2,9 s |
| E-12 Toro | Escopeta de bombeo | 8 × 22 | 70 | 7 | 0,55 s por cartucho |
| T-308 Búho | Tirador semiautomático | 67 | 380 | 10+1 | 2,6 / 3,3 s |
| AL-60 Oso | Ametralladora ligera | 47 | 700 | 80 | 5,0 s |
| P-9 Colibrí | Pistola | 42 | tiro a tiro | 15+1 | 1,6 / 2,1 s |
| R-44 Tejón | Revólver | 70 | tiro a tiro | 6 | 2,8 s |
| PA-3 Tábano | Pistola ametralladora | 22 | 1100 | 20+1 | 1,9 / 2,4 s |

- Cabeza: baja inmediata (los perdigones, ×1,5); torso ×1; extremidades ×0,75.
- Caída de daño: fusiles 100 % hasta 25 m y 75 % desde 35 m; subfusiles de 20 a 30 m;
  escopetas de 5 a 15 m hasta el 30 %.
- Penetración: una pared blanda o una barricada deja pasar el 70 % del daño; un mueble de
  madera, el 80 %; hormigón, metal y muros reforzados la paran.
- Retroceso con patrón fijo por arma: los 3 primeros disparos casi verticales y luego una
  deriva a izquierda y derecha que se puede aprender, con un poco de azar. Al dejar de
  disparar la vista recupera el 70 % de lo que no hayas compensado tirando del ratón.
  Agachado −10 %, tumbado −20 %.
- Modos de disparo con **B**: automático, ráfaga de 3 y tiro a tiro según el arma.

## Operadores (Fase 6)

Velocidad/blindaje, armas, gadget secundario a elegir y habilidad (tecla X):

| Ataque | V/B | Principal | Secundaria | Gadget | Habilidad |
| --- | --- | --- | --- | --- | --- |
| TERMO | 2/2 | FA-7 o E-12 | P-9 | Brecha o claymore | 2 cargas térmicas (abren muros reforzados) |
| ROMPE | 3/1 | FA-9 o SF-45 | P-9 | Humo o cegadora | 2 proyectiles de brecha a 40 m |
| MURALLA | 1/3 | — (escudo) | P-9 o R-44 | Fragmentación o humo | Escudo balístico con 4 destellos |
| RADAR | 2/2 | FA-7 o SF-9 | PA-3 | Claymore o cegadora | 3 pulsos de escaneo |
| PULGA | 2/2 | FA-9 o E-12 | P-9 | Brecha o fragmentación | Dron de choque (6 cargas) |
| CHISPA | 3/1 | SF-45 o FA-7 | PA-3 | Brecha o claymore | 3 granadas PEM |
| NUBE | 2/2 | FA-9 o AL-60 | P-9 | Cegadora o brecha | 3 humos remotos |
| LUMEN | 3/1 | T-308 o SF-9 | P-9 | Humo o claymore | Visor térmico 3x |

| Defensa | V/B | Principal | Secundaria | Gadget | Habilidad |
| --- | --- | --- | --- | --- | --- |
| VOLTIO | 3/1 | SF-9 o E-12 | P-9 | Alambre o C4 | 4 baterías de choque |
| SILENCIO | 2/2 | SF-45 o E-12 | PA-3 | Escudo o alambre | 4 inhibidores |
| CEPO | 2/2 | SF-9 o FA-9 | P-9 | Escudo o alarma | 5 minas láser |
| OJO | 2/2 | SF-45 o E-12 | R-44 | C4 o alambre | 3 cámaras adhesivas |
| CORAZA | 1/3 | FA-9 o SF-45 | P-9 | Alambre o impacto | 5 placas de armadura |
| GUARDIÁN | 3/1 | FA-7 o E-12 | P-9 | Escudo o cámara blindada | 2 interceptores |
| REMEDIO | 1/3 | SF-45 o E-12 | P-9 | Alambre o cámara blindada | Pistola de estimulantes (3) |
| TIZÓN | 2/2 | AL-60 o SF-9 | P-9 | Escudo o alambre | 3 botes de gas |

La selección muestra el papel, los números de la habilidad y sus contras. Los gadgets y las
habilidades se activan en las siguientes rondas de la Fase 6.

## Gadgets secundarios (Fase 6)

Se usan con **G**; el que llevas y sus cargas salen abajo a la derecha, junto a la munición.

- **Granada de fragmentación** (×2): rebota; a los 3 s explota: letal a 1,5 m y daño hasta 3 m.
  Las paredes duras protegen; el material blando atenúa y se rompe cerca.
- **Granada de humo** (×2): se abre al pararse; nube de 4 m de radio durante 10 s que tapa la
  vista (también a los bots) y deja un velo gris si estás dentro.
- **Granada cegadora** (×3): a los 1,5 s ciega hasta 3,5 s a quien la ve de frente (menos de
  lado o de espaldas), con pitido en los oídos. Un bot cegado no ve nada mientras dura.
- **Granada de impacto** (×2, defensa): explota al tocar; abre 1 m de pared blanda.
- Carga de brecha, claymore, C4, alambre, escudo desplegable, cámara blindada y alarma de
  proximidad: en la siguiente ronda.

## Partida rápida 5v5 (Fase 3)

Reglas de Siege, contra bots:

- **Selección** (25 s): 16 operadores (8 atacantes, 8 defensores), únicos por equipo, con
  arsenal a elegir. La defensa elige la ubicación: **Sótano** (Bodega / Sala de calderas),
  **Planta baja** (Cocina / Comedor) o **Planta alta** (Dormitorio principal / Estudio).
  El ataque elige punto de entrada: calle principal, jardín trasero o camino lateral.
- **Preparación** 45 s: la defensa se coloca; el ataque espera fuera (drones en la Fase 4).
- **Acción** 3:00: el portador del desactivador lo planta en A o B manteniendo F 7 s.
  Plantado, corre 45 s; la defensa lo inutiliza manteniendo F 7 s junto a él o lo destruye a
  balazos (aguanta 150 de daño; las balas del ataque no le afectan). Si el reloj llega a 0
  mientras alguien planta, la ronda sigue hasta que termine o lo interrumpan. Si el portador
  cae, el desactivador queda en el suelo y cualquier atacante lo recoge con **F**.
- **Victoria de ronda**: ataque si toda la defensa está eliminada o derribada, o si el
  desactivador completa sus 45 s; defensa si elimina al ataque antes de plantar, si se
  acaba el tiempo sin plantar o si inutiliza el desactivador. Tras plantar, eliminar al
  ataque no basta.
- **Partida**: el primero en 4 rondas; cambio de bando cada 3; con 3-3, la ronda decisiva sortea
  los bandos.
- **Puntos**: baja 100, asistencia 50, derribo 50, reanimar 50, plantar 100, inutilizar 100,
  marcar 10, refuerzo 10, gadget enemigo destruido 20.
- **Al morir**: tras 3 s de cámara de muerte observas a tus compañeros (clic o Espacio para
  cambiar) y con **5** la defensa usa las cámaras (A/D, marcar) y el ataque pilota los drones
  que queden del equipo (Q/E para cambiar de dron; si lo destruyen, pasa al siguiente). Las
  marcas cuentan para quien pilota.
- **Edificio**: en la preparación la defensa no puede salir (pared invisible en puertas y
  ventanas; los bots ni lo intentan). En la acción, un defensor que pasa más de 5 s fuera queda
  revelado para el ataque (marcador rojo y memoria de sus bots) mientras siga fuera; a él le
  sale la cuenta atrás.
- **Ventanas**: todas empiezan la ronda con barricada. Se rompe a golpes y, rota, se salta a
  través (las astillas que quedan se arrastran); entera, no.
- HUD: reloj arriba al centro con los 10 retratos (tachados al morir, parpadean derribados),
  marcador (Tab), cartel de fin de ronda, pantalla final con el mejor jugador.
- Bots con IA completa (Fase 5, abajo).

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

## Bots (Fase 5)

- **Navegación**: rejilla 2,5D de celdas de 0,5 m con varias superficies por columna (sótano,
  plantas, tejados), escaleras, escaleras de mano y caídas. Las barricadas son aristas que se
  rompen a golpes (la defensa solo rompe las suyas si no hay otro camino) y cada boquete abre
  una ruta nueva: la destrucción recalcula la rejilla por columnas en tiempo real. Las rutas se
  buscan con A* repartido entre ticks (sin tirones) y se suavizan sobre la marcha. Si un bot se
  atasca, salta, se aparta, rompe a golpes lo blando que tenga delante (restos de marcos,
  madera, pladur) y, como último recurso, retrocede y cambia de objetivo.
- **Percepción**: cono de visión de 100°, línea de visión real (agujeros y cristal dejan ver),
  oído (pasos según postura y velocidad, disparos, golpes, saltos, refuerzos, reanimaciones,
  drones a 6 m, el desactivador) atenuado a través de paredes y suelos, y memoria de 10 s.
  Lo que ve un compañero llega a los demás con un retraso de radio; las marcas de dron entran
  en la memoria del ataque y las cámaras vigiladas, en la de la defensa.
- **Dificultad** (tabla del documento):

  | Nivel | Reacción | Error inicial | Además |
  | --- | --- | --- | --- |
  | Novato | 700 ms | 1,8° | no dispara a través de paredes ni flanquea |
  | Normal | 450 ms | 1,0° | cambia de ángulo a veces tras ser visto |
  | Veterano | 300 ms | 0,6° | pre-disparo en esquinas conocidas, dispara a paredes blandas si oye pasos |
  | Élite | 220 ms | 0,35° | flanquea más y siempre cambia de ángulo tras ser visto |

  El error se corrige mientras sigue al blanco (muelle amortiguado con sobrecorrección y
  microajustes) y el retroceso también les afecta.
- **Defensa**: en la preparación reparte los 10 refuerzos y las barricadas del sitio y dispara a
  los drones que ve; después, 3 anclas sostienen ángulos en diagonal sobre las puertas del sitio
  (agachados si hace falta) y 2 merodeadores vigilan salas vecinas, cambian de sala y vuelven
  al sitio si el ataque llega o quedan 60 s. Investigan ruidos cercanos, cambian de posición si
  un dron o una cámara los marca y, tras el plantado, van al desactivador: el más cercano lo
  inutiliza y el resto cubre.
- **Ataque**: en la preparación cada dron va a un punto de plantado distinto, marca defensores,
  se aparta si alguien lo mira de cerca y, sin objetivo a la vista, pasa a otra ubicación.
  En la acción, dos grupos por puertas distintas se agrupan al lado de su puerta (fuera de la
  línea de tiro), esperan unos segundos, entran avanzando a saltos y ocupan la sala del sitio;
  el portador planta cuando un compañero ya está dentro (o si aprieta el tiempo) y después
  vigilan el desactivador. Si el portador cae, el más cercano recoge el desactivador; si la
  defensa empieza a inutilizarlo, todos acuden.
- **Equipo**: reaniman al compañero derribado cuando no hay enemigos a la vista (uno por
  derribado) y rematan a los derribados enemigos cuando no queda nadie en pie a la vista.
- **Marcar (T o botón central)**: si miras a un enemigo (hasta 40 m), queda marcado 6 s para
  tu equipo, entra en la memoria de los bots aliados y suma 10 puntos. Si no, pones una marca de
  posición amarilla donde miras (hasta 60 m, 15 s, una por jugador). En el dron y en las
  cámaras, T marca igual que el clic.
- **Chat de equipo**: los bots aliados avisan por radio (abajo a la izquierda): «¡Contacto en
  PB Cocina!» (sala con su planta: Sót., PB, PA, o la zona exterior) cuando ven a un enemigo que
  el equipo no veía desde hacía 6 s, «Recargando» (si hay enemigos cerca), «Estoy derribado»,
  «¡Desactivador plantado!» y «Queda uno». Cada bot habla como mucho cada 2 s y el mismo aviso
  no se repite antes de 4 s. En Opciones, **Voz de los aliados** (apagada por defecto) los lee
  con la voz del navegador en español, con un tono distinto por aliado.
- **Órdenes (mantén H)**: se abre una rueda; el ratón elige (la vista no se mueve) y al soltar H
  (o con clic) los aliados bot la cumplen: **Seguirme** (detrás de ti a 2–4,4 m, sin pararse a
  recalcular la ruta mientras andas, y al llegar cada uno cubre un ángulo: frente, lados,
  espalda), **Mantener aquí** (se quedan donde están, vigilando hacia donde miraban), **Ir a mi
  marca** (a tu marca de posición, o a donde miras si no tienes; cada uno a su hueco alrededor
  y vigilando en la dirección en que la señalaste), **Reforzar aquí** (defensa, en preparación
  o acción: los aliados con refuerzos refuerzan las paredes y trampillas de la sala señalada
  más cercanas a la marca, hasta 2 cada uno, y luego vuelven por libre) y **Por libre**. Un
  aliado responde por radio y la orden activa se ve abajo a la izquierda. Combatir, reanimar,
  recoger el desactivador, plantarlo (con el sitio a la vista o menos de 50 s) y retomar el
  plantado mandan sobre la orden; si caes, vuelven por libre; cada ronda empieza sin órdenes.
  *Poner gadget aquí* llegará con los gadgets de la Fase 6.
- **Depuración (P)**: puntos de la rejilla de navegación a menos de 14 m (verde de pie,
  amarillo solo agachado, magenta barricada por romper, azul pie de escalera), la ruta que
  sigue cada bot, su cono de visión de 100° (rojo si tiene a alguien a tiro) y una etiqueta
  con su tarea, etapa, movimiento y objetivo. Enciende también la línea de FPS. Solo lee la
  simulación: la partida es la misma con la capa encendida o apagada.

## Controles

| Tecla | Acción |
| --- | --- |
| WASD / Mayús | Moverse / correr |
| C / Z | Agacharse / cuerpo a tierra |
| Q / E | Asomarse a izquierda / derecha (alterna, configurable) |
| Espacio | Saltar obstáculo (alféizares, mesas, muros bajos) |
| Clic / clic derecho | Disparar / apuntar |
| R | Recargar |
| B | Modo de disparo (automático, ráfaga, tiro a tiro) |
| G | Gadget secundario (granadas, cargas…) |
| 1–4, rueda | Cambiar de arma |
| F | Reforzar, poner barricada, plantar / inutilizar el desactivador, reanimar (mantener) / presionar la herida si estás derribado |
| V | Golpe cuerpo a cuerpo (rompe barricadas y pladur) |
| 5 | Dron (ataque) / cámaras (defensa) |
| T / botón central | Marcar al enemigo que miras (6 s para tu equipo) o poner una marca de posición (15 s) |
| H (mantener) | Rueda de órdenes a los aliados: el ratón elige, al soltar se da la orden |
| Tab | Marcador |
| Clic / Espacio | (Muerto) cambiar de compañero observado |
| 5 | (Muerto) cámaras (defensa) o drones que queden (ataque; Q/E otro dron); 5 otra vez, a observar |
| G | (Campo de pruebas) carga de brecha en la pared que miras |
| J / K / L | (Campo de pruebas) derribar al compañero / reiniciar el campo / cambiar de arsenal |
| F3 | Medidor de rendimiento |
| P | Depuración: rejilla de navegación, rutas y conos de visión de los bots, su estado y los FPS |
| Esc | Pausa |

## Desarrollo

```bash
npm install
npm run build        # genera dist/bloque-cero.html y dist/artifact.html
npm test             # tests de simulación en Node (sin navegador)
node tools/smoke.mjs <carpeta>   # prueba de humo en Chromium headless con capturas
node tools/smoke3.mjs <carpeta>  # partida completa en el navegador (selección → final)
node tools/smoke-aliados.mjs <carpeta>  # depuración (P) y ayudas de equipo en el navegador
node tools/smoke4.mjs <carpeta>  # refuerzos, barricadas, golpes, drones y cámaras en el navegador
node tools/smoke5.mjs <carpeta>  # partida contra bots en el navegador (rejilla, preparación, ronda)
node tools/mapslice.mjs <carpeta> # cortes cenitales del mapa por planta
```

### Arquitectura

- `src/world/` mundo de vóxeles (chunks de 32³), materiales, trazado de rayos, destrucción, constructor de mapas y el mapa Villa.
- `src/sim/` simulación sin render (corre en Node): física de personaje, operadores, armas,
  plantilla de 16 operadores (`operators.js`), partida por rondas (`match.js`), fortificación
  (`fortify.js`), drones y cámaras (`recon.js`), rejilla de navegación (`nav.js`) y bots
  (`bots.js` con `ai/mover.js`, `ai/perception.js` y `ai/tactics.js`).
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
- Partida 5v5: la simulación de 10 operadores cuesta ~0,2 ms por tick y la IA de los bots ~0,12 ms
  de media (p99 ≈ 1,6 ms) con presupuestos por tick para la búsqueda de rutas (900 nodos) y el
  recálculo de la rejilla tras la destrucción (3 columnas). La rejilla (24 000 nodos, 172 000
  aristas) se construye una vez al arrancar (~0,9 s, «Calculando rutas…»).
