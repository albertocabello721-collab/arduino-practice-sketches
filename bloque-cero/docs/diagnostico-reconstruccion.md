# Diagnóstico para reconstruir Bloque Cero (octubre de 2026, sin código)

Pedido: diagnóstico sin adornos antes de decidir cómo reconstruir. Este documento es la copia del informe entregado en el chat.

## 0. Qué veo en tus cinco videos y qué puedo igualar

| Video | Qué se ve | Qué puedo igualar (sin logos, nombres ni mapas) |
|---|---|---|
| 1 (1:07) Operadores y personalización | Menú superior PLAY / OPERATORS / BATTLE PASS / LOCKER / CAREER / ESPORTS / SHOP. Rejilla de operadores con pestañas ataque/defensa y filtros por rol (intel, anti-gadget, support, front line, map control, breach). Ficha de operador con columna izquierda (Loadout, Appearance, Bundles, Badges, Info, Guides, Bio), modelo 3D grande con skin, descripción del gadget, barras de dificultad/velocidad/vida, botones «Showcase» y «Shooting Range». Pantalla de arsenal con arma principal, secundaria, habilidad y gadget, y panel de cifras (daño, cadencia, destrucción, cargador, capacidad, recarga, tiempo de apuntado, patrón de retroceso, movilidad). Páginas de miras (magnificadas A/B/C, red dot, holo, reflex, iron) con vista 3D y «view fullscreen», cañones (flash hider, compensador, supresor, muzzle brake, nada), bajo cañón (láser), empuñaduras (vertical, angular, horizontal), skins de accesorios, amuletos. Fondo azul claro animado con haces, selección en rojo. | La estructura entera: rejilla, filtros, ficha con modelo 3D, arsenal con el mismo panel de cifras y las mismas categorías de accesorios con previsualización 3D, skins y amuletos propios. No: las skins reales, Chun-Li, nombres. |
| 2 (0:11) Playlists | PLAY → pestañas Essentials / Training / Custom Game. Essentials: Quick Match, Unranked, Ranked (con tu rango Gold IV en la tarjeta), Siege Cup. Training: Tutorials, Landmark Drill, Shooting Range, Deathmatch, Clear House, Field Training. Custom: Create Online / Create Local. Ajustes de Clear House: Map selection / Settings: Role (random), Pre-destruction (on), AI type, AI difficulty (Advanced), Headshot only (off), botón Play. | Las mismas pestañas y tarjetas grandes con imagen, la tarjeta de Ranked con el rango, y la pantalla de ajustes de Clear House con esas cuatro opciones. |
| 3 (1:01) Clear House en Oregon con Kaid | Selección (Locations / Operators / Loadout / Ready) con temporizador largo, fichas Sentry y Lesion, Kaid con TCSG12 (daño 75 leído borroso), LFP586 (78), Rtila Electroclaw, Nitro Cell y alambre. Carga con la tarjeta del operador y el objetivo (2F Kids' Dorm). HUD: minimapa arriba a la izquierda, reloj 59:58 arriba al centro, «Eliminate targets in BASEMENT», vida 125/125 abajo a la izquierda, munición 11 ∞ y gadgets abajo a la derecha, avisos arriba a la derecha. Refuerzo: icono «REINFORCE» en la pared, manos azules tirando del panel metálico hacia abajo. Garra: círculo de radio al colocar, paredes reforzadas con arcos naranjas, «PICK UP». Golpe cuerpo a cuerpo en pared de madera: hoyo chico irregular por el que se ve la otra habitación. | Todo el flujo de selección y carga, el HUD con esa misma disposición, el refuerzo con animación de 4,5 s, la garra con su círculo y el efecto eléctrico, el hoyo de golpe y su sonido. 125/125 confirma la tabla de vida (3 de vida = 125). |
| 4 (0:21) Fin de partida (stream ajeno) | Marcador, «YOUR TEAM WINS / HARD FOUGHT VICTORY», pantalla de MVP con el operador posando y la puntuación, Post-Action Report con tabla, vuelta al menú con la barra de XP. | La secuencia completa: marcador → victoria → MVP con pose → informe → barra de XP. |
| 5 (0:48) Apertura de paquetes (YouTube) | Paquete girando, revelación por rareza con colores, Black Ice, oro, arma 3D girando, «otro paquete». | La ceremonia de apertura con rarezas y skins propias; el ritmo y los colores. |

## 1. Plataforma

| | (a) Artifact + archivos | (b) Proyecto web propio (three.js, GitHub Pages) | (c) Godot 4.5 (nativo, Metal) |
|---|---|---|---|
| Techo visual | WebGL2, sin GI en tiempo real; lightmaps horneados fuera; WebGPU dentro del iframe: por confirmar. Techo real: «Siege en calidad baja». | Igual tecnología que (a) pero con .glb, KTX2, Draco, WebGPU y workers. Con lightmaps horneados (Blender sin ventana, que sí puedo instalar aquí), SSAO, TAA y bloom: «Siege en calidad media». | Forward+ con GI horneada (LightmapGI) o en tiempo real (SDFGI), SSAO/SSIL/SSR, niebla volumétrica, TAA, luces físicas. El techo más alto de los tres: «Siege en calidad media-alta» si los recursos CC0 acompañan. |
| Animación | Skinning de three.js + retarget manual. Funciona. | Igual. | AnimationTree, retarget por mapa de huesos, root motion, IK. Mejor. |
| Pantalla dividida | Dos viewports en un canvas: sí. Mando dentro del iframe: por confirmar. | Sí, sin restricciones del iframe. | SubViewports nativos y mandos por índice de dispositivo. Lo mejor. |
| Sonido con propagación | Web Audio + mi grafo de propagación (ya existe). | Igual. | Buses, reverb por zona y mi grafo; AudioStreamPlayer3D. Igual de bien. |
| 60 fps en MacBook Air | Posible a 1440×900 con escena ligera. | Igual, algo mejor (sin iframe, WebGPU). | Metal nativo desde 4.4; es el que más margen da. |
| Cómo lo pruebo yo sin pantalla | Como ahora: Chromium sin cabeza con SwiftShader (3–10 fps). Rápido. | Igual. | Lógica: Godot sin cabeza (pruebas unitarias). Imagen: Xvfb + Vulkan por software (lavapipe). Hoy instalé Mesa en el contenedor y lavapipe responde (llvmpipe, Vulkan 1.4), pero cada captura tardará decenas de segundos y necesito el binario de Godot: su descarga está bloqueada (github.com 403, godotengine.org y tuxfamily sin respuesta). Tendrías que abrir en Network access `github.com` y `objects.githubusercontent.com` (o compilarlo aquí desde el código, 1–2 h la primera vez). |
| Qué haces tú | Abrir el enlace. | Abrir una URL de GitHub Pages (se actualiza sola 1–2 min después de cada push). | Instalar Godot (gratis, ~200 MB, godotengine.org), clonar el repositorio, abrirlo y pulsar Play. Actualizar = `git pull` y Play. Más adelante un .app exportado. |
| Límites | Página ≤ 16 MB, sin .glb ni .bin (geometría en JSON base64, +33 %), sin SharedArrayBuffer, iframe (captura de ratón y pantalla completa frágiles). | Sin esos límites. Sin GI en tiempo real; la iluminación buena hay que hornearla. | Instalación, mi bucle visual 10× más lento, y pierdo el artifact como forma de entrega. |

Recomendación: (c) Godot 4, porque es la única que cubre a la vez el techo visual, la pantalla dividida con mandos y los 60 fps nativos; (b) como segunda si no quieres instalar nada. Se pierde: el enlace único, parte de mi velocidad de verificación visual (compenso con pruebas de lógica sin cabeza y con tus capturas), y la mayor parte del código actual (se porta la lógica, no el código). Descartaría (a): sus límites de archivos y de iframe son justo lo que más pesa en un juego de recursos reales.

## 2. Lo que existe hoy, módulo por módulo (con Godot; entre paréntesis, con web)

| Módulo (líneas) | Depende de vóxeles | Destino |
|---|---|---|
| world: voxelworld, mesher, raycast, destruction, materials, mapbuilder, villa, lightvolume (1106) | Todo | Se tira. Se conserva la tabla de materiales (penetración, sonido por material) como datos. |
| render: worldrenderer, shaders, texgen (atlas procedural), effects (escombros de vóxel), props y character (luz del volumen), debugview (6844 en total) | Casi todo | Se tira. |
| render: viewmodel, reloadanim, handanim, kits, ragdoll, ropes, lasers, postfx, timeofday | No, pero son procedurales | Se tiran los modelos procedurales; se conservan los tiempos de recarga por partes y las reglas de accesorios como datos. |
| sim: game, operator, weapons, match, operators, abilities, gadgets, fortify, recon, rappel, dummies, poselayers, skeleton, physics, nav, light (8185) | physics, nav, skeleton (impactos contra el mundo), fortify (refuerzo = cambiar vóxeles), abilities y gadgets (colocación sobre caras de vóxel), light | Se adapta: reglas, temporizadores, estados del operador, armas, puntuación y contrajuego se portan a GDScript detrás de una interfaz de consultas (raycast, navegación, colocación). Física y navegación pasan a las de Godot. poselayers se tira (animación real). |
| sim/ai (2916) | Percepción y rutas consultan vóxeles | Se adapta la lógica de decisión; percepción y rutas se reescriben sobre Godot. |
| audio: audio (síntesis), ambience, music, propagation (1474) | No | Síntesis se tira (sonidos grabados CC0). propagation se adapta (es el grafo que piden los pilares). music: se decide (CC0 o generador). |
| client: session, matchsession, range, control, feel, fx, feeds, roundflow, replay, chat, voice, announcer, soundtrack (2649) | fx y feeds tocan el render | Se adapta la lógica (flujo de ronda, repetición por datos, control). voice y announcer (voz del navegador) se tiran. |
| ui: hud, matchui, floorplan, emblems, wheel (946) | floorplan corta vóxeles | Se reescribe en Control de Godot. El generador de plano se adapta a mallas. |
| input (445) | No | Se reescribe con InputMap; se conservan las tablas de mapeo del mando. |
| tools y test (269 pruebas) | Las herramientas de captura usan Chromium | Metodología se conserva; las pruebas de reglas se portan a gdUnit4/GUT; las capturas pasan a Xvfb + lavapipe. |

Con (b) web: se conserva más (sim, client, audio y ui casi enteros; se tiran world y render).

## 3. Destrucción sin vóxeles a 60 fps

A. Máscara 2D por superficie blanda (recomendada). Cada pared, suelo blando o trampilla es una caja fina con una máscara (1 texel = 2 cm; una pared de 3×3 m son 150×150 texeles, 22 KB). Bala: disco de 1–2 cm pintado (recorte en el sombreador: se ve a través). Golpe: elipse de ~8×14 cm con borde agrietado + sonido fuerte. Explosivos: círculo grande con borde irregular. Aruni: hoyo de ~70 cm de un golpe. El borde se dibuja con una tira extruida regenerada del contorno (marching squares, <1 ms). Balas: raycast contra la caja y lectura de la máscara en el punto; si es hoyo, el rayo sigue. Jugadores y drones: el colisionador se recompone en celdas de 25 cm (≤144 por pared, fusionadas por filas). Sonido: cada superficie aporta al grafo su área abierta y su mayor hoyo. Límites: los hoyos viven en el plano de la pared (sin grosor real), el borde es aproximado, escombros solo como partículas. Coste: trivial; 200 paredes ≈ 5 MB de máscaras.

B. Paneles prefracturados. Cada pared en trozos de ~20 cm con caras interiores; explosiones y golpes grandes sueltan trozos con física; las balas siguen necesitando la máscara de A. Límites: granularidad de 20 cm, picos de física si caen muchos trozos (hay que limitar cuerpos activos), muchos objetos por mapa. Lo correcto es un híbrido: A para el estado y los rayos, y 10–30 trozos físicos reutilizados solo cuando se abre un boquete grande.

## 4. Dos jugadores

- Coste de pantalla dividida: mismos píxeles totales, pero geometría y llamadas ×2, sombras ×1, posprocesado ×2 a media resolución: ≈1,5–1,8× el coste de un fotograma. Para 60 fps: división arriba/abajo (conserva el campo horizontal como Siege), cada mitad a ≤1280×400 y sombras a la mitad.
- Apuntar sin ratón: curva de aceleración, zona muerta y ralentización del giro cerca de un enemigo (40–60 %), opcional y apagada en «uno contra otro». Siege en consola no tiene ayuda de puntería: por confirmar.
- Hecho duro: en macOS dos ratones mueven el mismo cursor; ni el navegador ni Godot los distinguen. No hay «dos con teclado y ratón» en un Mac. Las combinaciones reales son: J1 teclado+ratón y J2 mando, o dos mandos.
- Teclado compartido: el límite de teclas simultáneas del teclado del MacBook no está documentado; se mide en keyboardtest.io pulsando W+A+Mayús+I+J+Mayús derecha a la vez (el reparto de abajo lo necesita). Reparto para dos en un teclado (solo movimiento y acciones; la mira de J2 es tosca con teclas): J1 WASD, Q/E inclinar, Mayús correr (conmutado al doble toque), C agachar, Ctrl tumbar, R, F, G, X, 1/2, Espacio saltar barrera, ratón para mirar y disparar. J2 IJKL mover, U/O inclinar, flechas mirar, Mayús derecha disparar, Intro apuntar, ñ/; agachar, P recargar, Retroceso interactuar, N/M arma. Cada jugador mantiene como mucho 3 teclas a la vez; correr y agachar conmutan para no sumar teclas.

## 5. Tabla de exactitud

Fuentes: las que pude leer desde aquí (resúmenes de búsqueda; fandom, Liquipedia y ubisoft.com están bloqueadas por el proxy: ábrelas en Network access y las verifico página por página). Lo que no cuadra entre fuentes va como «por confirmar».

| Dato | Valor | Estado y fuente |
|---|---|---|
| Vida por valoración de vida 1/2/3 | 100 / 110 / 125 | Confirmado (Crystal Guard, Y6S3; tu video muestra 125/125 con Kaid). |
| Preparación (Ranked, Unranked) | 45 s | Fuente secundaria; por confirmar. |
| Acción (Ranked, Unranked) | 3:00 | Fuente secundaria; por confirmar. |
| Quick Match 2.0 | preparación 15 s menos (30 s), acción 2:45, paredes y rotaciones prehechas, objetivo revelado, 10 s de invulnerabilidad al empezar la acción, 4 rondas y 1 ronda extra si 2-2 | Fuentes secundarias (Heavy Mettle, Y8S3); formato en Siege X por confirmar. |
| Ranked y Unranked | primero a 4; empate 3-3 → prórroga al mejor de 3; cambio de lado tras la ronda 3; en la prórroga se empieza en el lado contrario; máximo 9 rondas | Fuente secundaria (fandom). |
| Bans | Desde Siege X, un ban por ronda y por equipo (ataque veta un defensor, defensa veta un atacante, simultáneo) en Ranked, Unranked y personalizadas; no en Quick Match | Fuente secundaria (wecoach, siege.gg). |
| Plantar | 7 s | Fuente secundaria. |
| Desactivar | 7 s en Ranked y Unranked; 5 s en casual | Fuente secundaria; en Siege X por confirmar. |
| Cuenta atrás tras plantar | 45 s | Por confirmar: una fuente dice 30. |
| Reforzar una pared | 4,5 s de animación; 10 refuerzos por equipo | Animación: fuente secundaria. Los 10 por equipo: por confirmar. |
| Derribado: tiempo de desangrado y reanimación | ? | Por confirmar. |
| Velocidades 1/2/3 en m/s | ? | Por confirmar (habría que medir). |
| Niveles | Shooting Range 3, Deathmatch 7, Clear House 10, Unranked 15, Ranked 50 | 15 y 50 tuyos; 3/7/10 fuente secundaria. |
| Clear House | contra IA, nivel 10, sustituyó a Terrorist Hunt en Y8S4; ajustes: lado, predestrucción, tipo y dificultad de IA, solo disparos a la cabeza; reloj de 60:00 y objetivo «elimina N en <sala>» | Ajustes y reloj: tus videos. Número de objetivos y oleadas: por confirmar. |
| Shooting Range | blancos y todas las armas; nivel 3 | Por confirmar detalles. |
| Deathmatch (Team Deathmatch) | 5 contra 5, 7:30, gana el primero en 90 bajas o el que más tenga al acabar; reaparición; sin habilidades ni gadgets (salvo la mira de Glaz), sin Nitro ni Claymore; sin Blitz, Montagne ni Clash | Fuente secundaria (fandom). |
| Puntos | baja 100, derribo rematado por otro 100 para quien derribó, dron 10, refuerzo 10 | Tuyos. El resto (cabeza, asistencia, cámara, gadget, barricada, marcar, reanimar, plantar, desactivar, ronda) por confirmar. |

Operadores (nombres de Siege solo como referencia; en el juego tendrán nombre y aspecto propios):

| Referencia | Preparación | Acción | Cargas | Lo contrarresta | Estado |
|---|---|---|---|---|---|
| Thermite (2 vel / 2 vida) | Drones normales | Carga exotérmica en pared o trampilla reforzada | 2 | Bandit, Kaid (electricidad), Mute (jammer) | Cargas confirmadas por varias fuentes; armas por confirmar. |
| Ace (2/2) | Drones normales | SELMA lanzable, abre tres huecos sucesivos hacia abajo | 3 | Los mismos que Thermite | Cargas confirmadas; detalle de los tres huecos por confirmar. |
| Twitch (2/2) | Un dron normal | Dron de descargas que salta y dispara láser que destruye gadgets | 2 drones de descargas | Mute, Mozzie, Aruni, disparos | Confirmado (Y7S4.2). |
| Brava (3/1) | ¿Dron normal o Kludge? | Dron Kludge: hackea gadgets de defensa y los pasa al ataque; lo que no puede controlar lo destruye; la puerta de Aruni se sobrecarga | 2 drones, 3 láseres cada uno (una fuente) | Mute, Mozzie, Aruni, Solis | Por confirmar (2 o 3 drones; uso en preparación). |
| Kaid (1/3) | Coloca garras, refuerza | Garra Rtila: electrifica paredes y trampillas reforzadas, alambre, escudos desplegables y barricadas de Castle (Y10) | 2 | Thatcher, Twitch, Brava, IQ la ve, se puede disparar | Confirmado (reducido de 3 a 2 antes del lanzamiento). |
| Valkyrie (2/2) | Lanza cámaras | Cámaras Black Eye pegadas, 360°, las ve todo el equipo | 3 | IQ, Twitch, Thatcher, disparos | Confirmado el número. |
| Mozzie (2/2) | Pests; capturan drones ya en preparación | Pests hackean drones y los dan a la defensa | 3 | Thatcher, Twitch, IQ, disparar el pest | Confirmado el número. |
| Aruni (2/2) | Coloca puertas | Puerta Surya: láser que destruye drones y proyectiles y quita 40 de vida al pasar; su brazo abre hoyos grandes de un golpe en superficies blandas | 3 | Twitch, Brava, PEM, explosivos | Número y daño: fuente secundaria. |

## 6. Qué haría distinto y tres errores del diseño original

1. Mundo de vóxeles (mío, aceptado por ti): se eligió por la destrucción y condenó la imagen, la animación y el sonido del principio al final. Hoy: mallas con máscara de destrucción desde el primer día.
2. Anchura antes que profundidad (tu prompt maestro pedía todo: 16 operadores, 2 mapas, 12 fases; yo lo acepté sin recortar): 38 versiones sin una sola cosa perfecta. «Poco pero perfecto» es lo correcto y tenía que haberlo dicho en la fase 1.
3. Exactitud por suposición (de los dos): rellené números de memoria y tu encargo era «como Siege» sin protocolo de verificación. Hoy: tabla verificada antes de programar, y cada valor dudoso marcado. Añado uno tuyo de instrucción: «sin archivos, todo procedural» por el artifact; obligó a inventar texturas, modelos y sonidos. Con recursos reales CC0 (Poly Haven, Quaternius: biblioteca de 120 animaciones humanoides con rifle y personajes base, CC0; MakeHuman exporta CC0) se puede cumplir la regla sin inventar nada.

Orden: mantengo (1) cuarto perfecto → (2) una ronda con 4 → (3) los otros 4 → (4) menú → (5) progreso, modos, bots → (6) entrenamientos y dos jugadores, con tres cambios: la pantalla dividida y la entrada multidispositivo se montan en (1) (dos viewports desde el primer día cuesta un día; meterlos al final cuesta semanas); un flujo mínimo de menú (jugar → elegir → ronda → resultado) entra en (2), y el menú de verdad sigue en (4); la recogida de datos de cómo juegas empieza en (2) para que los bots adaptativos de (5) tengan historial. Shooting Range sale gratis de (1).

## 7. Primera entrega: «un cuarto perfecto» en Godot

Habitación con materiales reales (yeso, parqué, madera, metal), luz horneada, una pared blanda destructible (balas, golpe chico con sonido, boquete), el fusil real con animación de primera persona, un enemigo con esqueleto y muerte física, y toda la respuesta al disparar y matar (retroceso, marcador de impacto, sonido por material, feed de baja, cámara lenta de la última baja). Rondas: 1 preparación (proyecto, pipeline de recursos, pruebas sin cabeza; tú instalas Godot y abres los dominios), 1 habitación y luz, 2 destrucción y sonido por hoyos, 2 fusil y manos, 1–2 enemigo, 1 pulido y 60 fps en tu Mac. Total: 8–9 rondas. En web serían 7–8.
