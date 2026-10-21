# Catálogo web gMobidec

Aplicación web adaptable a móvil con catálogo filtrable y buscador, panel de administración con inicio de sesión y operaciones para crear, editar y eliminar productos. Los campos del producto son **Tipo**, **Diseño**, **Modelo**, **Descripción**, **Precio Web** y **Foto 1**.

## Probar en modo demostración

Requiere Node.js 18 o posterior; no requiere instalar paquetes externos.

```powershell
Copy-Item .env.example .env
npm start
```

Copia `.env.example` a `.env` antes de iniciar (en macOS/Linux usa `cp .env.example .env`). Abre `http://localhost:3000`. En el modo local, la contraseña inicial del administrador es `demo`. El panel permite gestionar los productos en un archivo local ignorado por Git (`data/products.json`); el catálogo muestra con claridad que esos cambios **no** se sincronizan con FileMaker. Para usar un valor propio, define `ADMIN_PASSWORD` en `.env`.

Las imágenes de muestra se cargan desde URLs de Unsplash; reemplázalas por las URL HTTPS de las fotos reales al editar los productos.

## Conectar FileMaker Data API

Antes de activar la conexión, configura el servidor para que tenga la **FileMaker Data API habilitada** y acceso de red HTTPS a la instancia. En `.env` para desarrollo o como variables/secretos del host en producción, define:

| Variable | Necesaria | Descripción |
| --- | --- | --- |
| `FM_BASE_URL` | Sí | URL HTTPS base de la instancia de FileMaker Server, sin la ruta `/fmi/data`. |
| `FM_DATABASE` | Sí | Nombre exacto de la base de datos. Predeterminado de la plantilla: `gmobidec`. |
| `FM_LAYOUT` | Sí | Nombre exacto de la presentación. Predeterminado de la plantilla: `Catálogo web`. |
| `FM_USERNAME` | Sí | Usuario de integración de FileMaker con privilegios para consultar, crear, editar y borrar registros y leer el campo de foto. |
| `FM_PASSWORD` | Sí | Contraseña de ese usuario, guardada solo como secreto del entorno; no la publiques en el repositorio. |
| `ADMIN_PASSWORD` | Sí en producción | Contraseña de acceso al panel administrativo. El valor local de demostración `demo` no es apto para producción. |
| `FM_FIELDS_JSON` | No | Objeto JSON que asigna los nombres de campos de FileMaker a las propiedades lógicas del catálogo. |
| `FM_PHOTO_MODE` | No | `url` (predeterminado) para un campo URL HTTPS editable desde el panel, o `container` para una foto almacenada como contenedor FileMaker. |

La asignación inicial espera que los campos de la presentación tengan estos nombres exactos:

```json
{
  "tipo": "Tipo",
  "diseno": "Diseño",
  "modelo": "Modelo",
  "descripcion": "Descripción",
  "precio": "Precio Web",
  "foto": "Foto 1"
}
```

Si la base utiliza otros nombres, `FM_FIELDS_JSON` debe contener las seis propiedades lógicas y los nombres de campo correctos. Por ejemplo:

```dotenv
FM_FIELDS_JSON={"tipo":"Tipo","diseno":"Diseño","modelo":"Modelo","descripcion":"Descripción","precio":"Precio Web","foto":"Foto 1"}
```

En `Catálogo web`, la aplicación lee hasta 1000 registros; para los cambios administrativos necesita permisos de creación, edición y eliminación en el conjunto de privilegios de la cuenta de integración. Si `Foto 1` es un campo de URL pública HTTPS, deja `FM_PHOTO_MODE=url` (predeterminado) y el panel puede editarlo. Si es un contenedor FileMaker, establece `FM_PHOTO_MODE=container`: las imágenes se sirven a través de este servidor, el panel conserva la foto existente y deshabilita ese campo para evitar intentar guardar una URL como contenedor. Para agregar o cambiar archivos en contenedores, súbelos directamente a FileMaker. El panel puede modificar fotos cuando estas se almacenan como URL.

La aplicación no considera FileMaker conectado por el solo hecho de tener variables configuradas: al consultar el catálogo inicia sesión en Data API y muestra los productos únicamente cuando esa solicitud tiene éxito. Si no hay configuración FileMaker, usa datos de demostración. Si la conexión está mal configurada, presenta el error en vez de fingir una sincronización. No se incluyen credenciales de FileMaker en el repositorio ni en las peticiones del navegador.

## Ejecutar comprobaciones

```sh
npm run check
```

## Publicar desde GitHub en Render

El repositorio incluye `render.yaml` como Blueprint para un servicio web Node.js de Render. Inicia sesión en Render, crea una **New Blueprint Instance**, conecta `tonymajluf/mobidec` desde GitHub y selecciona la rama `tonymajluf-catalogo-web-gmobidec` (o `main` después de integrar estos cambios). Render ejecutará `npm run check`, iniciará el servicio con `npm start` y desplegará automáticamente los nuevos commits de la rama enlazada.

En la configuración inicial del Blueprint, establece `ADMIN_PASSWORD` con una contraseña fuerte y propia. Para arrancar primero el sitio en modo demostración, deja `FM_BASE_URL`, `FM_USERNAME` y `FM_PASSWORD` vacíos; añade los tres secretos cuando tengas la conexión de FileMaker. `FM_DATABASE` y `FM_LAYOUT` ya se rellenan con `gmobidec` y `Catálogo web`. Nunca pongas las contraseñas en `render.yaml` ni en GitHub. El plan definido es `free`; puede tener arranques en frío y almacenamiento efímero, por lo que los cambios del modo demo no son duraderos. En producción, FileMaker es el origen persistente recomendado.

`render.yaml` automatiza la configuración y los despliegues después de enlazar el Blueprint a tu cuenta; no crea el servicio en Render ni puede acceder a tu cuenta de GitHub/Render desde este repositorio por sí solo. GitHub Pages no puede ejecutar este servidor Node.js ni proteger las credenciales de FileMaker.
