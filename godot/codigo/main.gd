extends Node3D
## Escena principal (ronda 1): el cuarto, el sol por la ventana, la lámpara, el jugador y el HUD.
## Si existe la variable de entorno BC_CAPTURA (mi entorno de pruebas), guarda una captura
## tras 30 fotogramas y sale.

func _ready() -> void:
    # el sol entra por la ventana del norte (z negativa) hacia dentro y hacia abajo
    var sol: DirectionalLight3D = $Sol
    var direccion := Vector3(0.35, -0.55, 0.76).normalized()
    sol.look_at_from_position(Vector3(0, 6, -10), Vector3(0, 6, -10) + direccion, Vector3.UP)
    var ruta := OS.get_environment("BC_CAPTURA")
    if ruta != "":
        $HUD.capturar_y_salir(ruta, 30)
