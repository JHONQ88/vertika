# Arquitectura de Vértika

Documento de arquitectura y decisiones técnicas del producto **Vértika** (contabilidad para copropiedades / propiedad horizontal en Colombia).

## 1. Visión

Vértika es una plataforma fintech + contable para copropiedades (ESAL, PUC bajo Ley 675 / Orientación Técnica 15 CTCP) que busca:

- Reducir la digitación del contador mediante ingesta automática y pre-asientos asistidos por IA.
- Garantizar integridad contable con un **motor determinista de partida doble** (la IA propone, el motor valida y asienta).
- Integrar recaudo, cartera, ejecución presupuestal, tesorería y cierre en un solo flujo.

## 2. Estado actual del repositorio

| Componente | Estado | Tecnología |
| --- | --- | --- |
| Consola del contador (frontend) | **Implementado** | Vite 8, React 19, TypeScript 7, CSS (`9` vistas + modales de auth/comprobantes/causación/maestros) |
| Motor contable de dominio | **Implementado (doble)** | TypeScript (`src/domain/engine.ts`, `reports.ts`) y Rust (`backend/src/domain/ledger.rs`) |
| Backend API y persistencia relacional | **Implementado** | Rust, Axum, SQLx 0.8 (`backend/src/repo/`), `MemoryRepo` + `PostgresRepo` con transacciones ACID |
| Esquema, triggers y RLS en PostgreSQL 16 | **Implementado** | Migraciones `001`–`004`: ledger inmutable, validación diferida de cuadre, bloqueo de periodos y RLS multi-tenant |
| Seguridad Auth + RBAC | **Implementado** | JWT HS256 (`backend/src/auth.rs`), roles `CONTADOR`, `ADMINISTRADOR`, `REVISOR_FISCAL`, `CONSEJO` |
| Reportes ESAL, Ley 675 y DIAN | **Implementado** | ESF y ER ESAL (HTML), Paz y Salvo Ley 675 (HTML), Certificados de Retención (HTML), XML Formato 1001 DIAN |
| Ingesta externa DIAN / OCR / pagos / agente IA | **Pendiente** | Planeado (próximo: `POST /api/v1/pre-entries`, integración de agente IA y webhooks reales) |

## 3. Decisión de backend: Rust

Se adopta **Rust** para el backend del núcleo contable por:

- **Corrección y seguridad de memoria** en lógica financiera crítica.
- **Determinismo y rendimiento** con `rust_decimal` para validación de asientos, cálculos y procesamiento de lotes.
- **Modelo de tipos** adecuado para expresar invariantes del ledger (montos, naturalezas, estados, hashing SHA-256).
- **Ecosistema**: Axum/Tower para APIs, `sqlx 0.8`/`tokio` para PostgreSQL async, integración futura con colas y workers.

> Nota: el `blueprint_fintech_ia_propiedad_horizontal.md` original proponía NestJS + FastAPI; este documento **actualiza** esa decisión a Rust para el core/API, manteniendo los objetivos funcionales del blueprint (multi-tenant, ledger ACID, agentes IA, integraciones Colombia).

## 4. Arquitectura objetivo

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Clientes                                    │
│  Consola Contador (React/Vite) · Portal Residente/NFC · Agente IA   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS / JSON + JWT Bearer
┌───────────────────────────────▼─────────────────────────────────────┐
│                     Vértika Backend (Rust / Axum)                   │
│  Auth & RBAC · API Transaccional · Motor Determinista · Auditoría   │
├─────────────────┬──────────────────┬────────────────────────────────┤
│ Ledger Service  │ Recaudo/Tesorería│ Ingesta & Agentes (workers/Eve)│
│ (partida doble) │ (webhooks/payouts│ (DIAN XML, OCR, conciliación)  │
└────────┬────────┴────────┬─────────┴───────────────┬────────────────┘
         │                 │                         │
┌────────▼────────┐ ┌──────▼──────┐          ┌──────▼──────┐
│ PostgreSQL 16   │ │ Colas/Async │          │ Integraciones│
│ Ledger, RLS,    │ │ (trabajos)  │          │ DIAN, Wompi, │
│ triggers ACID   │ │             │          │ Bre-B, WA    │
└─────────────────┘ └─────────────┘          └─────────────┘
```

### 4.1 Principios

1. **IA propone, motor dispone**: los LLMs/OCR/agentes solo pueden proponer pre-asientos pendientes; el backend valida reglas contables, cuadre, periodo abierto y retenciones antes de persistir en el ledger.
2. **Ledger inmutable y auditable**: comprobantes asentados no se editan ni eliminan; las anulaciones generan una nota contable `NC` de reverso en la misma transacción, con hash SHA-256 y trazabilidad.
3. **Multi-tenant estricto**: las entidades operativas pertenecen a una `copropiedad_id`, con aislamiento reforzado por políticas RLS (`tenant_isolation_*` vía `app.current_copropiedad_id`) y validación RBAC por copropiedad.
4. **Consistencia transaccional**: comprobante, líneas en `movimientos_ledger` y evento en `auditoria_eventos` se escriben dentro de una única transacción PostgreSQL protegida por triggers diferidos.

## 5. Modelo de dominio (resumen)

- **Copropiedad**: NIT, NIIF grupo, parámetros financieros (fondo de imprevistos, mora, pronto pago, llave Bre-B), periodo actual.
- **Unidad inmobiliaria**: torre/número, coeficiente (suma 100%), congelamiento de mora; vínculos propietario/arrendatario.
- **Tercero**: proveedor/propietario/arrendatario/empleado, documento/DV, parámetros de retención (ReteFuente/ReteICA/ReteIVA) y régimen.
- **PUC ESAL**: cuentas por copropiedad (código, naturaleza D/C, tipo, vínculo a rubro, bandera de efectivo/restricción).
- **Rubro presupuestal**: centro de costo, cuenta y presupuesto anual editable.
- **Pre-asiento**: propuesta pendiente (`PENDIENTE` / `APROBADO` / `RECHAZADO`), agente/origen, confianza, documento y líneas.
- **Comprobante contable**: cabecera (`CC`/`RC`/`CE`/`NC`/`DS`, consecutivo, periodo, origen, hash SHA-256, estado) + **movimientos** (cuenta, débito/crédito, tercero/unidad/rubro).
- **Auditoría y cierre**: `auditoria_eventos` y `periodos_cerrados` por copropiedad.
- **Usuarios y roles**: `usuarios` y `usuario_copropiedad_roles` (`CONTADOR`, `ADMINISTRADOR`, `REVISOR_FISCAL`, `CONSEJO`).

Ver migraciones SQL: `backend/migrations/001_init.sql` a `004_auth_rls_and_crud.sql`.

## 6. Contratos API actuales

Base por defecto en desarrollo: `http://localhost:8080` (ver detalle completo de payloads y permisos en [`backend/README.md`](../backend/README.md)).

- **Salud y Auth**: `GET /health`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`.
- **Estado y utilidades deterministas**: `GET /api/v1/bootstrap`, `GET|PUT /api/v1/state`, `POST /api/v1/reset`, `GET /api/v1/puc`, `POST /api/v1/ledger/validate`, `POST /api/v1/ledger/preview`, `POST /api/v1/pre-entries/carry-forward`, `POST /api/v1/balance`.
- **Ledger y pre-asientos**: `PUT /api/v1/pre-entries/:id/lines`, `POST /api/v1/pre-entries/:id/approve`, `POST /api/v1/pre-entries/:id/reject`, `POST /api/v1/entries`, `POST /api/v1/entries/:id/void`, `GET /api/v1/companies/:company_id/entries`, `POST /api/v1/companies/:company_id/periods/:period/close`, `GET /api/v1/companies/:company_id/reports/balance`, `GET /api/v1/companies/:company_id/audit`.
- **Periodos y maestros**: `POST /api/v1/companies/:company_id/periods/:period/bill`, `POST /api/v1/companies/:company_id/periods/open-next`, `POST|PUT /api/v1/companies/:company_id/units...`, `POST|PUT /api/v1/companies/:company_id/third-parties...`, `POST /api/v1/companies/:company_id/puc`, `PUT /api/v1/companies/:company_id/rubros/:rubro_id`, `PATCH /api/v1/companies/:company_id/settings`.

## 7. Frontend

- **Ubicación:** raíz del repo (`src/`, `index.html`).
- **Estado y red:** `src/store.ts` (`useSyncExternalStore`) + `src/api.ts` con sesión JWT Bearer y caché local en `localStorage`; si `VITE_API_URL` está vacío opera 100% en modo local.
- **Dominio y reportes:** `src/domain/engine.ts` y `src/domain/reports.ts` ejecutan validaciones inmediatas en UI y generan reportes HTML/XML/CSV.
- **Vistas:** Bandeja, Libro, Balance (incluye Estados Financieros ESAL), Presupuesto, Cartera (incluye causación masiva y Paz y Salvo), Comprobantes, Maestros, Cierre y Ajustes.
- **Atajos:** `F1` ayuda, `F2`/`Ctrl+K` búsqueda, `F3` empresa, `F4` periodo, `F6` acarreo, `F10` asentar, `F11` modos.

## 8. Seguridad y cumplimiento

- **Implementado**: autenticación JWT HS256, verificación de contraseñas con HMAC-SHA256 con sal e iteraciones, autorización RBAC por rol y copropiedad, Row-Level Security en PostgreSQL (`004_auth_rls_and_crud.sql`), auditoría en servidor y CORS configurable (`CORS_ORIGINS`).
- **Hardening pendiente para producción**: activar `AUTH_REQUIRED=true`, usar `AUTH_SECRET` gestionado, ejecutar la app con un rol PostgreSQL sin privilegio `BYPASSRLS`, gestión de contraseñas/alta de usuarios y políticas de retención bajo Ley 1581.

## 9. Roadmap técnico

1. ✅ **Normalización del ledger (Bloque B)**: tablas relacionales, triggers ACID diferidos, hash SHA-256 y API transaccional.
2. ✅ **Seguridad, maestros y operación mensual (Bloque C)**: JWT/RBAC/RLS, causación masiva, apertura de periodo, CRUD maestros/presupuesto y reportes ESAL/DIAN.
3. ⏳ **Radicación e ingesta IA (`POST /api/v1/pre-entries`)**: endpoint para crear pre-asientos pendientes desde agentes (p. ej. Eve) o parsers XML UBL 2.1 DIAN y OCR.
4. ⏳ **Fintech/operación real**: webhooks de recaudo (NFC / Bre-B / Wompi), dispersiones a proveedores y portal de residentes.
5. ⏳ **Despliegue productivo**: imágenes/servicios separados (Frontend + Backend Rust en contenedor + PostgreSQL 16 gestionado), TLS y monitoreo.

## 10. Referencias

- `blueprint_fintech_ia_propiedad_horizontal.md` — visión de producto, flujos y stack original propuesto.
- `README.md` — guía de ejecución y resumen operativo.
- `backend/README.md` — ejecución y API del servicio Rust.
- `backend/migrations/001_init.sql` .. `004_auth_rls_and_crud.sql` — esquema, triggers ACID y RLS.
