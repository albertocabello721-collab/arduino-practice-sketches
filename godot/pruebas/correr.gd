extends SceneTree
## Pruebas sin pantalla (ronda 1). Uso: godot --headless --path godot -s pruebas/correr.gd
## Carga la escena principal y comprueba lo que tiene que haber. Sale con 0 si todo pasa.

var fallos: PackedStringArray = []

func comprobar(ok: bool, que: String) -> void:
    print(("  ok   " if ok else "  MAL  ") + que)
    if not ok:
        fallos.append(que)

func _initialize() -> void:
    var escena: PackedScene = load("res://escenas/main.tscn")
    comprobar(escena != null, "carga escenas/main.tscn")
    if escena == null:
        _terminar()
        return
    var main: Node = escena.instantiate()
    root.add_child(main)
    # (los nodos se preparan, _ready, en el primer fotograma: se espera a él)
    await process_frame
    # jugador y cámara
    var jugador: Node = main.get_node_or_null("Jugador")
    comprobar(jugador is CharacterBody3D, "hay un jugador (CharacterBody3D)")
    var camara: Node = main.get_node_or_null("Jugador/Cabeza/Camara")
    comprobar(camara is Camera3D, "el jugador lleva una cámara en la cabeza")
    for accion in ["mover_adelante", "mover_atras", "mover_izq", "mover_der", "correr", "vsync", "pantalla_completa", "captura", "soltar_raton"]:
        comprobar(InputMap.has_action(accion), "acción definida: " + accion)
    # el cuarto: seis cierres con malla, material con texturas y colisión
    var cierres := ["Suelo", "Techo", "ParedSur", "ParedEste", "ParedOeste", "VentanaIzquierda", "VentanaDerecha", "VentanaDintel", "VentanaAntepecho"]
    for nombre in cierres:
        var cuerpo: Node = main.get_node_or_null(nombre)
        var malla: MeshInstance3D = cuerpo.get_node_or_null("Malla") if cuerpo else null
        var forma: CollisionShape3D = cuerpo.get_node_or_null("Forma") if cuerpo else null
        var mat: Material = malla.get_surface_override_material(0) if malla else null
        var con_texturas: bool = mat is StandardMaterial3D and mat.albedo_texture != null and mat.normal_texture != null and mat.roughness_texture != null
        comprobar(cuerpo is StaticBody3D and malla != null and forma != null and forma.shape != null and con_texturas, nombre + ": malla, material con color, normal y rugosidad, y colisión")
    # luces y entorno
    comprobar(main.get_node_or_null("Sol") is DirectionalLight3D and main.get_node("Sol").shadow_enabled, "sol direccional con sombra")
    comprobar(main.get_node_or_null("Lampara") is OmniLight3D and main.get_node("Lampara").shadow_enabled, "lámpara con sombra")
    var entorno: WorldEnvironment = main.get_node_or_null("Entorno")
    comprobar(entorno != null and entorno.environment != null and entorno.environment.ssao_enabled, "entorno con cielo y oclusión ambiental")
    comprobar(main.get_node_or_null("Reflejos") is ReflectionProbe, "sonda de reflejos del cuarto")
    # medidor: V alterna la sincronización sin romperse
    var hud: Node = main.get_node_or_null("HUD")
    comprobar(hud != null and hud.get_node_or_null("Etiqueta") is Label, "HUD con su etiqueta")
    if hud:
        var antes: bool = hud.vsync
        hud.alternar_vsync()
        comprobar(hud.vsync != antes, "V cambia el estado de la sincronización")
        hud.alternar_vsync()
        comprobar(hud.vsync == antes, "V lo devuelve")
        comprobar(Engine.max_fps == 0, "sin tope de fps aparte de la sincronización")
    # ajustes del proyecto que pide la spec
    comprobar(ProjectSettings.get_setting("rendering/renderer/rendering_method") == "forward_plus", "renderizador Forward+")
    comprobar(int(ProjectSettings.get_setting("rendering/anti_aliasing/quality/msaa_3d")) == 1, "MSAA 2x")
    comprobar(int(ProjectSettings.get_setting("rendering/lights_and_shadows/directional_shadow/size")) == 2048, "sombra del sol de 2048")
    comprobar(int(ProjectSettings.get_setting("display/window/size/viewport_width")) == 1440 and int(ProjectSettings.get_setting("display/window/size/viewport_height")) == 900, "ventana de 1440×900")
    _terminar()

func _terminar() -> void:
    print("%d fallos" % fallos.size())
    quit(0 if fallos.is_empty() else 1)
