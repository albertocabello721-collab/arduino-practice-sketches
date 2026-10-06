# Bloque Cero en Godot: cómo abrirlo y actualizarlo (para principiante)

Todo se hace con tres programas gratis: **Godot** (el motor), **GitHub Desktop** (para bajar y actualizar el proyecto) y el **Finder**. Sin terminal.

## 1. Instalar Godot 4.7.2 (una sola vez)

1. Abre este enlace en Safari: https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_macos.universal.zip
   Verás que Safari descarga un archivo de unos 100 MB.
2. Abre la carpeta **Descargas**. Verás `Godot.app` (Safari descomprime el zip solo; si ves `Godot_v4.7.2-stable_macos.universal.zip`, haz doble clic en él y aparecerá `Godot.app`).
3. Arrastra `Godot.app` a la carpeta **Aplicaciones**.
4. Haz doble clic en `Godot.app`. Si macOS dice que no puede verificar al desarrollador: botón derecho sobre `Godot.app` → **Abrir** → **Abrir**. Si sigue sin dejar: **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el aviso de Godot y pulsa **Abrir de todos modos**.
5. Verás la ventana **Godot Engine - Gestor de proyectos** con una lista vacía. Ya está instalado; puedes cerrarla.

La versión tiene que ser exactamente la **4.7.2**: aparece arriba en esa ventana.

## 2. Instalar GitHub Desktop (una sola vez)

1. Abre https://desktop.github.com/ y pulsa **Download for macOS**. Verás `GitHub Desktop.app` en Descargas (si ves un zip, doble clic).
2. Arrástralo a **Aplicaciones** y ábrelo.
3. Pulsa **Sign in to GitHub.com**, entra con tu cuenta en el navegador y vuelve a la app. Pulsa **Finish**.
4. Verás la pantalla de inicio de GitHub Desktop (**Let's get started!**).

## 3. Bajar el proyecto (una sola vez)

1. En GitHub Desktop: menú **File → Clone Repository…** (o el botón **Clone a Repository from the Internet…**).
2. Pestaña **URL**. En el campo de arriba pega:
   `https://github.com/albertocabello721-collab/arduino-practice-sketches`
   Deja la carpeta de abajo como está (normalmente `Documents/GitHub`). Pulsa **Clone**.
3. Verás una barra de progreso y, al acabar, la pantalla del repositorio con tres botones arriba: **Current Repository**, **Current Branch**, **Fetch origin**.
4. Pulsa **Current Branch** y elige **claude/dazzling-bardeen-yptinb**. Es la rama donde publico. Verás que el botón pasa a decir ese nombre.
5. Comprueba en el Finder: **Documentos → GitHub → arduino-practice-sketches → godot**. Dentro tiene que estar `project.godot`.

## 4. Abrir el juego

1. Abre `Godot.app`. En el gestor de proyectos pulsa **Importar** (columna izquierda).
2. En la ventana que sale pulsa **Explorar** y busca `Documentos/GitHub/arduino-practice-sketches/godot/project.godot`. Selecciónalo y pulsa **Importar y editar**.
3. Se abre el editor de Godot. La primera vez verás una barra **(Re)Importando recursos** durante unos segundos: son las texturas.
4. Pulsa el botón ▶ (**Ejecutar proyecto**) arriba a la derecha, o **Cmd + B**.
5. Se abre la ventana **Bloque Cero**: el cuarto con el parqué, el yeso, la ventana y la lámpara, y un texto arriba a la izquierda con los fps. Haz un clic dentro para que capture el ratón.

La próxima vez el proyecto ya aparece en la lista del gestor: doble clic en **Bloque Cero** y ▶.

## 5. Teclas y qué mandarme

| Tecla | Qué hace |
|---|---|
| W A S D y ratón | andar y mirar |
| Mayús | correr |
| **V** | quita o pone la sincronización vertical. Con ella puesta el tope es 60; sin ella se ven los fps reales |
| **F** | pantalla completa (otra vez F para volver) |
| **P** | guarda una captura `bloque-cero-captura.png` en tu **Escritorio** (macOS te pedirá permiso la primera vez: **Permitir**) |
| Esc | suelta el ratón (clic para volver a capturarlo) |

Para la prueba de la ronda 1 mándame dos capturas con **P**: una con la sincronización puesta (debe marcar 60) y otra sin ella (pulsa V y espera 3 segundos). La línea «Render 3D» tiene que decir 1440×900.

## 6. Actualizar cuando yo publique algo nuevo

1. Abre GitHub Desktop. Pulsa **Fetch origin** (arriba a la derecha). Si hay cambios, el botón pasa a decir **Pull origin**: púlsalo. Verás el historial con los cambios nuevos a la izquierda.
2. Vuelve a Godot. Si el editor estaba abierto, puede preguntar si recargar los archivos cambiados: **Recargar**. Pulsa ▶.
3. Si algo se ve raro después de actualizar: cierra Godot, ábrelo y vuelve a entrar al proyecto desde la lista.

## 7. Si algo falla

- **La ventana del juego sale negra o muy lenta:** mándame la captura igualmente con los fps que marque.
- **Godot dice que el proyecto es de otra versión:** comprueba que arriba del gestor de proyectos ponga 4.7.2.
- **GitHub Desktop no muestra la rama:** pulsa **Fetch origin** y vuelve a abrir **Current Branch**.
