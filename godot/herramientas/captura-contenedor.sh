#!/usr/bin/env bash
# Captura del juego sin GPU (mi entorno): Xvfb + Vulkan por software (lavapipe), Forward+.
# Uso: herramientas/captura-contenedor.sh salida.png [ancho alto]   (variable GODOT = ruta al binario)
set -u
cd "$(dirname "$0")/.."
GODOT=${GODOT:-godot}
ANCHO=${2:-1440}; ALTO=${3:-900}
export VK_ICD_FILENAMES=${VK_ICD_FILENAMES:-/usr/share/vulkan/icd.d/lvp_icd.json}
BC_CAPTURA="$1" xvfb-run -a -s "-screen 0 ${ANCHO}x${ALTO}x24" "$GODOT" --path . --rendering-driver vulkan --resolution "${ANCHO}x${ALTO}" 2>&1 | grep -E "captura:|ERROR|SCRIPT ERROR"
