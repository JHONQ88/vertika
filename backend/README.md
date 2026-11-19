# Vértika Backend (Rust)

API y motor contable determinista para copropiedades (PUC ESAL), implementado en **Rust** con **Axum**, **SQLx** y **rust_decimal**.

> Estado: backend relacional con **API HTTP transaccional**, aritmética exacta `Decimal`, hash criptográfico **SHA-256**, migraciones automáticas (`sqlx::migrate!`) y triggers de integridad en PostgreSQL 16. Sin `DATABASE_URL` opera con el mismo contrato relacional en modo `demo-memory`.

## Requisitos

- [Rust](https://rustup.rs/) 1.75+ (cargo, rustc)
- (Opcional) Docker / PostgreSQL 16+ para persistencia relacional ACID

## Ejecutar

```bash
cd backend
cp .env.example .env
cargo run
```

Servidor por defecto: `http://localhost:8080`.

### Con PostgreSQL

1. Levanta la base (desde la raíz del proyecto):

```bash
docker compose up -d db
```

2. Configura `DATABASE_URL` en `backend/.env`:

```env
DATABASE_URL=postgres://vertika:vertika@localhost:5432/vertika
```

3. Ejecuta el backend (aplica `001_init.sql`, `002_estado_kv.sql` y `003_relational_ledger.sql` vía `sqlx::migrate!` y carga la semilla relacional si la base está vacía):

```bash
cargo run
```

### Tests

```bash
# Modo memoria (sin PostgreSQL)
cargo test

# Contra PostgreSQL 16 real (incluye pruebas de triggers SQL y ciclo HTTP completo)
DATABASE_URL=postgres://vertika:vertika@localhost:5432/vertika cargo test
```

## Endpoints

### Generales y motor determinista

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Estado del servicio y modo (`demo-memory` o `postgres`) |
| `GET` | `/api/v1/bootstrap` | Datos maestros + estado cargados desde tablas relacionales |
| `GET` / `PUT` | `/api/v1/state` | Lectura y compatibilidad de estado de aplicación |
| `POST` | `/api/v1/reset` | Restablece las tablas relacionales a la semilla inicial |
| `GET` | `/api/v1/puc` | Catálogo PUC ESAL (acepta `?company_id=...`) |
| `POST` | `/api/v1/ledger/validate` | Valida un borrador de comprobante (partida doble, PUC, montos) |
| `POST` | `/api/v1/ledger/preview` | Valida y devuelve hash SHA-256 (64 hex) y preview de asiento |
| `POST` | `/api/v1/pre-entries/carry-forward` | Acarreo determinista de retenciones según tercero |
| `POST` | `/api/v1/balance` | Vista previa de balance de prueba a partir de saldos/movimientos |

### Operaciones transaccionales del ledger (Bloque B)

| Método | Ruta | Descripción |
| --- | --- | --- |
| `PUT` | `/api/v1/pre-entries/:id/lines` | Actualiza líneas editadas de un pre-asiento pendiente |
| `POST` | `/api/v1/pre-entries/:id/approve` | Asienta comprobante + movimientos + auditoría en transacción ACID |
| `POST` | `/api/v1/pre-entries/:id/reject` | Marca pre-asiento como `RECHAZADO` y registra auditoría |
| `POST` | `/api/v1/entries` | Crea y asienta un comprobante contable manual (`201 Created`) |
| `POST` | `/api/v1/entries/:id/void` | Anula un comprobante generando nota contable `NC` de reverso |
| `GET` | `/api/v1/companies/:company_id/entries` | Lista comprobantes de una copropiedad (`?period=YYYY-MM`) |
| `POST` | `/api/v1/companies/:company_id/periods/:period/close` | Ejecuta cierre mensual (`NC`) y bloquea el periodo |
| `GET` | `/api/v1/companies/:company_id/reports/balance` | Balance de prueba agregado directo del ledger (`?period=...`) |
| `GET` | `/api/v1/companies/:company_id/audit` | Eventos de auditoría de la copropiedad |

## Garantías de integridad en PostgreSQL (`003_relational_ledger.sql`)

- **`trg_validar_cuadre_comprobante`** (`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`): verifica al hacer `COMMIT` que todo comprobante tenga al menos 2 movimientos en `movimientos_ledger` y que `SUM(debito) = SUM(credito) = cabecera`.
- **`trg_bloquear_periodo_cerrado`**: rechaza inserciones de comprobantes en periodos presentes en `periodos_cerrados`.
- **`trg_inmutabilidad_comprobante`** y **`trg_inmutabilidad_movimientos`**: impiden eliminar o alterar comprobantes/movimientos asentados o anulados (solo permiten cambiar `estado` de `ASENTADO` a `ANULADO` vía reversión).
- **`fk_mov_puc_cuenta`**: clave foránea compuesta `(copropiedad_id, cuenta_codigo)` contra `puc_esal_cuentas`.

## Próximos pasos (Bloque C)

1. Autenticación (JWT/sesiones), RBAC por rol (`contador`, `administrador`, `revisor`, `consejo`) y Row-Level Security en PostgreSQL.
2. CRUD de copropiedades, unidades, terceros, PUC y presupuestos.
3. Causación masiva de expensas, comprobantes manuales desde UI y reportes PDF/DIAN.
4. Ingesta real (XML UBL 2.1 DIAN / OCR / webhooks Bre-B & NFC).
