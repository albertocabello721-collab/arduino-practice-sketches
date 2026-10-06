# Recursos de apoyo (V1.5, muestra «recursos reales»)

Todos CC0 (dominio público), con la licencia comprobada archivo por archivo en la página de origen.
Se publican al lado de la página del artifact y se cargan por ruta relativa cuando se pulsa U en el
campo de pruebas. Si alguno falta, el juego sigue con lo procedural.

| Archivo | Qué es | Autor y origen | Licencia | Conversión |
|---|---|---|---|---|
| `m4a1.json` | Fusil M4A1 (13 piezas: cargador, palanca de carga, mira, selector, gatillo, tapa del expulsor, cañón, culata, cuerpo) | **nisu**, «M4A1 Assault Rifle», OpenGameArt: https://opengameart.org/content/m4a1-assault-rifle (archivo `m4a1_0.zip`, FBX) | CC0 (la página lo marca CC0; el autor lo atribuye a 3dmodelscc0.com, también CC0) | FBX en cm → glTF JSON con la geometría incrustada, escala horneada a metros, cada pieza con su pivote en el centro |
| `m4a1_color.webp` `m4a1_normal.webp` `m4a1_arm.webp` | Texturas PBR del fusil: color, normal y ARM (R sin usar, G rugosidad, B metal) | Las del mismo paquete (`M4A1_Base_Color.png`, `M4A1_Normal.png`, `M4A1_Roughness.png`, `M4A1_Metallic.png`, 2048 px) | CC0 | 1024 px, WebP calidad 0,85; rugosidad y metal combinadas en una |
| `painted_plaster_wall_diff.webp` `…_nor_gl.webp` `…_arm.webp` | Yeso pintado (2 × 2 m) | **Amal Kumar**, Poly Haven: https://polyhaven.com/a/painted_plaster_wall | CC0 | JPG 1k → WebP 0,85 |
| `herringbone_parquet_diff.webp` `…_nor_gl.webp` `…_arm.webp` | Parqué en espiga (3,4 × 3,4 m) | **Sergej Majboroda** (fotografía) y **Jenelle van Heerden** (procesado), Poly Haven: https://polyhaven.com/a/herringbone_parquet | CC0 | JPG 1k → WebP 0,85 |
| `disparo_fusil.wav` | Disparo grabado (chasquido y cola) | **kurt**, «Gunshots», OpenGameArt: https://opengameart.org/content/gunshots (archivo de pólvora negra) | CC0 | 96 kHz estéreo → 44,1 kHz mono, recortado a 1,1 s desde el pico, pico a −1 dBFS |

Descartado: el paquete «Tabasco» de sonidos (la página dice CC0, pero su `creativecommons.txt` dice CC-BY 3.0).
