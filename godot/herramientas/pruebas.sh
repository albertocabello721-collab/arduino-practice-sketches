#!/usr/bin/env bash
# Pruebas sin pantalla. Uso: herramientas/pruebas.sh  (variable GODOT = ruta al binario; por defecto «godot»)
set -u
cd "$(dirname "$0")/.."
GODOT=${GODOT:-godot}
"$GODOT" --headless --import --path . >/dev/null 2>&1   # primera vez: importa las texturas a .godot/
"$GODOT" --headless --path . -s pruebas/correr.gd
