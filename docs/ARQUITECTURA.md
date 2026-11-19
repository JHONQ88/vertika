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
| Consola del contador (frontend) | **Implementado** | Vite 8, React 19, TypeScript 7, CSS |
| Motor contable de dominio | **Implementado (doble)** | TypeScript (`src/domain/`) y Rust (`backend/src/domain/`) |
| Enlace frontend ↔ backend | **Implementado (MVP)** | `VITE_API_URL` + `/api/v1/bootstrap`, `/api/v1/state`, `/api/v1/reset` |
| Backend API / ledger server-side | **Implementado (MVP)** | Rust, Axum (`backend/`), validación/preview/acarreo/balance |
| Persistencia | **Implementado** | `localStorage` + PostgreSQL (`app_estado`) cuando `DATABASE_URL` está configurado |
| Esquema de base de datos | **Definido** | PostgreSQL (`backend/migrations/001_init.sql`, `002_estado_kv.sql`, `docker-compose.yml`) |
| Normalización completa del ledger en BD | **Parcial** | Estado operativo en JSON; tablas relacionales listas para adopción |
| Integraciones DIAN / pagos / mensajería | **No implementado** | Planeado (ver roadmap) |

## 3. Decisión de backend: Rust

Se adopta **Rust** para el backend del núcleo contable por:

- **Corrección y seguridad de memoria** en lógica financiera crítica.
- **Determinismo y rendimiento** para validación de asientos, cálculos y procesamiento de lotes.
- **Modelo de tipos** adecuado para expresar invariantes del ledger (montos, naturalezas, estados).
- **Ecosistema**: Axum/Tower para APIs, `sqlx`/`tokio` para PostgreSQL async, integración futura con colas y servicios.

> Nota: el `blueprint_fintech_ia_propiedad_horizontal.md` original proponía NestJS + FastAPI; este documento **actualiza** esa decisión a Rust para el core/API, manteniendo los objetivos funcionales del blueprint (multi-tenant, ledger ACID, agentes IA, integraciones Colombia).

## 4. Arquitectura objetivo

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Clientes                                    │
│  Consola Contador (React) · Portal Residente/NFC · App Admin        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS / JSON
┌───────────────────────────────▼─────────────────────────────────────┐
│                     Vértika Backend (Rust / Axum)                   │
│  Auth & RBAC · API Gateway · Validación determinista · Orquestación │
├─────────────────┬──────────────────┬────────────────────────────────┤
│ Ledger Service  │ Recaudo/Tesorería│ Ingesta & Agentes (workers)    │
│ (partida doble) │ (webhooks/payouts│ (DIAN XML, OCR, conciliación)  │
└────────┬────────┴────────┬─────────┴───────────────┬────────────────┘
         │                 │                         │
┌────────▼────────┐ ┌──────▼──────┐          ┌──────▼──────┐
│ PostgreSQL 16   │ │ Redis/BullMQ│          │ Integraciones│
│ Ledger, RLS,    │ │ colas/cache │          │ DIAN, Wompi, │
│ auditoría       │ │             │          │ Bre-B, WA    │
└─────────────────┘ └─────────────┘          └─────────────┘
```

### 4.1 Principios

1. **IA propone, motor dispone**: los LLMs/OCR extraen y sugieren; el backend valida reglas contables, cuadre y retenciones antes de persistir.
2. **Ledger inmutable y auditable**: comprobantes asentados no se editan; correcciones vía nuevos comprobantes/anulación controlada, con hash y trazabilidad.
3. **Multi-tenant estricto**: toda entidad operativa pertenece a una `copropiedad_id`; aislamiento por RLS y filtros obligatorios en aplicación.
4. **Consistencia transaccional**: asientos y sus movimientos en una misma transacción; restricciones de cuadre en BD y validación previa en dominio.

## 5. Modelo de dominio (resumen)

- **Copropiedad**: NIT, NIIF grupo, parámetros (fondo de imprevistos, mora, pronto pago, Bre-B), periodo actual.
- **Unidad inmobiliaria**: torre/número, coeficiente (suma 100%), estado de cartera; vínculos propietario/arrendatario.
- **Tercero**: proveedor/propietario/arrendatario/empleado/banco, documento y parámetros de retención.
- **PUC ESAL**: cuentas por copropiedad (código, naturaleza D/C, tipo, vínculo a rubro).
- **Rubro presupuestal**: centro de costo, cuenta y presupuesto anual.
- **Pre-asiento**: propuesta pendiente (agente/origen, confianza, documento, líneas JSON) para revisión.
- **Comprobante contable**: cabecera (tipo CC/RC/CE/NC/DS, consecutivo, periodo, origen, hash, estado) + **movimientos** (cuenta, débito/crédito, tercero/unidad/rubro).
- **Auditoría**: eventos de aprobación, rechazo, cierre, cambios relevantes.
- **Periodo cerrado**: bloqueo por copropiedad y periodo.

Ver esquema SQL: `backend/migrations/001_init.sql`.

## 6. Contratos API (actuales)

Base: `http://localhost:8080`

- `GET /health` — estado del servicio y modo (`demo-memory` o `postgres`).
- `GET /api/v1/bootstrap` — datos maestros + estado (para inicializar/sincronizar frontend).
- `GET /api/v1/state` / `PUT /api/v1/state` — lectura y persistencia del estado de aplicación.
- `POST /api/v1/reset` — restablece el estado demo.
- `GET /api/v1/puc` — catálogo PUC demo.
- `POST /api/v1/ledger/validate` — valida borrador (partida doble, cuentas, montos).
- `POST /api/v1/ledger/preview` — validación + hash de contenido y `can_post`.
- `POST /api/v1/pre-entries/carry-forward` — retenciones deterministas (ReteFuente/ICA/IVA).
- `POST /api/v1/balance` — vista previa de balance a partir de saldos y movimientos enviados.

**Evolución planeada:** normalizar operaciones sobre tablas relacionales (pre-asientos, comprobantes, auditoría), posting transaccional en servidor, endpoints de reportes/cierre y CRUD por tenant.

## 7. Frontend

- **Ubicación:** raíz del repo (`src/`, `index.html`).
- **Estado:** `src/store.ts` con `useSyncExternalStore`, persistencia en `localStorage` y sincronización HTTP cuando `VITE_API_URL` está definido (`src/api.ts`).
- **Dominio cliente:** `src/domain/*` aplica reglas deterministas para UX inmediata (validación, preview, acarreo); el backend expone validación/preview/acarreo para verificación y uso por integraciones.
- **Vistas:** Bandeja, Libro, Balance, Presupuesto, Cartera, Comprobantes, Maestros, Cierre, Ajustes.
- **Atajos:** F1 ayuda, F2/Ctrl+K búsqueda, F3 empresa, F4 periodo, F6 acarreo, F10 asentar, F11 modos.
- **Configuración:** `.env` / `.env.example` (`VITE_API_URL`).

## 8. Seguridad y cumplimiento (objetivo)

- Autenticación y autorización por rol (contador, administrador, revisor, consejo) y por copropiedad.
- Row-Level Security en PostgreSQL (`copropiedad_id`).
- Cifrado en tránsito (TLS) y protección de secretos/tokens.
- Registro de auditoría inmutable para operaciones sensibles.
- Cumplimiento de protección de datos personales aplicable (p. ej. Ley 1581 en Colombia) en diseño de accesos y retención.

## 9. Roadmap técnico sugerido

1. **Normalización del ledger**: migrar de estado JSON (`app_estado`) a operaciones sobre tablas relacionales (`pre_asientos`, `comprobantes_contables`, `movimientos_ledger`, `auditoria_eventos`, `periodos_cerrados`) con transacciones y posting en servidor.
2. **Tenancy y maestros**: copropiedades, unidades, terceros, PUC/rubros como fuente en BD, autenticación básica.
3. **API de acciones y reportes**: aprobar/rechazar/asentar/cerrar vía endpoints, reportes (libro, balance, cartera, presupuesto) servidos por backend.
4. **Frontend API-first**: consumir acciones y reportes del backend; `localStorage` como caché/offline.
5. **Seguridad**: RBAC y Row-Level Security por `copropiedad_id`.
6. **Ingesta e IA**: conectores DIAN/soportes, pipeline de agentes que generen pre-asientos.
7. **Fintech/operación**: recaudo (PSE/Bre-B/NFC), payouts, mensajería, portal residente.

## 10. Referencias

- `blueprint_fintech_ia_propiedad_horizontal.md` — visión de producto, flujos y stack original propuesto.
- `README.md` — guía de ejecución y resumen operativo.
- `backend/README.md` — ejecución y API del servicio Rust.
- `backend/migrations/001_init.sql` — esquema de datos inicial.
