# Recepción Automática de Facturas DIAN desde Gmail ($0 COP/mes)

Esta integración conecta el correo Gmail donde el conjunto recibe sus facturas electrónicas (`.xml` o `.zip` UBL 2.1 de la DIAN) directamente con la **Bandeja IA** de **Vértika**.

## Qué hace automáticamente
1. Revisa el correo cada **5 minutos**.
2. Busca correos con adjuntos `.xml` o `.zip` de facturación electrónica DIAN (incluyendo `AttachedDocument`).
3. Extrae CUFE, NIT, emisor, subtotal, IVA y calcula ReteFuente / ReteICA / ReteIVA según las tarifas del proveedor en Vértika.
4. Radica el borrador cuadrado en **Bandeja IA** en estado **`PENDIENTE`** (nunca asienta en firme; el contador revisa y aprueba con `F10`).
5. Marca el correo con la etiqueta **`Vertika/Procesada`** para no duplicar ninguna factura.

---

## Instalación en 5 minutos

### 1. Abre Google Apps Script en el Gmail del conjunto
1. Inicia sesión en la cuenta Gmail de facturación del conjunto.
2. Ve a [https://script.google.com](https://script.google.com) y haz clic en **Nuevo proyecto**.
3. Ponle de nombre **`Vértika · Ingesta DIAN`**.
4. Borra el código que viene por defecto y pega todo el contenido de [`gmail-dian-ingest.gs`](./gmail-dian-ingest.gs).
5. Haz clic en **Guardar** (`Ctrl+S`).

### 2. Configura las credenciales (Propiedades del Script)
En el menú izquierdo de Apps Script, haz clic en el ícono de engranaje (**Configuración del proyecto**) → baja hasta **Propiedades de secuencia de comandos** → **Agregar propiedad** y crea estas 4 propiedades:

| Propiedad | Valor ejemplo |
| :--- | :--- |
| `VERTIKA_API_URL` | `https://vertika-api.onrender.com` |
| `VERTIKA_EMAIL` | `contador@vertika.co` *(o un usuario Administrador dedicado)* |
| `VERTIKA_PASSWORD` | *(la contraseña de ese usuario en Vértika)* |
| `VERTIKA_COMPANY_ID` | `altavista` *(el ID de la copropiedad)* |

*(Opcional)* `VERTIKA_EXPENSE_ACCOUNT`: cuenta PUC de gasto por defecto si el concepto no coincide con vigilancia, aseo, servicios o mantenimiento (por defecto `519510`).

### 3. Prueba manual y activa el disparador automático
1. Vuelve al **Editor** (`< >`).
2. En la barra superior, selecciona la función **`procesarFacturasCorreo`** y haz clic en **Ejecutar** (Google te pedirá autorizar acceso a Gmail y conexiones externas — acepta).
3. Si ya tienes un correo con un `.xml` o `.zip` DIAN en tu bandeja, revisa **Bandeja IA** en Vértika: verás el borrador listo para aprobar con **`F10`**.
4. Por último, selecciona la función **`instalarDisparadorCada5Min`** y haz clic en **Ejecutar** una sola vez.

¡Listo! Desde ese momento cada factura electrónica que llegue al Gmail aparecerá automáticamente en la Bandeja IA de Vértika en menos de 5 minutos.
