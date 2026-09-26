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
| F6 | Operadores 8 + 8 y contrajuego de gadgets | ✅ arsenal · plantilla de 16 · granadas y explosivos · gadgets defensivos · 16 habilidades · la defensa bot coloca gadgets y habilidades · el ataque bot los usa según la dificultad · contrajuego de la defensa bot y gadgets de acción |
| F7 | Animaciones en primera y tercera persona, con la recarga por partes (antes F8) | en curso: recarga por partes en primera persona ✅ · resto de la primera persona ✅ · siluetas de los 16 ✅ · tercera persona por capas · muerte con física |
| F9 | Audio 3D con oclusión | pendiente |
| F10 | Pulido, pruebas de partidas completas y publicación (con rappel en Villa: tejado y fachada) | pendiente |
| — | Mapa Residencia del Lago | pendiente |

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

### Animaciones en primera persona (Fase 7.2)

Encima de la base (balanceo al andar, inercia del ratón, apuntar, retroceso, correr) hay una capa
de acciones con poses clave como datos y mezclas de 0,15 s. Cada acción dura lo que ya duraba en
la simulación: la animación no cambia ningún tiempo ni ninguna regla.

- **Cambiar de arma**: en la primera parte del desenfunde la que se guarda baja con la boca hacia
  abajo, y después sube la nueva.
- **Respiración en reposo**: parado, el arma sube y baja despacio (casi nada al apuntar).
- **Inspeccionar (I)**: el arma gira para verla por un lado y por el otro (2,6 s); se corta al
  disparar, apuntar, correr, recargar o cambiar de arma.
- **Lanzar** una granada o un gadget: el lanzamiento sale al pulsar y el brazo izquierdo acompaña
  el tiro. **Sacar el dron**: lanzamiento bajo.
- **Con las dos manos** (el arma se aparta): colocar un gadget (lo llevan hacia donde miras),
  reforzar (empujan el panel), poner una barricada (suben una tabla a la puerta), plantar (el
  desactivador baja al suelo y la mano derecha lo programa), desactivar y reanimar (las manos en
  el compañero, presionando con ritmo).
- Los brazos se colocan en el espacio de la cámara y los codos cuelgan: pueden soltar el arma y
  no giran con ella al inclinarla.

### Recarga por partes (Fase 7.1)

Cada recarga es una serie de partes con su momento, y la munición cambia en su parte, no al
final. En primera persona se ve cada una (poses clave con curvas de suavizado y mezclas de
0,15 s), con las piezas del arma moviéndose y su sonido en su momento:

- **Fusiles, subfusiles, T-308 y pistolas**: el arma se inclina, la mano saca el cargador (el de
  la pistola cae solo) y lo suelta: cae al suelo y se queda 20 s (como mucho 24 a la vez). La
  mano trae el nuevo, lo mete y lo asienta con un golpe de la palma; en la recarga vacía tira
  además de la palanca de carga (en las pistolas, suelta la corredera, que se queda atrás al
  vaciar el cargador).
- **El cargador que sacas se pierde con sus balas** (como pide el documento); queda la de la
  recámara: con 12 balas, la táctica deja 30+1 y se pierden 11. Las balas nuevas cuentan
  cuando entra el cargador. Si interrumpes (cambiar de arma, cuerpo a cuerpo) antes de
  sacarlo, no cambia nada; entre medias, te quedas sin cargador (solo la de la recámara) y la
  siguiente recarga no saca otro; después de meterlo, ya cuenta.
- **E-12**: cartucho a cartucho por la ventana de carga (0,55 s cada uno, cuentan al entrar).
  Disparar interrumpe la recarga: vuelve a encarar la escopeta y dispara con los que ya
  metiste. Si estaba vacía, bombea al final; y bombea tras cada disparo.
- **R-44**: abre el tambor, boca arriba caen los casquillos (y las balas que quedaran), mete el
  cargador rápido y cierra. El tambor gira con cada disparo.
- **AL-60**: levanta la tapa, fuera la caja, caja nueva, coloca la cinta y cierra (5 s). Admite
  80, sin bala en recámara, como en la tabla.
- Los bots recargan con menos del 35 % del cargador (antes, al 55 %), para no tirar medio
  cargador en cada recarga. Con esto, en partidas solo de bots el ataque gana el 50,5 % de
  las rondas en Élite (47 de 93, 16 partidas) y el 47,6 % en Normal (89 de 187, 32 partidas).

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

### Siluetas (Fase 7.3)

Cada operador se reconoce por su complexión y por un objeto propio en la cabeza o la espalda
(`src/render/kits.js`, como datos). Todo va pegado a los huesos del esqueleto: sigue siendo una
malla y una llamada de dibujo por operador, con 2.400 triángulos como mucho (entre 1.816 y 2.334).

- **Complexión según el blindaje**: blindaje 1, chaleco fino, sin hombreras ni placas laterales;
  blindaje 2, como antes; blindaje 3, placas laterales, hombreras grandes y protector de cuello,
  de ingle y de muslos.

| Ataque | Cabeza | Objeto propio |
| --- | --- | --- |
| TERMO | casco con gafas de soldador | marco de la carga térmica a la espalda, que rodea la cabeza |
| ROMPE | gorra y gafas | tubo lanzador cruzado (asoma sobre el hombro izquierdo) |
| MURALLA | casco pesado con visera | el escudo |
| RADAR | casco | antena de plato sobre la cabeza |
| PULGA | casco | dron de choque amarillo a la espalda y tableta en el antebrazo |
| CHISPA | gorra y gafas | granadas PEM blancas en el pecho, el cinturón y la mochila |
| NUBE | capucha y máscara de gas de dos filtros | lanzagranadas corto (asoma sobre el hombro derecho) |
| LUMEN | sombrero de ala ancha | tiras de camuflaje en hombros y espalda |

| Defensa | Cabeza | Objeto propio |
| --- | --- | --- |
| VOLTIO | gorra | baterías amarillas en el cinturón y la espalda |
| SILENCIO | casco | mochila del inhibidor con tres antenas |
| CEPO | capucha y máscara | minas láser de lentes rojas en el pecho, los muslos y la espalda |
| OJO | gorra con una cámara sobre el ojo | cámaras adhesivas en el pecho |
| CORAZA | casco | bolsa de placas (asoman por encima de los hombros) |
| GUARDIÁN | casco y gafas | interceptor sobre el hombro izquierdo |
| REMEDIO | casco con cruz | mochila de médico con cruz blanca sobre verde (y cruces en el pecho y las hombreras) |
| TIZÓN | capucha y máscara de gas de un filtro | dos botes de gas a la espalda |

- Ningún objeto propio es azul ni naranja: el equipo se sigue leyendo por el brazalete, el parche
  del pecho y la baliza del casco.
- Las zonas de impacto no cambian. El cuerpo, el chaleco y el casco quedan a 4,5 cm de ellas
  como mucho (como antes); lo que se lleva a la espalda o por encima de los hombros no recibe
  impactos, igual que la mochila de antes.
- El arma principal colgada (cuando llevas la secundaria) va plana y en diagonal, pegada a lo que
  se lleve a la espalda (antes atravesaba la mochila), y la pistola enfundada va por fuera del
  muslo derecho (antes quedaba por dentro).
- En el **campo de pruebas**, en la calle, a la espalda del punto de salida, están los 16 en
  fila (primero los 8 de ataque, en azul, y después los 8 de defensa, en naranja). Son del equipo
  del jugador, así que sus balas los atraviesan, y al apuntar a uno el aviso dice quién es.
- De cerca todos se distinguen. A 25 m sin apuntar (unos 40 px de alto en 1280×720) se leen los
  objetos grandes: el marco de TERMO, el tubo de ROMPE, el escudo de MURALLA, el plato de RADAR,
  el dron de PULGA, las baterías de VOLTIO, las antenas de SILENCIO, las placas de CORAZA, el
  interceptor de GUARDIÁN y los botes de TIZÓN; de espaldas, también la cruz de REMEDIO. A los
  demás hay que acercarse a unos 12-15 m o apuntar.

La selección muestra el papel, los números de la habilidad y sus contras.

### Habilidades (tecla X)

La habilidad y sus cargas salen abajo a la derecha, junto al gadget. Ya funcionan:

- **TERMO · carga térmica** (×2): mirando un muro blando o reforzado a menos de 1,6 m (o una
  trampilla del suelo, de pie), **X** la coloca en 2 s (quieto) y **X** otra vez la enciende:
  arde 5 s con chispas y siseo y abre un hueco de 1,9 m de alto × 1,1 m de ancho a ras de
  suelo, **también en los refuerzos** (la placa de acero desaparece). En ladrillo o barricadas
  no se pone. Antes de encenderla se destruye de un disparo.
- **ROMPE · proyectil de brecha** (×2): vuela recto hasta 40 m, se pega a lo que toca y a los
  1,5 s (pitando cada vez más deprisa) abre 1,5 m de pared blanda o suelo, o quita entera la
  barricada o la trampilla. En un refuerzo revienta sin abrirlo; si da a alguien, cae a sus pies.
- **NUBE · humo remoto** (×3): vuela recto hasta 40 m y abre una nube de 4 m durante 10 s
  donde choca; tapa la vista a jugadores y bots.
- **CHISPA · granada PEM** (×3): se lanza como una granada; a los 2 s deja 15 s sin funcionar
  la electrónica de la defensa a menos de 5 m, **aunque haya paredes**: las cámaras (también
  las blindadas) no dan imagen ni marcan y las alarmas no suenan.
- **RADAR · pulso de escaneo** (×3): suena un aviso de 2 s para todos (arriba sale «¡Escaneo
  en 2 s! No te muevas» a la defensa y «Pulso de escaneo» al ataque); después, durante 4 s,
  todo defensor que se mueva queda marcado para el ataque (jugadores y bots) mientras se mueva.
  Contra: quedarse quieto. Un pulso cada vez.
- **LUMEN · visor térmico 3x** (sin límite, pasivo): con el arma principal, apuntando y quieto,
  la vista se enfría y los enemigos a menos de 30 m y a la vista se ven en colores de calor,
  **también dentro del humo**. El bot LUMEN, igual: con el visor ve a través del humo.
- **PULGA · dron de choque** (6 cargas; recupera 1 cada 12 s): su primer dron de la ronda
  lleva un emisor amarillo. Pilotándolo, **clic o X** dispara un rayo que destruye el primer
  gadget de la defensa a menos de 8 m en línea recta: alambre, cámaras (también las
  blindadas), alarmas y C4. No atraviesa paredes ni rompe el escudo desplegable; clic
  derecho o T marca. A pie, **X** lleva directamente a ese dron. Contra: dispararle.
- **MURALLA · escudo balístico** (4 destellos): solo lleva pistola y el escudo siempre delante;
  para las balas y los golpes de frente desde las espinillas hasta encima de la cabeza
  (agachado, casi entero). Correr, plantar, reanimar o tumbarse lo bajan y lo dejan expuesto.
  **X** carga 0,4 s y lanza un destello que ciega como una cegadora a los enemigos en un cono
  de 90° y 5 m. El golpe con escudo (V) quita 40. Los explosivos no lo rompen (a él sí le
  llega la onda). Contras: flanquearlo, disparar a los pies o a la cabeza que asoma; los bots
  que lo tienen de frente apuntan a los pies.
- Entre dos usos de la habilidad hay 1 s de espera.

Defensa:

- **VOLTIO · batería** (×4): **X** la pone en 1 s, a menos de 2 m, en un refuerzo (electrifica
  el panel entero, por las dos caras), una barricada o un alambre. Lo electrificado suelta
  chispas azules y quema las cargas de brecha, las cargas térmicas sin encender y los
  proyectiles de brecha que se le pegan (a TERMO se le pierde la carga), destruye los drones
  que lo tocan y quita 10 por segundo al atacante que lo toca o lo golpea. Si su soporte se
  rompe, la batería cae. Contras: la PEM de CHISPA (la apaga 15 s) y el dron de choque.
- **SILENCIO · inhibidor** (×4): **X** lo pone en 1 s en el suelo o una pared a menos de 2 m.
  A 2,5 m, los drones enemigos pierden la señal (no se mueven, ni marcan, ni disparan el rayo;
  su vista dice «Señal inhibida») y las cargas remotas no detonan (carga de brecha, encender
  la térmica). Contras: un disparo, un golpe, el dron de choque o la PEM.
- **CEPO · mina láser** (×5): mirando el marco (o el hueco) de una puerta o ventana a menos de
  2 m, **X** la pone en 1 s; el láser cruza el hueco a 0,35 m del suelo en las puertas y a media
  altura en las ventanas. El atacante que lo cruza recibe 60 (30 los que estén a 1,5 m) y la
  defensa recibe el aviso con el lugar y lo ve marcado 3 s. El láser solo se ve a menos de 2 m
  o desde un dron; los drones no la activan. Contras: drones para verla, un disparo, la PEM.
- **OJO · cámara adhesiva** (×3): **X** la lanza; se pega donde toca (en una pared mira hacia
  fuera; en el suelo, algo hacia arriba) y se suma a las cámaras de la defensa (**5**).
  Contras: un disparo, un golpe, el dron de choque; la PEM la deja sin señal.
- **GUARDIÁN · interceptor** (×2): **X** lo pone en 1 s en una superficie a menos de 2 m. Destruye
  en el aire las granadas de fragmentación, humo y cegadoras, las PEM y los proyectiles de ROMPE
  y NUBE que entran a 6 m con línea de vista: para 2 y recupera 1 cada 20 s. Contras: la PEM,
  saturarlo con más proyectiles de los que puede parar, un disparo.
- **CORAZA · placas de armadura** (bolsa de 5): **X** deja la bolsa a sus pies. Cada defensor
  que pasa a menos de 1 m coge una (una por cabeza): +20 de vida (hasta 20 por encima de su
  máximo; la barra se pone verde y el HUD dice «placa») y la próxima vez que moriría sin un
  tiro a la cabeza, queda derribado. Contras: los tiros a la cabeza; destruir la bolsa.
- **REMEDIO · pistola de estimulantes** (×3): **X** dispara al compañero del punto de mira (a
  30 m, a la vista; el aviso dice a quién): +40 de vida hasta 140 (lo que pasa del máximo baja
  1 por segundo) y a un derribado lo levanta a distancia con 40. Sin nadie delante, se lo pone él.
- **TIZÓN · botes de gas** (×3): **X** lanza un bote, que espera en el suelo (un disparo lo
  destruye); **mantener X** (o pulsarla sin botes en la mano) activa todos: nube amarillenta de
  4 m durante 10 s que quita 12 por segundo a los atacantes que están dentro y tapa algo la
  vista (a jugadores y bots).
- Con esto están las 16 habilidades. Los bots de los dos bandos ya las usan (ver «Bots»).
- La cámara blindada ya mira hacia la habitación (antes quedaba mirando a la pared).
- Los golpes cuerpo a cuerpo ya no alcanzan objetos a través de una pared.

## Gadgets secundarios (Fase 6)

Se usan con **G**; el que llevas y sus cargas salen abajo a la derecha, junto a la munición.

- **Granada de fragmentación** (×2): rebota; a los 3 s explota: letal a 1,5 m y daño hasta 3 m.
  Las paredes duras protegen; el material blando atenúa y se rompe cerca.
- **Granada de humo** (×2): se abre al pararse; nube de 4 m de radio durante 10 s que tapa la
  vista (también a los bots) y deja un velo gris si estás dentro.
- **Granada cegadora** (×3): a los 1,5 s ciega hasta 3,5 s a quien la ve de frente (menos de
  lado o de espaldas), con pitido en los oídos. Un bot cegado no ve nada mientras dura.
- **Granada de impacto** (×2, defensa): explota al tocar; abre 1 m de pared blanda.
- **Carga de brecha** (×2): mirando una pared blanda, una barricada o una trampilla a menos de
  1,6 m, **G** la coloca en 1,5 s (quieto; moverse o disparar lo cancela) y **G** otra vez la
  detona: hueco de 1 × 2 m (o la barricada o la trampilla entera); letal a 1 m y daño hasta
  2,5 m. En un muro reforzado no sirve.
- **C4 remoto** (×1, defensa): se lanza y se pega donde toca; **G** lo detona: letal a 2,5 m,
  daño hasta 4 m, atraviesa paredes blandas y suelos.
- **Claymore** (×1): se deja en el suelo mirando al frente (1 s) con su láser rojo; salta cuando
  un enemigo entra en su cono de 2 m.
- Los explosivos colocados se destruyen de un disparo del bando contrario (20 puntos).
- **Alambre de púas** (×2, defensa): un rollo de 2 m atravesado delante de ti (1 s). Quien lo
  cruza, de cualquier bando, va a la mitad de velocidad y hace ruido. Las balas lo atraviesan;
  se quita con 3 golpes cuerpo a cuerpo o con un explosivo.
- **Escudo desplegable** (×1, defensa): una placa de 1,25 × 1 m (1 s) que para las balas; solo
  la rompen los explosivos.
- **Cámara blindada** (×1, defensa): en una pared a menos de 2 m (1 s); se suma a las cámaras
  del edificio (**5** para verlas). Las balas rebotan; se rompe de un golpe o con un explosivo.
- **Alarma de proximidad** (×2, defensa): en una pared o en el suelo a menos de 2 m (1 s); si un
  atacante pasa a menos de 2 m, suena y lo marca 3 s para toda la defensa.
- Si miras una pared que se puede reforzar, el aviso te ofrece las dos cosas (**F** refuerzo,
  **G** gadget).

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
- Después de reforzar, cada bot defensor coloca su gadget y su habilidad con lógica (lo que no
  le dé tiempo, en los primeros 15 s de la acción): alambre en el pasillo al otro lado de las
  puertas del sitio, escudo desplegable dentro del sitio encarando un acceso, alarma en el suelo
  de una entrada, cámara blindada en la pared de enfrente de un acceso, baterías en los muros
  reforzados (y si sobran, en las barricadas), inhibidores junto a esos muros, una mina láser en
  cada puerta o ventana, cámaras adhesivas lanzadas por las puertas hasta una pared de fuera
  (antes de atrancarlas), un interceptor en cada sala del sitio y los botes de gas en las
  entradas. CORAZA deja la bolsa de placas al empezar y los demás pasan a coger la suya. En la
  acción, TIZÓN activa el gas cuando sabe de un atacante junto a un bote. En Novato no usan
  gadgets (como pide el documento).
- El ataque bot usa los suyos en la acción: CHISPA lanza la PEM al muro reforzado del sitio y,
  cuando estalla, TERMO pone la carga térmica, se aparta y la enciende (si una batería se la
  destruye o un inhibidor no le deja encenderla, pide otra PEM); ROMPE abre desde lejos las
  barricadas y paredes blandas del sitio que ve; al entrar, el grupo lanza una cegadora (con el
  humo de NUBE y el escaneo de RADAR), y otra a la sala del sitio antes de cruzar su puerta; una
  granada de fragmentación al defensor que el equipo sabe dónde está y no se ve (por una puerta,
  si hace falta); MURALLA usa el destello del escudo a quemarropa; PULGA destruye con el rayo
  del dron de choque, en la preparación, los gadgets de la defensa y las cámaras que pone (las
  seis fijas del mapa no: el jugador sí puede); y tras plantar, una claymore en la puerta de la
  sala. Por dificultad: en Normal los usan a veces (45 %), tarde (0,6–1,6 s) y con error (1 m),
  y el grupo no espera a la cegadora; en Veterano, más y mejor (75 %); en Élite casi siempre
  (85 %) y coordinados (esperan a que estalle la cegadora y se dan la vuelta, TERMO espera a la
  PEM). En Novato, nada.
- La defensa bot responde: con el aviso del escaneo de RADAR se queda quieta hasta que acaba (así
  apenas la marca); dispara a las cargas de brecha, claymores y cargas térmicas del ataque que ve
  a menos de 14 m; REMEDIO levanta con estimulantes a los compañeros derribados, cura a los
  heridos (si le quedan dos cargas) y se cura a sí mismo; VOLTIO y OJO hacen estallar su C4
  cuando saben de un atacante a menos de 2,5 m de ella (también al otro lado de la pared) y no
  hay compañeros cerca; CORAZA abre en la preparación un hueco de rotación entre las dos salas
  del sitio con una granada de impacto y, tras el plantado, lanza otra al que va a por el
  desactivador (a 3,5–14 m, sin compañeros al lado). Igual que el ataque, según la dificultad:
  en Normal a veces y tarde (se paran con el escaneo ya empezado), en Élite casi siempre y a
  tiempo. En Novato, nada.
- Balance (partidas solo de bots, 16 partidas por nivel): el ataque gana el 53,6 % de las
  rondas en Élite (45 de 84) y el 52,9 % en Normal (46 de 87). Con el ataque usando sus gadgets
  y la defensa aún sin contrajuego ganaba el 58 % en los dos; con el contrajuego y dos
  merodeadores, el 58,9 % en Élite y el 55 % en Normal: por eso la defensa merodea con uno.
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
  los drones que ve; después, las anclas sostienen ángulos en diagonal sobre las puertas del
  sitio (agachados si hace falta) y un merodeador (si hay al menos 3 bots) vigila salas vecinas,
  cambia de sala y vuelve al sitio si el ataque llega o quedan 60 s. (El documento pide 3
  anclas y 2 merodeadores; con 2, el ataque bot ganaba casi el 59 % de las rondas en Élite.)
  Investigan ruidos cercanos, cambian de posición si un dron o una cámara los marca y, tras el
  plantado, van al desactivador: el más cercano lo inutiliza y el resto cubre.
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
  más cercanas a la marca, hasta 2 cada uno, y luego vuelven por libre), **Poner gadget aquí**
  (en la acción, y en la preparación si defiendes: va el aliado que mejor pueda poner algo en
  la marca; primero un gadget que se coloca, como alambre, escudo, cámara o claymore; luego una
  habilidad que se coloca o se suelta, como la batería o las placas; luego lo que se lanza, como
  humo, cegadora o C4; y solo si nadie tiene otra cosa, lo que rompe, como el impacto o la
  fragmentación; a igualdad, el más cercano) y **Por libre**. Un
  aliado responde por radio y la orden activa se ve abajo a la izquierda. Combatir, reanimar,
  recoger el desactivador, plantarlo (con el sitio a la vista o menos de 50 s) y retomar el
  plantado mandan sobre la orden; si caes, vuelven por libre; cada ronda empieza sin órdenes.
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
| I | Inspeccionar el arma (se corta al disparar, apuntar, correr o recargar) |
| G | Gadget secundario (granadas, cargas…) |
| X | Habilidad del operador (y encender la carga térmica colocada) |
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
node tools/smoke-gadgets.mjs <carpeta>  # granadas, brecha y claymore con G en el navegador
node tools/smoke-defensa.mjs <carpeta>  # alambre, escudo, cámara blindada y alarma con G
node tools/smoke-habilidades.mjs <carpeta>  # las 8 habilidades de ataque con X
node tools/smoke-defensa-habilidades.mjs <carpeta>  # habilidades de la defensa con X (baterías, inhibidores...)
node tools/smoke4.mjs <carpeta>  # refuerzos, barricadas, golpes, drones y cámaras en el navegador
node tools/smoke5.mjs <carpeta>  # partida contra bots en el navegador (rejilla, preparación, ronda)
node tools/smoke-bots-gadgets.mjs <carpeta>  # la defensa bot coloca gadgets y habilidades
node tools/smoke-bots-ataque.mjs <carpeta>  # el ataque bot usa sus gadgets y habilidades
node tools/smoke-contrajuego.mjs <carpeta>  # contrajuego de la defensa bot y «Poner gadget aquí»
node tools/smoke-recarga.mjs <carpeta>  # recarga por partes de cada familia de armas, con capturas
node tools/smoke-manos.mjs <carpeta>  # cambio de arma, inspeccionar, reforzar, barricada, reanimar y lanzar
node tools/smoke-siluetas.mjs <carpeta>  # los 16 de cerca (frente, espalda, perfil, arma colgada) y a 25 m
node tools/perf-partida.mjs [html...]  # llamadas de dibujo, triángulos y CPU con 10 operadores a la vista
node tools/mapslice.mjs <carpeta> # cortes cenitales del mapa por planta
```

### Arquitectura

- `src/world/` mundo de vóxeles (chunks de 32³), materiales, trazado de rayos, destrucción, constructor de mapas y el mapa Villa.
- `src/sim/` simulación sin render (corre en Node): física de personaje, operadores, armas,
  plantilla de 16 operadores (`operators.js`), partida por rondas (`match.js`), fortificación
  (`fortify.js`), drones y cámaras (`recon.js`), rejilla de navegación (`nav.js`) y bots
  (`bots.js` con `ai/mover.js`, `ai/perception.js`, `ai/tactics.js`, `ai/gadgetai.js`, `ai/attackkit.js`
  y `ai/throws.js`).
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
- Partida 5v5: la simulación de 10 operadores cuesta ~0,2 ms por tick y la IA de los bots ~0,13 ms
  de media con los gadgets de la Fase 6 (p99 ≈ 1,3 ms), con presupuestos por tick para la
  búsqueda de rutas (900 nodos) y el recálculo de la rejilla tras la destrucción (3 columnas).
  La rejilla (24 000 nodos, 172 000 aristas) se construye una vez al arrancar (~0,9 s,
  «Calculando rutas…»).
