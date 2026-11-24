# Vértika · Presentación Ejecutiva y Manual de Prueba para Contadores

**Consola contable inteligente para Propiedad Horizontal en Colombia**  
*Ley 675 de 2001 · PUC ESAL · Orientación Técnica 15 CTCP · NIIF Grupo 2/3 · Exógena DIAN 1001*

---

## 1. Presentación del Proyecto (¿Por qué Vértika?)

### El problema del día a día en Propiedad Horizontal
Un contador de Propiedad Horizontal suele administrar entre **5 y 30 copropiedades** al mismo tiempo, enfrentando cada mes la misma carga operativa repetitiva:
- Digitar manualmente facturas recurrentes (vigilancia, aseo, ascensores, servicios públicos, seguros, honorarios) y recalcular **IVA, ReteFuente, ReteICA y ReteIVA** por proveedor.
- Causar expensas ordinarias, cuotas extraordinarias, fondo de imprevistos e intereses de mora unidad por unidad según coeficiente.
- Responder solicitudes de **Paz y Salvo**, estados de cartera por edades y reportes para el **Consejo de Administración, Revisoría Fiscal y Asamblea**.
- Armar el cierre mensual (depreciación, deterioro de cartera, traslado al fondo de imprevistos) y preparar **Estados Financieros ESAL, certificados de retención y Formato 1001 DIAN**.

### La solución: Vértika
**Vértika** es una consola contable multi-copropiedad diseñada con velocidad de teclado para el contador (estilo consola clásica de productividad), potenciada por **Inteligencia Artificial supervisada** y respaldada por un **motor contable determinista en Rust**.

> **Regla de Oro de Vértika:**  
> **La IA propone, el motor contable valida matemáticamente y el contador decide con `F10 · Asentar`.**  
> Ningún comprobante puede contabilizarse si la partida doble no cuadra al centavo o si usa cuentas inexistentes en el PUC.

### Características principales ya operativas

| Área | Qué incluye Vértika |
| :--- | :--- |
| **Multi-copropiedad real** | Cambia de conjunto en 1 segundo (`F3`) manteniendo contabilidad, PUC, cartera, presupuesto, periodos y permisos completamente aislados. |
| **Bandeja de pre-asientos con IA** | Recibe facturas electrónicas, documentos soporte (`DS`) y recaudos (`Bre-B`, `PSE`); sugiere imputación PUC y calcula retenciones automáticas por tercero con **`F6 · Acarreo IA`**. |
| **Copiloto Contable Eve IA** | Asistente integrado que consulta saldos y catálogo PUC en vivo, verifica cuadres y propone borradores de pre-asiento **siempre bajo aprobación explícita del contador** (nunca asienta sin permiso). |
| **Motor determinista & Ledger inmutable** | Validación exacta con aritmética `Decimal`, firma criptográfica **SHA-256** por comprobante, bloqueo de periodos cerrados y prohibición de borrado (`DELETE`): toda corrección se hace mediante **Nota Contable (`NC`) de reverso**. |
| **Causación masiva y Cartera Ley 675** | Causación mensual automática por coeficiente de copropiedad (expensas + fondo de imprevistos + mora opcional), cartera por edades (`Al día`, `1–30`, `31–60`, `+90` días) y emisión instantánea de **Paz y Salvo Ley 675** solo para unidades en `$ 0`. |
| **Cierre mensual y Paquete de Asamblea / DIAN** | Asiento automático de cierre (depreciación, provisión de cartera y traslado al Fondo de Imprevistos 1 %) + exportación de **Estado de Situación Financiera ESAL**, **Estado de Resultados ESAL**, **Certificados de Retención (HTML)**, **Formato 1001 DIAN (XML)** y CSVs de balance, cartera y presupuesto. |
| **Control de acceso (RBAC) y Seguridad** | Roles diferenciados (`CONTADOR`, `ADMINISTRADOR`, `REVISOR_FISCAL`, `CONSEJO`), aislamiento estricto por copropiedad (Row-Level Security + validación en servidor), protección anti-fuerza bruta y bitácora completa de auditoría. |

---

## 2. Manual Rápido de Uso (Guía de ensayo en 10 minutos)

El entorno de prueba incluye **3 copropiedades precargadas** (*Altavista*, *Colina Campestre* y *Plaza Norte*) con 3 meses de historia contable (`2026-09`, `2026-10` cerrados y `2026-11` abierto), 54 unidades inmobiliarias, 105 comprobantes cuadrados y pre-asientos listos para revisar.

### Atajos de teclado de la consola
| Tecla | Acción |
| :--- | :--- |
| **`F1`** | Abrir ayuda y flujo de trabajo |
| **`F2`** o **`Ctrl + K`** | Buscador global (cuentas PUC, unidades, terceros, comprobantes) |
| **`F3`** | Cambiar de copropiedad |
| **`F4`** | Cambiar de periodo contable |
| **`F6`** | Ejecutar **Acarreo IA de retenciones** sobre el pre-asiento activo |
| **`F10`** | **Asentar** el pre-asiento validado en los libros contables |
| **`F11`** | Alternar vista compacta / expandida en tablas |

### Perfiles precargados para probar permisos (clave demo: `vertika2026`)
Haz clic arriba a la derecha en **`LC Lina Castro`** para alternar roles o iniciar sesión con correo y contraseña:

| Rol | Usuario demo | Qué puede hacer | Qué tiene bloqueado |
| :--- | :--- | :--- | :--- |
| **`CONTADOR`** | `contador@vertika.co` | Control total contable: aprobar/rechazar pre-asientos, crear/anular comprobantes, cerrar/abrir periodos, crear cuentas PUC, maestros y usuarios. | No puede borrar comprobantes asentados (solo reversar con `NC`). |
| **`ADMINISTRADOR`** | `admin@vertika.co` | Causar expensas del mes, gestionar unidades, propietarios/arrendatarios, proveedores, presupuesto, parámetros y emitir Paz y Salvos. | **No puede tocar libros contables** (no asienta, no anula, no cierra periodos). |
| **`REVISOR_FISCAL`** | `revisor@vertika.co` | 100 % lectura y descarga de libros, balances, comprobantes con hash SHA-256, reportes ESAL/DIAN y bitácora de auditoría. | Cualquier modificación (`403 Forbidden`). |
| **`CONSEJO`** | `consejo@vertika.co` | Consulta de ejecución presupuestal, cartera, balance y reportes de gestión. | Cualquier modificación (`403 Forbidden`). |

---

### Recorrido recomendado para la demostración (6 pasos)

#### Paso 1 · Revisar y asentar en la Bandeja de pre-asientos
1. En la vista inicial **Bandeja de pre-asientos**, selecciona una factura pendiente en la columna izquierda (ej. *Vigilancia y seguridad — Seguridad Atlas S.A.S.* o *Documento soporte — José Rodríguez*).
2. Revisa en el centro el soporte del documento y sus metadatos XML/fiscales.
3. En la columna derecha edita cualquier cuenta PUC, descripción o valor si lo deseas.
4. Pulsa **`F6 · Acarreo IA`** para recalcular automáticamente las retenciones según el perfil tributario del proveedor (ReteFuente, ReteICA, ReteIVA).
5. Verifica la barra verde **Partida doble cuadrada** y pulsa **`F10 · Asentar`** → el comprobante queda en firme en los libros con consecutivo y hash SHA-256.

#### Paso 2 · Probar el Copiloto Contable Eve IA
1. En la barra superior haz clic en el botón **`Copiloto Eve IA`**.
2. Prueba preguntas reales como:
   - *"Dame un resumen del estado actual de Altavista en 2026-11 y confirma si el balance de prueba cuadra."*
   - *"Calcula retenciones y valida un borrador de honorarios contables por $2.500.000."*
3. Si le pides radicar un borrador en la bandeja, verás que el agente se detiene y **te pide aprobación explícita** antes de crear el pre-asiento `PENDIENTE` (nunca asienta directamente en el libro mayor).

#### Paso 3 · Crear comprobante manual y probar anulación controlada
1. Entra a **Comprobantes** en el menú izquierdo y haz clic en **`+ Nuevo comprobante`**.
2. Selecciona tipo (`CC`, `RC`, `CE`, `NC` o `DS`), agrega líneas de débito y crédito; observa cómo el botón de guardar solo se habilita cuando la diferencia es `$ 0`.
3. Sobre cualquier comprobante `ASENTADO` del periodo abierto, haz clic en **Ver detalle** → **Anular comprobante**: el sistema conserva el original marcado como `ANULADO` y genera automáticamente una **Nota Contable (`NC`) de reverso**.

#### Paso 4 · Cartera, Causación masiva y Paz y Salvo Ley 675
1. Abre **Cartera y paz y salvo**.
2. Filtra unidades al día o en mora y haz clic en **`Paz y salvo`** sobre una unidad con saldo `$ 0` para descargar el certificado oficial listo para imprimir/entregar (en unidades con mora el sistema bloquea la emisión).
3. Prueba **`Causar expensas del mes`** (en un periodo nuevo tras abrir mes) para generar automáticamente el comprobante `CC` distribuido por coeficiente de todas las unidades.

#### Paso 5 · Consultar Libro Auxiliar, Balance de Prueba y Ejecución Presupuestal
1. Entra a **Libro auxiliar** para revisar movimientos filtrables por cuenta PUC, tercero o unidad.
2. Abre **Balance de prueba** para verificar sumas iguales, saldos iniciales, movimientos del periodo y saldos finales (exportable a CSV).
3. Revisa **Ejecución presupuestal** para comparar lo ejecutado frente al presupuesto anual aprobado por la asamblea (con alertas de desviación).

#### Paso 6 · Cierre mensual, Paquete ESAL/DIAN y Apertura de periodo
1. Entra a **Cierre mensual**.
2. Revisa la previsualización automática de los 3 cálculos de cierre: **Depreciación mensual**, **Provisión/deterioro de cartera** y **Traslado al Fondo de Imprevistos (1 %)**.
3. Ejecuta **`Cerrar periodo`** → el mes `2026-11` queda bloqueado de forma inmutable y se habilita **`Abrir siguiente periodo (2026-12)`**.
4. Descarga en un clic los entregables:
   - **Estado de Situación Financiera (ESF ESAL)**
   - **Estado de Resultados ESAL**
   - **Certificado consolidado de retenciones**
   - **Exógena DIAN Formato 1001 (XML)**

*(En cualquier momento puedes ir a **Ajustes y auditoría → Restablecer demo** para volver los datos al estado inicial y repetir la prueba).*

---

## 3. ¿Cómo pueden implementarlo en su firma contable o copropiedad?

Vértika está diseñado para adoptarse de forma progresiva, sin traumatismos ni migraciones riesgosas:

### Fase 1 · Piloto en paralelo (Semana 1–2, costo mínimo / sin riesgo)
- El contador elige **1 copropiedad piloto** (idealmente de 20 a 100 unidades) y corre Vértika en paralelo durante un cierre mensual para validar tiempos, reportes ESAL y conciliación de cartera contra su software actual.
- Puede ejecutarse **100 % en el computador local** del contador o en un servidor privado de prueba.

### Fase 2 · Parametrización de la copropiedad real (1 a 2 horas por conjunto)
Desde **Maestros**, **Presupuesto** y **Ajustes** se cargan los 5 bloques base del conjunto:
1. **Datos y políticas financieras**: NIT, razón social, Grupo NIIF, % Fondo de Imprevistos (Ley 675: mínimo 1 %), tasa de mora mensual, día de corte y % de descuento por pronto pago, llave Bre-B.
2. **Saldos iniciales** del balance de apertura a la fecha de corte.
3. **Catálogo de unidades inmobiliarias**: torre, número, área, matrícula inmobiliaria y **coeficiente de copropiedad** (el sistema verifica que sumen exactamente `100 %`).
4. **Terceros**: propietarios, arrendatarios y proveedores habituales con sus tarifas de ReteFuente, ReteICA y ReteIVA (para que `F6 · Acarreo IA` funcione automático desde el día 1).
5. **Presupuesto anual aprobado por Asamblea** por rubro.

### Fase 3 · Puesta en producción segura (Firma multi-conjunto o Copropiedad)
- Se despliega la base de datos **PostgreSQL 16** (en red privada con respaldos diarios cifrados), la **API Rust** con variables productivas (`AUTH_REQUIRED=true`, `SEED_DEMO=false`, `AUTH_SECRET` de 64 caracteres, `CORS_ORIGINS` restringido) y la consola web + Copiloto Eve.
- El contador crea desde **`LC → Nuevo usuario`** las cuentas reales del equipo:
  - Un acceso `ADMINISTRADOR` restringido **únicamente a su copropiedad** (no puede ver otros conjuntos de la firma ni alterar asientos).
  - Accesos de solo lectura para el **`REVISOR_FISCAL`** y el **`CONSEJO`**, eliminando el envío manual de archivos cada semana.

### Fase 4 · Automatizaciones avanzadas (Opcional según crecimiento)
Una vez operando la contabilidad base en producción, Vértika está arquitectónicamente preparado (`POST /api/v1/pre-entries`) para conectar:
- **Buzón de Factura Electrónica DIAN (XML UBL 2.1)** y emisión de Documento Soporte (`CUDS`) vía Proveedor Tecnológico o conexión directa.
- **Recaudo referenciado automático** (Wompi / PSE / Bre-B / archivo plano Asobancaria) y recepción de soportes por WhatsApp con OCR hacia la Bandeja de pre-asientos.
- **Portal de consulta para propietarios** (acceso sin contraseña mediante `Unidad + Cédula + Matrícula` o QR firmado) para autogestión de estado de cuenta y Paz y Salvo.

---

## 4. Preguntas frecuentes de contadores

- **¿La IA puede dañar mi contabilidad o asentar algo mal?**  
  No. La IA solo crea borradores (`pre-asientos`) y requiere confirmación explícita. Ningún comprobante entra al libro mayor sin pasar por las validaciones deterministas del motor Rust y la aprobación `F10` del contador.
- **¿Cumple con trazabilidad para Revisoría Fiscal y DIAN?**  
  Sí. Todos los comprobantes tienen consecutivo único por tipo, hash SHA-256, usuario/rol que lo registró, fecha/hora exacta, bitácora de auditoría y bloqueo de borrado físico en PostgreSQL.
- **¿Si llevo 15 conjuntos, un administrador de un conjunto puede ver los datos de otro?**  
  No. El aislamiento es doble: el token JWT restringe las copropiedades asignadas a cada usuario y PostgreSQL aplica políticas de seguridad por fila (**Row-Level Security**).
- **¿Se puede usar sin depender 100 % de la nube?**  
  Sí. Puede operar en nube (SaaS multi-conjunto) o en servidor/PC local de la oficina con PostgreSQL local.
