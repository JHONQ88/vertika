# Vértika Backend (Rust)

API y motor contable determinista para copropiedades (PUC ESAL), implementado en **Rust** con **Axum**.

> Estado: backend funcional con **API HTTP**, validación determinista y **persistencia de estado**. Si `DATABASE_URL` está configurado, aplica migraciones (`001_init.sql`, `002_estado_kv.sql`) y guarda/lee el estado de la aplicación en PostgreSQL; sin `DATABASE_URL` opera en modo `demo-memory`.

## Requisitos

- [Rust](https://rustup.rs/) 1.75+ (cargo, rustc)
- (Opcional) Docker / PostgreSQL 16+ para persistencia real

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

3. Ejecuta el backend (aplica migraciones automáticamente al iniciar):

```bash
cargo run
```

También puedes aplicar las migraciones manualmente con `psql -f migrations/001_init.sql -f migrations/002_estado_kv.sql`.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Estado del servicio y modo (`demo-memory` o `postgres`) |
| `GET` | `/api/v1/bootstrap` | Datos maestros + estado de la aplicación (para el frontend) |
| `GET` | `/api/v1/state` | Estado actual (pre-asientos, comprobantes, auditoría, periodos cerrados) |
| `PUT` | `/api/v1/state` | Guarda el estado de la aplicación |
| `POST` | `/api/v1/reset` | Restablece el estado de demostración |
| `GET` | `/api/v1/puc` | Catálogo PUC ESAL de demostración |
| `POST` | `/api/v1/ledger/validate` | Valida un borrador de comprobante (partida doble, cuentas, montos) |
| `POST` | `/api/v1/ledger/preview` | Valida y devuelve hash/preview de asiento |
| `POST` | `/api/v1/pre-entries/carry-forward` | Acarreo determinista de retenciones según tercero |
| `POST` | `/api/v1/balance` | Vista previa de balance de prueba a partir de saldos/movimientos enviados |

### Ejemplo: validar asiento

```bash
curl -X POST http://localhost:8080/api/v1/ledger/validate \
  -H "Content-Type: application/json" \
  -d '{
    "company_id":"altavista",
    "period":"2026-11",
    "entry_type":"CC",
    "date":"2026-11-12",
    "description":"Prueba",
    "lines":[
      {"account":"513505","description":"Vigilancia","debit":1000000,"credit":0},
      {"account":"220505","description":"Proveedor","debit":0,"credit":1000000}
    ]
  }'
```

## Estructura

```
backend/
  src/
    main.rs               # servidor Axum, rutas, bootstrap/estado
    db.rs                 # conexión PostgreSQL, migraciones y persistencia de estado
    domain/
      mod.rs              # modelos, catálogos demo
      ledger.rs           # validación, hash, acarreo de retenciones, balance preview
  migrations/
    001_init.sql          # esquema relacional (copropiedades, ledger, pre-asientos, auditoría)
    002_estado_kv.sql     # almacenamiento del estado de aplicación (integración MVP)
  seed_bootstrap.json     # datos maestros y estado inicial para bootstrap
  .env.example
```

## Principios

- **Determinismo contable**: el backend decide si un asiento es válido (débitos = créditos, cuentas existentes, reglas de retención). La IA solo propone.
- **Integridad**: el esquema incluye restricciones de cuadre y tipos; en producción se refuerza con transacciones, triggers y RLS por `copropiedad_id`.
- **Persistencia**: con `DATABASE_URL` el estado se guarda en PostgreSQL (`app_estado`); el esquema relacional queda listo para normalización progresiva.

## Próximos pasos

1. Normalizar persistencia: leer/escribir pre-asientos, comprobantes y auditoría en tablas relacionales (no solo JSON de estado).
2. CRUD de copropiedades, unidades, terceros y PUC por tenant.
3. Posting transaccional en servidor (consecutivos, hash, bloqueo de periodos, auditoría).
4. Reportes y cierre calculados/servidos desde backend.
5. Autenticación, RBAC y Row-Level Security.
6. Integraciones: DIAN, recaudo (PSE/Bre-B/NFC), dispersión y mensajería.
