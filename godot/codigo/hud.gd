extends CanvasLayer
## Medidor (ronda 1): fps, tiempo por cuadro, CPU y GPU por cuadro, resolución de render y
## de ventana, renderizador y GPU. V quita o pone la sincronización vertical, F alterna la
## pantalla completa, P guarda una captura en el Escritorio.

const ANCHO_RENDER := 1440.0   # el 3D se dibuja siempre a 1440 píxeles de ancho (ventana o pantalla completa)

@onready var etiqueta: Label = $Etiqueta
@onready var aviso: Label = $Aviso

var vsync := true
var acumulado := 0.0
var cuadros := 0
var peor := 0.0
var ms_medio := 0.0
var ms_peor := 0.0
var aviso_hasta := 0.0
var captura_ruta := ""
var captura_en := -1

func _ready() -> void:
    vsync = DisplayServer.window_get_vsync_mode() != DisplayServer.VSYNC_DISABLED
    var vp := get_viewport()
    if RenderingServer.has_method("viewport_set_measure_render_time"):
        RenderingServer.viewport_set_measure_render_time(vp.get_viewport_rid(), true)
    ajustar_escala()
    get_tree().root.size_changed.connect(ajustar_escala)
    _refrescar()

## El 3D a 1440 px de ancho aunque la ventana sea Retina (2880 px) o pantalla completa.
func ajustar_escala() -> void:
    var px := Vector2(DisplayServer.window_get_size())
    if px.x <= 0.0:
        return
    get_viewport().scaling_3d_scale = clampf(ANCHO_RENDER / px.x, 0.25, 1.0)

func alternar_vsync() -> void:
    vsync = not vsync
    DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if vsync else DisplayServer.VSYNC_DISABLED)
    Engine.max_fps = 0
    avisar("Sincronización vertical: " + ("SÍ (tope 60)" if vsync else "NO (sin límite)"))

func alternar_pantalla_completa() -> void:
    var completa := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
    DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if completa else DisplayServer.WINDOW_MODE_FULLSCREEN)

## Guarda la imagen de la ventana (con este texto encima). Devuelve la ruta o "" si falló.
func guardar_captura(ruta: String = "") -> String:
    var img := get_viewport().get_texture().get_image()
    if ruta == "":
        ruta = OS.get_system_dir(OS.SYSTEM_DIR_DESKTOP).path_join("bloque-cero-captura.png")
    var err := img.save_png(ruta)
    if err != OK:
        ruta = OS.get_user_data_dir().path_join("bloque-cero-captura.png")
        err = img.save_png(ruta)
    if err != OK:
        avisar("No se pudo guardar la captura (error %d)" % err)
        return ""
    avisar("Captura guardada en " + ruta)
    return ruta

## Modo de prueba (mi entorno): guarda una captura tras `cuadros_espera` fotogramas y sale.
func capturar_y_salir(ruta: String, cuadros_espera: int) -> void:
    captura_ruta = ruta
    captura_en = cuadros_espera

func avisar(texto: String, segundos := 4.0) -> void:
    if aviso == null:
        return
    aviso.text = texto
    aviso_hasta = Time.get_ticks_msec() / 1000.0 + segundos

func _unhandled_input(evento: InputEvent) -> void:
    if evento.is_action_pressed("vsync"):
        alternar_vsync()
    elif evento.is_action_pressed("pantalla_completa"):
        alternar_pantalla_completa()
    elif evento.is_action_pressed("captura"):
        guardar_captura()

func _process(dt: float) -> void:
    acumulado += dt
    cuadros += 1
    peor = maxf(peor, dt)
    if acumulado >= 0.5:
        ms_medio = acumulado / cuadros * 1000.0
        ms_peor = peor * 1000.0
        acumulado = 0.0
        cuadros = 0
        peor = 0.0
        _refrescar()
    if aviso.text != "" and Time.get_ticks_msec() / 1000.0 > aviso_hasta:
        aviso.text = ""
    if captura_en > 0:
        captura_en -= 1
        if captura_en == 0:
            _refrescar()
            var ruta := guardar_captura(captura_ruta)
            print("captura: %s · %s" % [ruta, etiqueta.text.replace("\n", " | ")])
            get_tree().quit()

func _refrescar() -> void:
    var vp := get_viewport()
    var rid := vp.get_viewport_rid()
    var cpu := -1.0
    var gpu := -1.0
    if RenderingServer.has_method("viewport_get_measured_render_time_cpu"):
        cpu = RenderingServer.viewport_get_measured_render_time_cpu(rid)
        gpu = RenderingServer.viewport_get_measured_render_time_gpu(rid)
    var ventana := DisplayServer.window_get_size()
    var escala := vp.scaling_3d_scale
    var render := Vector2i(roundi(ventana.x * escala), roundi(ventana.y * escala))
    var lineas := PackedStringArray()
    lineas.append("Bloque Cero · prueba del circuito · Godot %s" % Engine.get_version_info().string)
    lineas.append("FPS %d · sincronización vertical: %s · %.1f ms por cuadro (peor %.1f)" % [Engine.get_frames_per_second(), "SÍ" if vsync else "NO", ms_medio, ms_peor])
    lineas.append("CPU %.2f ms · GPU %.2f ms (medidos por Godot)" % [cpu, gpu] if cpu >= 0.0 else "CPU/GPU: sin medida en esta versión")
    lineas.append("Render 3D %d×%d (escala %.2f) · ventana %d×%d px · %s · %s · %s" % [render.x, render.y, escala, ventana.x, ventana.y, RenderingServer.get_current_rendering_method(), RenderingServer.get_current_rendering_driver_name(), RenderingServer.get_video_adapter_name()])
    lineas.append("V: quitar o poner la sincronización · F: pantalla completa · P: captura en el Escritorio · Esc: soltar el ratón")
    etiqueta.text = "\n".join(lineas)
