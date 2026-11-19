# Vértika

**Visión, verticalidad y tecnología.**  
Plataforma para contabilidad de copropiedades (propiedad horizontal) en Colombia: consola del contador tipo Contaí, bajo **PUC ESAL / Ley 675 / Orientación Técnica 15 CTCP**, con pre-asientos asistidos por IA y un **motor determinista de partida doble**.

> Regla de oro: **la IA propone, el motor contable valida y asienta**. Ningún comprobante se contabiliza si no cuadra.

## Estado del proyecto

| Componente | Estado | Detalle |
| --- | --- | --- |
| Consola del contador (frontend) | ✅ Implementado | Vite 8 + React 19 + TypeScript 7, 9 vistas, atajos de teclado, creación/anulación de comprobantes, causación masiva, CRUD maestros/presupuesto/ajustes |
| Motor contable de dominio | ✅ Implementado | `src/domain/` (frontend) y `backend/src/domain/` (Rust): validación determinista, `Decimal`, hash SHA-256, acarreo de retenciones, balance, cierre |
| Reportes ESAL, Ley 675 y DIAN | ✅ Implementado | Estado de Situación Financiera y Estado de Resultados ESAL (HTML), Paz y Salvo Ley 675 (HTML), Certificados de Retención (HTML), Formato 1001 DIAN (XML), CSV de cartera/balance/presupuesto |
| Persistencia relacional PostgreSQL 16 | ✅ Implementado | Migraciones `001`–`004` con `sqlx::migrate!`, triggers ACID diferidos de partida doble, bloqueo de periodos cerrados e inmutabilidad del ledger |
| Autenticación JWT, RBAC y RLS | ✅ Implementado | JWT HS256 (`POST /api/v1/auth/login`), roles (`CONTADOR`, `ADMINISTRADOR`, `REVISOR_FISCAL`, `CONSEJO`) y Row-Level Security (`tenant_isolation_*`) en PostgreSQL |
| Enlace frontend ↔ backend | ✅ Implementado | Con `VITE_API_URL`, la consola opera contra los endpoints transaccionales Rust manteniendo `localStorage` como caché/respaldo y modo offline |
| CI + Contenedor Backend | ✅ Implementado | GitHub Actions (`frontend` + `backend` contra PostgreSQL 16 real) y `backend/Dockerfile` + `docker-compose.yml` (`--profile full`) |
| Radicación de agentes e integraciones | ⏳ Pendiente | `POST /api/v1/pre-entries`, agente IA real (p. ej. Eve), ingesta XML UBL 2.1 DIAN / OCR, recaudo NFC / Bre-B / Wompi y gestión productiva de usuarios |

## Requisitos

- **Frontend**: Node.js 24+ y npm
- **Backend**: [Rust](https://rustup.rs/) 1.75+ (`cargo`, `rustc`)
- **Base de datos / Contenedores (opcional en local)**: Docker + PostgreSQL 16

## Ejecución rápida

### 1. Frontend (consola del contador)

```bash
npm install
npm run dev
```

Abre la URL que imprime Vite (por defecto `http://localhost:5173`).  
Verificaciones y build:

```bash
npm run lint    # oxlint (0 warnings, 0 errors)
npm run build   # tsc -b && vite build
npm run smoke   # pruebas del dominio (partida doble, coeficientes, cartera, cierre, reportes/XML/HTML)
npm run render  # render SSR de humo de las 9 vistas y App completa
```

### 2. Backend Rust (API, motor determinista y auth)

```bash
cd backend
cp .env.example .env
cargo run
```

Sin `DATABASE_URL`, el servidor escucha en `http://localhost:8080` en modo `demo-memory` con el mismo contrato HTTP/RBAC que PostgreSQL.

### 3. Con PostgreSQL 16 (y Docker completo)

Solo base de datos (para correr `cargo run` o `cargo test` en tu máquina):

```bash
docker compose up -d db
```

Configura en `backend/.env`:

```env
DATABASE_URL=postgres://vertika:vertika@localhost:5432/vertika
AUTH_REQUIRED=false
# AUTH_SECRET=cambia-este-secreto-en-produccion
# CORS_ORIGINS=http://localhost:5173
```

O levanta PostgreSQL + API Rust en contenedores con el perfil `full`:

```bash
docker compose --profile full up -d --build
```

Al iniciar, el backend aplica automáticamente `001_init.sql`, `002_estado_kv.sql`, `003_relational_ledger.sql` y `004_auth_rls_and_crud.sql`, y carga la semilla relacional si `copropiedades` está vacía.

## Autenticación y roles (RBAC)

El botón de usuario en la barra superior abre el selector de sesión (`AuthModal`), permitiendo iniciar sesión contra `/api/v1/auth/login` o cambiar de perfil en modo local:

| Rol | Permisos | Usuario demo (`clave: vertika2026`) |
| --- | --- | --- |
| `CONTADOR` | Todo contabilidad (`aprobar`, `rechazar`, `comprobantes manuales`, `anular`, `cierre`, `causación`, `abrir periodo`, `crear cuentas PUC`) + maestros + lectura | `contador@vertika.co` (Lina Castro) |
| `ADMINISTRADOR` | Gestión de `maestros` (unidades, terceros, presupuesto, parámetros de copropiedad) + `causación masiva` + lectura | `admin@vertika.co` (Carlos Mendoza) |
| `REVISOR_FISCAL` | Solo lectura, auditoría, reportes y exportaciones | `revisor@vertika.co` (Marta Lucía Peña) |
| `CONSEJO` | Solo lectura, auditoría, reportes y exportaciones | `consejo@vertika.co` (Andrea Gómez) |

> Para exigir `Authorization: Bearer <token>` en todas las rutas `/api/v1/*` en entorno servidor, define `AUTH_REQUIRED=true` y un `AUTH_SECRET` robusto.

## Flujo operativo y vistas

### Flujo contable
1. **Bandeja de pre-asientos**: revisa propuestas pendientes, edita líneas contables, ejecuta `F6 · Acarreo IA` (retenciones deterministas por tercero) y `F10 · Asentar`.
2. **Comprobantes manuales y anulaciones**: creación con validación en vivo de partida doble (`CC`, `RC`, `CE`, `NC`, `DS`) y anulación controlada vía nota contable `NC` de reverso (sin borrar historia).
3. **Cartera y causación masiva**: liquidación mensual distribuida por coeficiente (con fondo de imprevistos e intereses de mora opcionales), análisis de antigüedad y descarga de **Paz y Salvo Ley 675** (HTML) para unidades al día.
4. **Cierre y apertura de periodo**: asiento automático de cierre (depreciación, provisión de cartera, traslado al fondo de imprevistos), bloqueo inmutable del periodo en SQL, descarga de paquete de asamblea (EEFF ESAL, certificados de retención, XML DIAN Formato 1001, ejecución presupuestal CSV) y apertura del periodo siguiente.
5. **Maestros, Presupuesto y Ajustes**: creación de cuentas PUC ESAL, alta/edición de unidades inmobiliarias y terceros, ajuste de presupuesto anual por rubro y configuración financiera del conjunto.

### Atajos de teclado

| Tecla | Acción |
| --- | --- |
| `F1` | Ayuda y flujo de trabajo |
| `F2` / `Ctrl K` | Buscador global (PUC, unidades, terceros, comprobantes, acciones) |
| `F3` | Cambiar de conjunto |
| `F4` | Cambiar de periodo |
| `F6` | Acarreo IA de retenciones |
| `F10` | Asentar pre-asiento seleccionado |
| `F11` | Alternar modo de vista en tablas |

## Arquitectura y estructura

```text
.
├─ src/
│  ├─ domain/              # motor contable puro, PUC, seed, formato y reportes ESAL/DIAN (reports.ts)
│  ├─ api.ts               # cliente HTTP + token Bearer hacia el backend Rust
│  ├─ store.ts             # estado React (useSyncExternalStore), RBAC cliente y caché localStorage
│  ├─ components/          # shell, overlays, documento, detalle, AuthModal, NuevoComprobanteModal
│  ├─ views/               # bandeja, libro, balance, presupuesto, cartera, comprobantes, maestros, cierre, ajustes
│  └─ App.tsx
├─ backend/
│  ├─ src/
│  │  ├─ domain/           # modelos HTTP + motor ledger Decimal/SHA-256 en Rust
│  │  ├─ repo/             # MemoryRepo y PostgresRepo con aislamiento por tenant
│  │  ├─ auth.rs           # JWT HS256, HMAC-SHA256 passwords y RBAC
│  │  ├─ error.rs          # mapeo HTTP (401/403/404/409/422)
│  │  └─ main.rs           # router Axum y suite de pruebas integradas
│  ├─ migrations/          # 001 esquema, 002 app_estado, 003 triggers ACID, 004 usuarios/RBAC/RLS
│  ├─ Dockerfile           # build multi-etapa para despliegue
│  └─ seed_bootstrap.json
├─ scripts/                # smoke.ts y render.tsx
├─ docs/ARQUITECTURA.md
├─ .github/workflows/ci.yml
└─ docker-compose.yml      # db (postgres:16) y api (perfil full)
```

## Roadmap siguiente

1. **Ingesta desde agentes (`POST /api/v1/pre-entries`)**: permitir que workers o un agente IA (p. ej. Eve) radiquen pre-asientos reales en la Bandeja sin permiso para asentar directamente.
2. **Conectores DIAN y OCR**: lectura automática de XML UBL 2.1 DIAN y extracción OCR de facturas/recibos públicos.
3. **Recaudo y tesorería fintech**: webhooks reales de NFC, Bre-B y pasarela (Wompi / PSE), más dispersión a proveedores.
4. **Hardening productivo**: gestión/alta real de usuarios por copropiedad, rotación de secretos y despliegue gestionado (frontend + Rust API + PostgreSQL 16).
