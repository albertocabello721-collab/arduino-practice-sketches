extends CharacterBody3D
## Jugador en primera persona (ronda 1): WASD, ratón, Mayús para correr.
## Esc suelta el ratón; un clic lo vuelve a capturar. Las acciones se definen aquí
## para que la prueba sin pantalla las vea igual que el juego.

const VEL_ANDAR := 3.0        # m/s (valor de prueba: la velocidad por operador queda por confirmar)
const VEL_CORRER := 5.5
const SENSIBILIDAD := 0.0022  # radianes por píxel de ratón
const GRAVEDAD := 9.8
const INCLINACION_MAX := 1.45

@onready var cabeza: Node3D = $Cabeza

var inclinacion := 0.0

static func definir_acciones() -> void:
    var teclas := {
        "mover_adelante": KEY_W, "mover_atras": KEY_S, "mover_izq": KEY_A, "mover_der": KEY_D,
        "correr": KEY_SHIFT, "soltar_raton": KEY_ESCAPE,
        "vsync": KEY_V, "pantalla_completa": KEY_F, "captura": KEY_P,
    }
    for nombre in teclas:
        if InputMap.has_action(nombre):
            continue
        InputMap.add_action(nombre)
        var ev := InputEventKey.new()
        ev.physical_keycode = teclas[nombre]
        InputMap.action_add_event(nombre, ev)

func _ready() -> void:
    definir_acciones()
    if DisplayServer.get_name() != "headless":
        Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(evento: InputEvent) -> void:
    if evento is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
        rotate_y(-evento.relative.x * SENSIBILIDAD)
        inclinacion = clampf(inclinacion - evento.relative.y * SENSIBILIDAD, -INCLINACION_MAX, INCLINACION_MAX)
        cabeza.rotation.x = inclinacion
    elif evento.is_action_pressed("soltar_raton"):
        Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else Input.MOUSE_MODE_CAPTURED
    elif evento is InputEventMouseButton and evento.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
        Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _physics_process(dt: float) -> void:
    var entrada := Input.get_vector("mover_izq", "mover_der", "mover_adelante", "mover_atras")
    var direccion := (transform.basis * Vector3(entrada.x, 0.0, entrada.y)).normalized()
    var vel := VEL_CORRER if Input.is_action_pressed("correr") else VEL_ANDAR
    velocity.x = direccion.x * vel
    velocity.z = direccion.z * vel
    velocity.y = 0.0 if is_on_floor() else velocity.y - GRAVEDAD * dt
    move_and_slide()
