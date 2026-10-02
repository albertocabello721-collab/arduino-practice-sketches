# Especificaciones en pausa

Guardadas tal como quedaron al cambiar de rumbo (octubre de 2026). Se retoman después de las rondas visuales V0–V5.

## F10.4d · Noche justa (medida)

Lo medido (herramienta `tools/medir-contraste.mjs`): operador a oscuras en el jardín, de noche, con y sin él en pantalla. «Se distingue» = el 10 % de sus píxeles difieren del fondo en 20 niveles o más (de 255). Límite = distancia donde deja de cumplirse.

| luz en el objetivo | límite 720p | 540p | 1080p |
|---|---|---|---|
| 0 y 0,02 | 0 m (nada se ve) | 0 | 0 |
| 0,035 | 16 m (borroso a cualquier distancia) | 10 | – |
| 0,07 | 31 m | 27 | – |
| 0,14 (la luna de la Villa) | 36 m | 29 | más de 45 |
| 0,28 o más | sin límite | sin límite | – |

Con la luna de la Villa la exposición automática está al tope y la silueta se recorta contra el cielo o el seto: el jugador ve a 36 m; el factor 0,5 actual (24 m) deja a los bots más ciegos que el jugador. En la calle, con la fachada iluminada detrás, se ve a 45 m.

- Qué cambia: el factor 0,5 se sustituye por la curva luz → distancia visible medida; un bot ve a quien está a oscuras solo hasta esa distancia (ojos, drones y cámaras).
- Reglas: puntos (luz → m): 0 → 0; 0,02 → 0; 0,035 → 16; 0,07 → 31; 0,14 → 36; 0,25 → sin límite. Lineal entre puntos. A menos de 4 m siempre se ve (contacto). Reacción +100 ms, láser y fogonazo, como ahora.
- No cambia: de día nada; dentro de la casa (0,27–0,87) nada; oído, puntería, equilibrio de día.
- Pruebas: (1) unitaria con la tabla medida; (2) medir-contraste imprime «bot ve: sí/no» con la regla real y falla si ve donde no se distingue; (3) equilibrio Élite de noche, 60 partidas por bando, 47–53 %.
- Decisiones pendientes: curva fija a 720p (recomendada) o escalada con la resolución real; umbral 20 niveles (15 → 45 m, 25 → 33 m).

## F12.6 · Pasos legibles

- Qué cambia: los pasos ajenos dicen cómo se mueve (correr, andar, agachado), en qué piso (arriba, abajo, mismo) y sobre qué (material); lo que oyen los bots no cambia (se ajusta en el audio, no en la simulación).
- Reglas: niveles correr 0 dB, andar −8, agachado −16, tumbado −22 (hoy −5/−11/−15); correr añade un golpe grave (120 Hz, 60 ms), agachado solo el roce. Piso: mismo = directo; arriba = paso bajo 450 Hz, −6 dB, más el retumbo del techo (70 Hz, 120 ms, +3 dB en madera); abajo = paso bajo 700 Hz, −9 dB, sin retumbo, reverberación doble. Materiales (centro espectral): moqueta 450 Hz sin ataque; madera 700 Hz con crujido en 1 de 4 pasos; baldosa y hormigón 1,6 kHz, clic seco; metal 1,9 kHz con resonancia de 700 Hz de 90 ms; hierba 2,2 kHz, roce; gravilla 3,2 kHz, crujido de 90 ms.
- No cambia: propagación (oclusión 0,35 pared y 0,6 suelo, rodeos), oído de los bots, pasos propios, música.
- Pruebas (`tools/medir-pasos.mjs`, audio renderizado sin depender de los FPS): (1) a 10 m, correr−andar ≥ 8 dB y andar−agachado ≥ 8 dB; (2) piso: un clasificador fijo (centro espectral, banda 50–100 Hz, nivel) acierta 9 de 9 (3 materiales × 3 pisos); (3) dirección: 8 azimuts, ángulo lateral por diferencia de tiempo entre oídos a ±20° en 8 de 8, delante/detrás al menos 6 de 8; materiales: los 6 centros en el orden previsto.

## F11 · Menú principal y progresión (tienda)

Pendiente de proponer. En pausa.

## Segundo mapa · Residencia del Lago (con rappel)

En pausa.

## Contorno de aliados (sustituida)

La ronda «contorno en vez de relleno» queda sustituida por la V1: icono y nombre sobre la cabeza, contorno de 1 px a media opacidad solo en la parte tapada, sin relleno, desvanecido de 30 a 40 m, nunca enemigos, con opción en ajustes.
