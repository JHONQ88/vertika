# Vértika

**Visión, verticalidad y tecnología.**  
Plataforma para contabilidad de copropiedades (propiedad horizontal) en Colombia: consola del contador tipo Contaí, bajo **PUC ESAL / Ley 675 / Orientación Técnica 15 CTCP**, con pre-asientos asistidos por IA y un **motor determinista de partida doble**.

> Regla de oro: **la IA propone, el motor contable valida y asienta**. Ningún comprobante se contabiliza si no cuadra.

## Estado del proyecto

| Componente | Estado | Detalle |
| --- | --- | --- |
| Consola del contador (frontend) | ✅ Implementado | Vite + React + TypeScript, 9 vistas, atajos de teclado, datos demo |
| Motor contable de dominio | ✅ Implementado | `src/domain/` (frontend) y `backend/src/domain` (Rust): validación, balance, acarreo, reglas deterministas |
| Persistencia local | ✅ Implementado | `localStorage` (`vertika.estado.v4`) como caché/respaldo |
| Enlace frontend ↔ backend | ✅ Implementado | Si `VITE_API_URL` está definido, el frontend carga (`/api/v1/bootstrap`) y sincroniza estado (`PUT /api/v1/state`) con el backend |
| Backend API (Rust) | ✅ Implementado (MVP) | Axum: bootstrap, estado, reset, validación, preview/hash, acarreo y balance preview |
| Base de datos PostgreSQL | ✅ Integrado (opcional/activable) | `docker-compose.yml` + migraciones (`001_init.sql`, `002_estado_kv.sql`); con `DATABASE_URL` el backend persiste en `app_estado` |
| Normalización completa del ledger en BD | 🟡 Parcial | Esquema relacional listo; persistencia operativa actual en JSON de estado (MVP) |
| Integraciones reales (DIAN, recaudo, NFC, mensajería) | ⏳ Pendiente | Planeadas en arquitectura/roadmap |

## Requisitos

- **Frontend**: Node.js 18+ y npm
- **Backend**: [Rust](https://rustup.rs/) 1.75+ (`cargo`, `rustc`)
- **Base de datos (opcional pero recomendada)**: Docker + PostgreSQL 16 (o PostgreSQL instalado)

## Ejecución rápida

### Frontend (consola del contador)

```bash
npm install
npm run dev
```

Abre la URL que imprime Vite (por defecto `http://localhost:5173`).  
Build y verificaciones:

```bash
npm run build   # TypeScript + build de producción
npm run smoke   # prueba del dominio (partida doble, coeficientes, cartera, cierre)
npm run render  # render de humo de todas las vistas
npm run lint
```

### Backend Rust (API y motor determinista)

```bash
cd backend
cp .env.example .env
cargo run
```

Servidor por defecto: `http://localhost:8080`. Ver detalles en [`backend/README.md`](backend/README.md).

### Base de datos PostgreSQL (persistencia real)

```bash
# en la raíz del proyecto
docker compose up -d db
```

Configura en `backend/.env`:

```env
DATABASE_URL=postgres://vertika:vertika@localhost:5432/vertika
```

Al iniciar, el backend aplica migraciones automáticamente y persiste el estado en la tabla `app_estado` (además de crear el esquema relacional de `001_init.sql`).

### Enlace frontend ↔ backend

El frontend lee `VITE_API_URL` (ver `.env` / `.env.example`). Con el backend en marcha:

- `GET /api/v1/bootstrap` carga datos maestros y estado.
- `PUT /api/v1/state` sincroniza cada cambio (asentar, aprobar/rechazar, editar pre-asientos, cierre, etc.).
- `POST /api/v1/reset` restablece la demo.

> Si `VITE_API_URL` está vacío, el frontend funciona en modo local con `localStorage`.

## Cómo funciona (prototipo actual)

### Flujo operativo
1. **Bandeja de pre-asientos**: llegan documentos/propuestas (simulados en demo) con asiento sugerido y confianza.
2. **Revisión**: el contador edita cuentas, terceros, rubros y montos.
3. **F6 · Acarreo IA**: aplica retenciones deterministas según el tercero (ReteFuente/ReteICA/ReteIVA) y recompone la contrapartida.
4. **F10 · Asentar**: se valida la partida doble y el PUC; si es válido se crea el comprobante (consecutivo, hash, auditoría).
5. **Impacto inmediato**: libro auxiliar, balance, presupuesto, cartera y comprobantes se actualizan.
6. **Cierre**: genera comprobante automático (depreciación, provisión de cartera, traslado a fondo de imprevistos) y bloquea el periodo.

Los **periodos cerrados** quedan en solo lectura.

### Vistas
- **Bandeja de pre-asientos**: documento + asiento propuesto editable, validación en vivo.
- **Libro auxiliar**: detalle/resumen por cuenta, saldo corrido, exportación CSV.
- **Balance de prueba**: saldos/movimientos por tipo de cuenta y cuadre.
- **Ejecución presupuestal**: presupuesto anual vs ejecutado por rubro y alertas.
- **Cartera y paz y salvo**: antigüedad, mora y estado por unidad.
- **Comprobantes**: listado, filtros y detalle (origen, hash).
- **Maestros**: PUC ESAL, unidades (coeficientes) y terceros (retenciones).
- **Cierre mensual**: previsualización y ejecución del cierre.
- **Ajustes y auditoría**: configuración, trazabilidad, exportar/restablecer demo.

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

## Datos de demostración

- **Altavista**: 24 unidades (NIIF Grupo 2).
- **Colina Campestre**: 12 unidades.
- **Plaza Norte**: 18 locales.

Periodos: **sep/oct 2026 cerrados**, **nov 2026 abierto** con pre-asientos pendientes.  
La información se guarda en `localStorage` y, si está configurado `VITE_API_URL`, se sincroniza con el backend/BD. Desde **Ajustes** se puede exportar el estado o restablecer la demo.

## Arquitectura

- **Frontend:** SPA React. Usa `src/domain/` para reglas y experiencia inmediata; con `VITE_API_URL` sincroniza estado con el backend.
- **Backend (Rust/Axum):** API para bootstrap/estado/reset y endpoints deterministas (`validate`, `preview`, `carry-forward`, `balance`). Con `DATABASE_URL` aplica migraciones y persiste en PostgreSQL.
- **Base de datos:** `backend/migrations/001_init.sql` define el esquema relacional del ledger; `002_estado_kv.sql` soporta la persistencia MVP del estado enlazado al frontend.

```
.
├─ src/
│  ├─ domain/           # motor contable puro (tipos, PUC, seed, engine, formato)
│  ├─ api.ts             # cliente HTTP hacia el backend
│  ├─ store.ts          # estado + acciones + sincronización local/remota
│  ├─ components/       # shell, overlays, documento, detalle
│  ├─ views/            # bandeja, libro, balance, presupuesto, cartera, etc.
│  └─ App.tsx
├─ backend/
│  ├─ src/              # Axum API, db, dominio/ledger en Rust
│  ├─ migrations/       # 001 esquema relacional, 002 estado MVP
│  └─ seed_bootstrap.json
├─ docs/
│  └─ ARQUITECTURA.md
├─ docker-compose.yml   # PostgreSQL
├─ .env.example         # VITE_API_URL
└─ blueprint_fintech_ia_propiedad_horizontal.md
```

## Determinismo contable

- Las reglas críticas (partida doble, cuentas válidas, retenciones/acarreo, hash de comprobante) se ejecutan de forma **determinista**.
- El frontend aplica estas reglas para respuesta inmediata; el backend expone las mismas capacidades (`/api/v1/ledger/validate`, `/api/v1/ledger/preview`, `/api/v1/pre-entries/carry-forward`) como fuente verificable para integraciones y, progresivamente, para posting en servidor.
- La IA (o procesos de ingesta) solo proponen pre-asientos: nunca se deben contabilizar movimientos descuadrados.

## Reglas del motor contable

- Un comprobante solo se asienta si **débitos = créditos** y las cuentas existen en el PUC.
- Los movimientos no pueden tener débito y crédito simultáneos ni montos inválidos.
- Los **coeficientes** de copropiedad suman 100%.
- Los **periodos cerrados** son inmutables para nuevas contabilizaciones.
- Cada comprobante queda con **hash, origen y auditoría**.
- El **cierre** aplica depreciación, provisión de cartera y traslado al fondo de imprevistos.

## Documentación

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md): arquitectura, decisión de backend en Rust, modelo de datos, contratos y roadmap.
- [`backend/README.md`](backend/README.md): ejecución y API del servicio Rust.
- [`backend/migrations/001_init.sql`](backend/migrations/001_init.sql): esquema inicial PostgreSQL.
- [`blueprint_fintech_ia_propiedad_horizontal.md`](blueprint_fintech_ia_propiedad_horizontal.md): visión de producto y blueprint funcional original.

## Roadmap resumido

1. **Normalizar persistencia**: pasar de `app_estado` (JSON MVP) a tablas relacionales para pre-asientos, comprobantes, movimientos y auditoría con posting transaccional en servidor.
2. **Autenticación y multi-tenant**: RBAC y Row-Level Security por `copropiedad_id`.
3. **API de dominio completa**: maestros, flujo de aprobación/asentado, reportes y cierre calculados en backend.
4. **Frontend 100% API-driven**: usar endpoints de acciones/reportes del backend como fuente de verdad (manteniendo `localStorage` solo como caché/offline).
5. **Ingesta y agentes** (DIAN/soportes/recaudo) y módulos fintech (NFC/Bre-B/payouts).
