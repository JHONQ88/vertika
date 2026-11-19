# Vértika Backend (Rust)

API y motor contable determinista para copropiedades (PUC ESAL), implementado en **Rust** con **Axum**, **SQLx (`0.8`)** y **rust_decimal**.

> Estado: Bloques A, B y C completados — persistencia relacional ACID en PostgreSQL 16, autenticación JWT HS256, RBAC por rol y copropiedad, Row-Level Security (`app.current_copropiedad_id`), causación masiva de expensas, apertura de periodo y CRUD de maestros. Sin `DATABASE_URL` opera en modo `demo-memory` con el mismo contrato HTTP y reglas deterministas.

## Requisitos

- [Rust](https://rustup.rs/) 1.75+ (`cargo`, `rustc`)
- (Opcional en local) Docker / PostgreSQL 16+

## Ejecutar en local

```bash
cd backend
cp .env.example .env
cargo run
```

Servidor por defecto: `http://localhost:8080`.

### Con PostgreSQL 16

1. Levanta PostgreSQL desde la raíz del proyecto:

```bash
docker compose up -d db
```

2. Configura `backend/.env`:

```env
DATABASE_URL=postgres://vertika:vertika@localhost:5432/vertika
AUTH_REQUIRED=false
```

3. Ejecuta el backend (aplica `001`–`004` vía `sqlx::migrate!` y carga la semilla relacional + usuarios demo si está vacío):

```bash
cargo run
```

### Contenedor Docker

Desde la raíz del proyecto (PostgreSQL 16 + API Rust):

```bash
docker compose --profile full up -d --build
```

O solo construir la imagen del backend:

```bash
docker build -t vertika-backend ./backend
```

### Variables de entorno

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `8080` | Puerto HTTP de Axum |
| `RUST_LOG` | `vertika_backend=debug,tower_http=info,sqlx=warn` | Filtro de logs (`tracing-subscriber`) |
| `DATABASE_URL` | *(vacío → `demo-memory`)* | Cadena de conexión PostgreSQL |
| `AUTH_REQUIRED` | `false` | Si `true`, exige `Authorization: Bearer <jwt>` en todas las rutas `/api/v1/*` (excepto `/health` y `/api/v1/auth/login`) |
| `AUTH_SECRET` | `vertika-dev-secret-change-in-prod` | Secreto HMAC para firma de JWT HS256 |
| `CORS_ORIGINS` | *(vacío → `Any`)* | Lista separada por comas de orígenes permitidos en producción |

### Tests

```bash
# Modo memoria + pruebas unitarias del ledger (14 tests; la prueba de PostgreSQL se salta si falta DATABASE_URL)
cargo test

# Verificación binaria sin tests
cargo check

# Contra PostgreSQL 16 real (triggers SQL, RLS, JWT/RBAC, CRUD y ciclo HTTP completo)
DATABASE_URL=postgres://vertika:vertika@localhost:5432/vertika cargo test
```

## Credenciales demo (`POST /api/v1/auth/login`)

Contraseña común en demo: `vertika2026`

- `contador@vertika.co` → `CONTADOR`
- `admin@vertika.co` → `ADMINISTRADOR`
- `revisor@vertika.co` → `REVISOR_FISCAL`
- `consejo@vertika.co` → `CONSEJO`

## Endpoints

### Salud y autenticación

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Estado del servicio, versión y modo (`demo-memory` o `postgres`) |
| `POST` | `/api/v1/auth/login` | Autentica correo/clave y devuelve JWT HS256 + perfil y roles por copropiedad |
| `GET` | `/api/v1/auth/me` | Devuelve el usuario autenticado (requiere Bearer token) |

### Generales y motor determinista

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/v1/bootstrap` | Datos maestros, catálogo y estado inicial |
| `GET` / `PUT` | `/api/v1/state` | Lectura y compatibilidad de estado de aplicación |
| `POST` | `/api/v1/reset` | Restablece tablas/estado a la semilla inicial (`CONTADOR` / `ADMINISTRADOR`) |
| `GET` | `/api/v1/puc` | Catálogo PUC ESAL (`?company_id=...`) |
| `POST` | `/api/v1/ledger/validate` | Valida un borrador de comprobante (partida doble, PUC, montos) |
| `POST` | `/api/v1/ledger/preview` | Valida y devuelve hash SHA-256 (64 hex) y preview de asiento |
| `POST` | `/api/v1/pre-entries/carry-forward` | Acarreo determinista de retenciones según tercero |
| `POST` | `/api/v1/balance` | Vista previa de balance de prueba a partir de saldos y movimientos enviados |

### Operaciones transaccionales del ledger

| Método | Ruta | Roles / Descripción |
| --- | --- | --- |
| `PUT` | `/api/v1/pre-entries/:id/lines` | `CONTADOR` · Actualiza líneas editadas de un pre-asiento pendiente |
| `POST` | `/api/v1/pre-entries/:id/approve` | `CONTADOR` · Asienta comprobante + movimientos + auditoría en transacción ACID |
| `POST` | `/api/v1/pre-entries/:id/reject` | `CONTADOR` · Marca pre-asiento como `RECHAZADO` y registra auditoría |
| `POST` | `/api/v1/entries` | `CONTADOR` · Crea y asienta un comprobante contable manual (`201 Created`) |
| `POST` | `/api/v1/entries/:id/void` | `CONTADOR` · Anula un comprobante generando nota contable `NC` de reverso |
| `GET` | `/api/v1/companies/:company_id/entries` | Lectura · Lista comprobantes de una copropiedad (`?period=YYYY-MM`) |
| `POST` | `/api/v1/companies/:company_id/periods/:period/close` | `CONTADOR` · Ejecuta cierre mensual (`NC`) y bloquea el periodo |
| `GET` | `/api/v1/companies/:company_id/reports/balance` | Lectura · Balance de prueba agregado directo del ledger (`?period=...`) |
| `GET` | `/api/v1/companies/:company_id/audit` | Lectura · Eventos de auditoría de la copropiedad |

### Periodos y maestros (Bloque C)

| Método | Ruta | Roles / Descripción |
| --- | --- | --- |
| `POST` | `/api/v1/companies/:company_id/periods/:period/bill` | `CONTADOR`, `ADMINISTRADOR` · Causación masiva de expensas (con mora opcional) |
| `POST` | `/api/v1/companies/:company_id/periods/open-next` | `CONTADOR`, `ADMINISTRADOR` · Abre el siguiente periodo tras confirmar el cierre del actual |
| `POST` | `/api/v1/companies/:company_id/units` | `CONTADOR`, `ADMINISTRADOR` · Crea unidad inmobiliaria y vínculos propietario/arrendatario |
| `PUT` | `/api/v1/companies/:company_id/units/:unit_id` | `CONTADOR`, `ADMINISTRADOR` · Actualiza unidad, coeficiente y estado de congelamiento |
| `POST` | `/api/v1/companies/:company_id/third-parties` | `CONTADOR`, `ADMINISTRADOR` · Crea tercero con parámetros de retención y régimen |
| `PUT` | `/api/v1/companies/:company_id/third-parties/:tp_id` | `CONTADOR`, `ADMINISTRADOR` · Actualiza tercero |
| `POST` | `/api/v1/companies/:company_id/puc` | `CONTADOR` · Agrega cuenta al PUC ESAL de la copropiedad |
| `PUT` | `/api/v1/companies/:company_id/rubros/:rubro_id` | `CONTADOR`, `ADMINISTRADOR` · Actualiza presupuesto anual de un rubro y recalcula el total del conjunto |
| `PATCH` | `/api/v1/companies/:company_id/settings` | `CONTADOR`, `ADMINISTRADOR` · Actualiza parámetros financieros y llave Bre-B del conjunto |

## Garantías en PostgreSQL (`003` y `004`)

- **`trg_validar_cuadre_comprobante`** (`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`): verifica al hacer `COMMIT` que todo comprobante tenga al menos 2 movimientos en `movimientos_ledger` y que `SUM(debito) = SUM(credito) = cabecera`.
- **`trg_bloquear_periodo_cerrado`**: rechaza inserciones de comprobantes en periodos presentes en `periodos_cerrados`.
- **`trg_inmutabilidad_comprobante`** y **`trg_inmutabilidad_movimientos`**: impiden eliminar o alterar comprobantes/movimientos asentados o anulados (solo permiten pasar `ASENTADO → ANULADO` vía reversión).
- **`fk_mov_puc_cuenta`**: clave foránea compuesta `(copropiedad_id, cuenta_codigo)` contra `puc_esal_cuentas`.
- **Row-Level Security (`004_auth_rls_and_crud.sql`)**: políticas `tenant_isolation_*` basadas en `app.current_copropiedad_id` fijado por transacción en `resolve_company_tx`.

## Pendientes para Fase 2 / Producción

1. Endpoint `POST /api/v1/pre-entries` para radicación de borradores desde ingestas o agentes IA (p. ej. Eve).
2. Ingesta real (XML UBL 2.1 DIAN / OCR de soportes / webhooks NFC, Bre-B y Wompi).
3. Gestión productiva de usuarios (alta, cambio de contraseña y aislamiento RLS obligatorio en roles de BD no-owner).
