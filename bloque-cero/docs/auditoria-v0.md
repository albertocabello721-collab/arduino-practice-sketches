# Auditoría V0: qué separa a Bloque Cero (v37) de Rainbow Six Siege

Capturas en `docs/auditoria-v0/` (1600×900, escala 1,0, calidad alta con MSAA 4, Villa de día, HUD tal cual; hoja de contacto en `hoja.png`). Herramienta: `node tools/capturas-v0.mjs docs/auditoria-v0`.

Datos del render en estas escenas: 334 llamadas de dibujo, 155 000 triángulos, exposición 0,81 en la calle (dentro de la casa llega al tope de 1,9). En la captura del jugador (Hall, defensa): escala 0,75 sin suavizado, CPU 2,3 ms. Explicación: en calidad alta el juego pide hasta 1,5 píxeles por píxel de pantalla (en un MacBook Air con Retina, 2,25 veces los píxeles de la ventana); la GPU no llega a 55 fps, el ajuste automático baja la escala a 0,72 y en ese escalón apaga el MSAA. Por eso se ven bordes de sierra.

## Veredicto corto

Un veterano de Siege no lo confundiría con Siege en ninguna de las seis capturas. Lo que más lo delata, por orden: el arma (un prisma negro), la luz plana sin oclusión ni sombras dentro de la casa, los operadores de cajas, los muebles y marcos cúbicos, y el panel de ayuda tapando una esquina.

## Escena por escena

Columnas: qué hay hoy → qué tiene Siege.

### 1. Pasillo interior (pasillo de servicio, planta baja)
- Iluminación y sombras: luz ambiente uniforme del volumen difundido; las uniones pared-techo-suelo tienen el mismo tono (sin oclusión); la lámpara es un rectángulo emisivo con halo; nada proyecta sombra dentro; la neblina blanquea las puertas lejanas → luz direccional desde ventanas y lámparas con sombras suaves, rincones oscuros, contraste.
- Materiales: pladur beige liso (la textura no se percibe a escala 1,0), baldosa con junta fina; sin desgaste, suciedad ni variación de rugosidad; el suelo no refleja → rugosidad variada, manchas, rodapié, enchufes, cuadros, suelos con brillo.
- Geometría (sigue siendo bloque y no debería): marcos de puerta como huecos con bisel claro; sin hojas de puerta, rodapié, molduras ni cornisas; muebles al fondo cúbicos.
- Arma y manos: cuerpo del arma un prisma negro sin rieles, cargador ni gatillo visibles; la mira es una caja con marco; el guante es un cilindro azulado sin dedos.
- Operadores: ninguno a la vista (iconos de aliados sobre la cabeza, correcto).
- Efectos: motas blancas flotando pegadas a la cámara.
- HUD: panel de ayuda tapa la esquina; la banda superior (iconos, reloj, marcador) se acerca a Siege; «Llevas el desactivador», «H órdenes, drones, V golpe» y la ubicación en letras grandes ocupan la esquina inferior izquierda.

### 2. Cuarto con ventana (salón, ventanas barricadas por la defensa)
- Iluminación: techo blanco quemado por la exposición; lámpara como bloque emisivo; el sofá, la mesa y la chimenea no proyectan sombra; las barricadas no dejan pasar ninguna luz → en Siege las tablas dejan rendijas y la luz de fuera dibuja la habitación.
- Materiales: papel verde rayado correcto; moqueta roja plana sin pelo; madera de la mesa lisa; ladrillo de la chimenea aceptable.
- Geometría: sofá de dos cajas, mesa de una caja, chimenea de bloques, barricadas como cajas de tablas; sin cojines, patas, cuadros, cortinas, lámparas de pie.
- Arma y manos, efectos, HUD: igual que la escena 1.

### 3. Exterior (fachada principal desde la calle)
- Iluminación: hay sol y sombra proyectada del balcón (dura, bien); cielo celeste plano sin nubes; los huecos de las ventanas no se oscurecen bajo el dintel (sin oclusión); el estuco blanco se quema.
- Materiales: ladrillo y estuco razonables; césped como ruido verde plano; acera de baldosas limpias; sin suciedad ni desgaste; persianas beige en todas las ventanas (barricadas).
- Geometría: balcón y barandilla de cajas; escalera de rappel como rejilla; ventanas sin marco en relieve; sin canalones, alféizares ni tejado visible.
- Arma y manos: igual. Operadores y efectos: ninguno. HUD: igual.

### 4. Primera persona apuntando (Hall, mira de punto rojo)
- Arma y manos: el visor es un marco cuadrado grueso con cristal; debajo, el prisma negro del arma; retícula de círculo y punto correcta; no se ven manos.
- Iluminación: escalera marrón de bloques con luz plana; bloom en las lámparas; neblina en el fondo.
- Geometría: escalera de peldaños gruesos de vóxel; estantería de cajas.
- HUD: icono de aliado (PULGA) a través de la pared, como en Siege; sin contorno.

### 5. Un operador a 5 m (GUARDIÁN, en la calle)
- Modelo: cuerpo de cajas sin articulaciones redondeadas, casco esférico con gafas, camuflaje pixelado, blindaje de cajas; sin cara, cuello ni manos con dedos; el arma en sus manos es otro bloque; marcador de equipo sobre la cabeza → humanos reales con equipo propio, reconocibles por silueta.
- Iluminación: sombra solar bajo el operador (bien).
- Materiales: colores planos con algo de rugosidad; sin tela, correas ni metal distinguibles.

### 6. Pared recién destruida (carga de brecha en el salón)
- Efectos: hueco con borde dentado de vóxeles (lee como brecha), escombros de cubitos y humo blanco uniforme; sin capas de pared (pladur, listones, aislante), sin polvo persistente, sin chamuscado ni restos en el suelo.
- Iluminación: la sala de detrás quemada a blanco por la exposición.
- Materiales: el papel verde se corta sin borde de pladur roto.

## Las 10 mejoras de mayor impacto visible, por impacto contra coste

Costes estimados por cuadro en un MacBook Air (M1/M2, Chrome, 1440×900 a escala 1,0). La tubería actual a esa escala cuesta unos 7–9 ms de GPU; a 1,5× no cabe en 16,7 ms, y de ahí la escala 0,75. Se medirán de verdad en cada ronda.

| # | Mejora | Coste | Notas |
|---|---|---|---|
| 1 | V1: escala 1,0 fija con MSAA 4 siempre (el ajuste automático baja resolución, nunca el suavizado); exposición con tope 1,2 y curva de contraste; fuera las motas; aliados como Siege; ayuda que se oculta a los 8 s | 0 ms (ahorra unos 8 ms frente al 1,5× de hoy) | Lo que más cambia la sensación por el precio |
| 2 | Arma y manos nuevas: cuerpo con rieles, cargador, gatillo y culata; mira con tubo; manos con dedos | +0,2 ms | Está en pantalla el 100 % del tiempo |
| 3 | Luz interior con sombras horneadas (visibilidad trazada en el volumen de luz en vez de difusión) y oclusión ambiente en pantalla a media resolución | +2,0 ms | Quita el aspecto plano de todas las habitaciones |
| 4 | Marcos, puertas, rodapiés, ventanas con cristal y muebles como mallas; las paredes lisas hasta romperse | +0,8 ms | La destrucción sigue en vóxeles |
| 5 | Texturas procedurales a 512² con suciedad, desgaste y rugosidad variada | +0,3 ms (+24 MB) | Hoy 256² y limpias |
| 6 | Operadores: cuerpo con cuello, hombros y botas, casco y equipo distinto por operador, manos | +0,3 ms | Reconocibles a 15 m |
| 7 | Efectos: fogonazo con sprite, agujeros de bala como calcomanías, polvo de destrucción que dura, chamuscado | +0,4 ms | Hoy cubitos y humo uniforme |
| 8 | Haces de luz por las ventanas (volumétrico barato en pantalla) | +1,5 ms | Solo de día y con ventanas abiertas |
| 9 | HUD al estilo Siege: menos texto, iconos, una tipografía | 0 ms | |
| 10 | Gradación: curva de contraste, bloom contenido (umbral alto, radio corto), viñeta suave | +0,1 ms | |

Suma: unos +5,6 ms → 13–15 ms por cuadro a 1440×900. Cabe en 60 fps con poco margen; a 1,5× de escala no cabe y no se ofrecerá por defecto.

## Qué no se puede en un artifact y cuál es el techo realista

- Un solo archivo HTML de 16 MB como mucho: nada de texturas fotográficas ni modelos esculpidos; todo procedural o diminuto. Cargar texturas o modelos libres desde un CDN permitido en tiempo de ejecución no cuenta para el límite, pero el juego dejaría de funcionar sin red y dependería de que esos paquetes sigan existiendo.
- WebGL2 sin cómputo ni trazado de rayos: sin iluminación global dinámica ni reflejos reales. Sombras por mapas, oclusión en pantalla, luz indirecta horneada.
- Sin captura de movimiento ni rigs profesionales: las animaciones son procedurales. Un veterano lo nota al ver correr y recargar.
- Sin audio grabado: todo sintetizado.
- Techo realista: un shooter de PC de 2012–2014 en calidad media (la época de Insurgency o el primer CS:GO) con estética limpia de pocos polígonos y materiales procedurales; personajes como maniquíes tácticos estilizados, no escaneados. En una captura, un veterano dirá «un shooter táctico inspirado en Siege», nunca «Siege». Lo que sí puede engañar en movimiento es la lectura de la partida: HUD, ritmo, pasos, destrucción, voces.

## Los 16 operadores

| Operador | Gadget propio | Qué cambia en cómo se juega la ronda | Se parece demasiado a | Veredicto |
|---|---|---|---|---|
| TERMO (atk) | Carga térmica ×2: abre 1,9×1,1 m en muro reforzado a los 5 s | La defensa tiene que proteger sus refuerzos (VOLTIO, SILENCIO); abre líneas nuevas al objetivo | ROMPE (abre paredes blandas a distancia) | Distintos: duro frente a blando |
| ROMPE (atk) | Proyectil de brecha ×2: 1,5 m de pared blanda o barricada a 40 m | Abre sin exponerse; presión rápida | TERMO | Mantener |
| MURALLA (atk) | Escudo balístico con 4 destellos | Entra el primero y ciega; los duelos pasan a flanqueo y pies | nadie | Mantener |
| RADAR (atk) | Pulso de escaneo ×3: marca 4 s a quien se mueve | Congela a la defensa; castiga la rotación | OJO solo en el papel (información) | Mantener |
| PULGA (atk) | Dron de choque: 6 cargas que destruyen gadgets | Limpia trampas y baterías desde el dron antes de entrar | CHISPA | Solapan: hoy jugador y bots los usan igual, «quitar gadgets» |
| CHISPA (atk) | Granada PEM ×3: 5 m a través de paredes, 15 s | Abre la puerta a TERMO contra VOLTIO y SILENCIO | PULGA | Diferenciar: que la PEM también apague cámaras y marque lo apagado, o rehacer |
| NUBE (atk) | Humo remoto ×3: 40 m, 10 s, 4 m | Ciega ángulos para plantar | La granada de humo secundaria (×2) de cualquier atacante | **Rehacer**: duplica un gadget secundario con más alcance |
| LUMEN (atk) | Visor térmico 3x a 30 m, quieto y apuntando | Tirador por ventanas y humo; juega lejos | nadie | Mantener |
| VOLTIO (def) | Batería ×4: electrifica refuerzos, barricadas y alambre | Niega brechas duras y drones | SILENCIO | Solapan: ambos paran a TERMO y PULGA |
| SILENCIO (def) | Inhibidor ×4: 2,5 m sin señal de drones ni cargas remotas | Protege refuerzos y ciega drones en preparación | VOLTIO | Diferenciar: SILENCIO bloquea y además anula el pulso de RADAR; VOLTIO destruye |
| CEPO (def) | Mina láser ×5 en puertas y ventanas, 60 de daño | Castiga entrar sin dronear; avisa al equipo | nadie | Mantener |
| OJO (def) | Cámara adhesiva ×3 | Información fuera del objetivo; juega desde lejos | nadie | Mantener |
| CORAZA (def) | Placas ×5: +20 de vida y derribo en vez de muerte | Aguante; se eligen las peleas | REMEDIO (aguante) | Distintos: pasivo frente a activo |
| GUARDIÁN (def) | Interceptor ×2: destruye proyectiles a 6 m | Anula granadas, humos de NUBE y proyectiles de ROMPE; permite anclar | nadie | Mantener |
| REMEDIO (def) | Estimulante ×3: +40 y levanta a distancia | Prolonga rondas; anclaje | CORAZA | Mantener |
| TIZÓN (def) | Bote de gas ×3: 4 m, 10 s, 12 por segundo | Niega el plante; alarga el final de ronda | nadie | Mantener |

Marcados para rehacer: NUBE. Para diferenciar en la V5: PULGA–CHISPA y VOLTIO–SILENCIO. Pendiente de revisar en la V5 qué gadgets no tienen efecto visible ni sonido propio (al menos el pulso de RADAR, la PEM de CHISPA y las placas de CORAZA).
