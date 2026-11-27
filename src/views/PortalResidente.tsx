import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPortalCompanyApi,
  fetchPortalStatementApi,
  portalCreateCheckoutApi,
  portalLookupApi,
  portalSimulatePaymentApi,
  type PortalCompanyPublicInfo,
  type PortalLookupUnitMatch,
  type PortalUnitStatement,
} from '../api';
import { fmtCoef, fmtFecha, fmtMoney, fmtPeriodo } from '../domain/format';
import { descargarArchivo, generarCuentaDeCobroHTML, generarPazYSalvoHTML } from '../domain/reports';
import { Badge, Btn, Logo } from '../components/ui';

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void },
  ) => string;
  reset: (widgetId?: string) => void;
};

export function PortalResidente({
  initialToken,
  companySlug,
}: {
  initialToken?: string;
  companySlug?: string;
}) {
  const [token, setToken] = useState(initialToken ?? '');
  const [companyInfo, setCompanyInfo] = useState<PortalCompanyPublicInfo | null>(null);
  const [stmt, setStmt] = useState<PortalUnitStatement | null>(null);
  const [matchedUnits, setMatchedUnits] = useState<PortalLookupUnitMatch[]>([]);
  const [cargando, setCargando] = useState(Boolean(initialToken));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Lookup form
  const [unidadInput, setUnidadInput] = useState('');
  const [mostrarFiltroUnidad, setMostrarFiltroUnidad] = useState(false);
  const [documentoInput, setDocumentoInput] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  // Payment controls
  const [montoMode, setMontoMode] = useState<'total' | 'parcial'>('total');
  const [montoParcial, setMontoParcial] = useState('');
  const [aplicarDescuento, setAplicarDescuento] = useState(true);
  const [procesandoPago, setProcesandoPago] = useState(false);

  const cargarEstado = useCallback(async (tok: string) => {
    setCargando(true);
    setError(null);
    try {
      const data = await fetchPortalStatementApi(tok);
      setStmt(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el estado de cuenta.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!companySlug) return;
    let active = true;
    fetchPortalCompanyApi(companySlug)
      .then((info) => {
        if (active) setCompanyInfo(info);
      })
      .catch(() => {
        // Ignored: lookup or statement call will display detailed error if slug is invalid
      });
    return () => {
      active = false;
    };
  }, [companySlug]);

  useEffect(() => {
    const siteKey = companyInfo?.turnstileSiteKey?.trim();
    const container = turnstileRef.current;
    if (!siteKey || token || !container) return;

    const mountWidget = () => {
      if (!turnstileRef.current) return;
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (!api) return;
      turnstileRef.current.innerHTML = '';
      turnstileWidgetId.current = api.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (tok: string) => setTurnstileToken(tok),
        'expired-callback': () => setTurnstileToken(''),
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-cf-turnstile="1"]');
    if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) {
      mountWidget();
      return;
    }

    const scriptEl = existing ?? document.createElement('script');
    scriptEl.addEventListener('load', mountWidget);
    if (!existing) {
      scriptEl.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      scriptEl.async = true;
      scriptEl.defer = true;
      scriptEl.dataset.cfTurnstile = '1';
      document.head.appendChild(scriptEl);
    }

    return () => {
      scriptEl.removeEventListener('load', mountWidget);
    };
  }, [companyInfo?.turnstileSiteKey, token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    fetchPortalStatementApi(token)
      .then((data) => {
        if (!active) return;
        setStmt(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'No se pudo cargar el estado de cuenta.');
      })
      .finally(() => {
        if (active) setCargando(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const consultarPorDocumento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companySlug) return;
    setBuscando(true);
    setError(null);
    try {
      const res = await portalLookupApi({
        companySlug,
        unidad: mostrarFiltroUnidad && unidadInput.trim() ? unidadInput.trim() : undefined,
        documento: documentoInput.trim(),
        turnstileToken: turnstileToken || undefined,
      });
      const units = res.units && res.units.length > 0 ? res.units : [];
      setMatchedUnits(units);
      if (units.length <= 1) {
        const chosen = units[0]?.token ?? res.token;
        setCargando(true);
        setToken(chosen);
        window.history.replaceState(null, '', `/pagar/${encodeURIComponent(chosen)}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Datos inválidos.');
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api && turnstileWidgetId.current) {
        api.reset(turnstileWidgetId.current);
        setTurnstileToken('');
      }
    } finally {
      setBuscando(false);
    }
  };

  const seleccionarUnidad = (tok: string) => {
    setError(null);
    setAviso(null);
    setCargando(true);
    setToken(tok);
    window.history.replaceState(null, '', `/pagar/${encodeURIComponent(tok)}`);
  };

  const volverASelector = () => {
    setToken('');
    setStmt(null);
    setAviso(null);
    setError(null);
    if (companySlug) {
      window.history.replaceState(null, '', `/portal/${encodeURIComponent(companySlug)}`);
    }
  };

  const iniciarPago = async () => {
    if (!stmt || !token) return;
    setProcesandoPago(true);
    setError(null);
    setAviso(null);
    try {
      const montoReq =
        montoMode === 'parcial'
          ? Math.round(Number(montoParcial) || 0)
          : undefined;
      const checkout = await portalCreateCheckoutApi(token, {
        monto: montoReq,
        aplicarDescuento: montoMode === 'total' ? aplicarDescuento : false,
        redirectUrl: window.location.href,
      });

      if (checkout.checkoutUrl) {
        window.location.href = checkout.checkoutUrl;
        return;
      }

      if (checkout.sandboxSimulable) {
        const sim = await portalSimulatePaymentApi(token, {
          referencia: checkout.referencia,
          montoEnCentavos: checkout.montoEnCentavos,
        });
        if (sim.ok) {
          setAviso(
            `Pago simulado aprobado (Ref. ${checkout.referencia}). Se asentó automáticamente el Recibo de Caja en la contabilidad del conjunto.`,
          );
          await cargarEstado(token);
        }
        return;
      }

      setAviso(
        `Referencia ${checkout.referencia} generada. Configura las llaves Wompi en Ajustes para habilitar PSE / Nequi en línea o paga usando la Llave Bre-B.`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el pago.');
    } finally {
      setProcesandoPago(false);
    }
  };

  const descargarCuentaCobro = () => {
    if (!stmt) return;
    const html = generarCuentaDeCobroHTML({
      razonSocial: stmt.razonSocial,
      nit: stmt.nit,
      ciudad: stmt.ciudad,
      direccion: stmt.direccion,
      periodoActual: stmt.periodoActual,
      unidadLabel: `${stmt.torre} ${stmt.numero}`,
      propietarioNombre: stmt.propietarioNombre,
      propietarioDocumento: stmt.propietarioDocumento,
      arrendatarioNombre: stmt.arrendatarioNombre,
      cuotaMensual: stmt.cuotaMensual,
      cargadoTotal: stmt.cargadoTotal,
      pagadoTotal: stmt.pagadoTotal,
      saldoActual: stmt.saldoActual,
      descuentoProntoPago: stmt.descuentoProntoPago,
      totalConDescuento: stmt.totalConDescuento,
      diaCorteProntoPago: stmt.diaCorteProntoPago,
      llaveBreB: stmt.llaveBreB,
      linkPago: window.location.href,
      movimientos: stmt.movimientos,
    });
    descargarArchivo(
      `cuenta-cobro-${stmt.companyId}-${stmt.torre}-${stmt.numero}-${stmt.periodoActual}.html`,
      html,
      'text/html;charset=utf-8',
    );
  };

  const descargarPazYSalvo = () => {
    if (!stmt || stmt.saldoActual > 0) return;
    const html = generarPazYSalvoHTML(
      {
        id: stmt.companyId,
        nit: stmt.nit,
        razonSocial: stmt.razonSocial,
        nombreCorto: stmt.nombreCorto,
        sigla: stmt.nombreCorto.slice(0, 2).toUpperCase(),
        ciudad: stmt.ciudad,
        direccion: stmt.direccion,
        grupoNiif: 3,
        fondoImprevistosPct: 1,
        tasaMoraMensual: stmt.tasaMoraMensual,
        diaCorteProntoPago: stmt.diaCorteProntoPago,
        descuentoProntoPagoPct: stmt.descuentoProntoPagoPct,
        llaveBreB: stmt.llaveBreB,
        presupuestoAnual: 0,
        periodoActual: stmt.periodoActual,
        saldosIniciales: {},
        escala: 1,
        color: '#0F766E',
      },
      {
        unidad: {
          id: stmt.unitId,
          empresaId: stmt.companyId,
          torre: stmt.torre,
          numero: stmt.numero,
          tipo: 'APARTAMENTO',
          area: 0,
          coeficiente: stmt.coeficiente,
          matricula: stmt.matricula,
          propietarioId: '',
          carteraCongelada: stmt.carteraCongelada,
        },
        propietario: {
          id: '',
          nombre: stmt.propietarioNombre,
          tipo: 'PROPIETARIO',
          documento: stmt.propietarioDocumento,
          email: stmt.propietarioEmail,
          telefono: '',
          ciudad: stmt.ciudad,
          retefuentePct: 0,
          reteicaPct: 0,
          reteivaPct: 0,
          noObligado: true,
        },
        arrendatario: undefined,
        coeficiente: stmt.coeficiente,
        cuota: stmt.cuotaMensual,
        cargado: stmt.cargadoTotal,
        pagado: stmt.pagadoTotal,
        saldo: stmt.saldoActual,
        mesesMora: 0,
        diasVencido: 0,
        periodoMasAntiguo: null,
        estado: 'AL_DIA',
      },
      stmt.periodoActual,
    );
    descargarArchivo(
      `paz-y-salvo-${stmt.companyId}-${stmt.torre}-${stmt.numero}.html`,
      html,
      'text/html;charset=utf-8',
    );
  };

  return (
    <div style={{ minHeight: '100dvh', background: '#F8F8F7', color: '#111113', padding: '20px 14px 48px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#FFFFFF',
            border: '1px solid #E4E4E7',
            borderRadius: 8,
            padding: '12px 16px',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo size={28} />
            <div>
              <strong style={{ display: 'block', fontSize: 15, letterSpacing: '-0.02em' }}>
                {stmt?.nombreCorto ?? companyInfo?.nombreCorto ?? 'Portal de Residentes y Pagos'}
              </strong>
              <span style={{ fontSize: 12, color: '#52525B' }}>
                {stmt
                  ? `NIT ${stmt.nit} · Ley 675 de 2001`
                  : companyInfo
                    ? `NIT ${companyInfo.nit} · ${companyInfo.ciudad}`
                    : 'Consulta tu estado de cuenta y paga en línea'}
              </span>
            </div>
          </div>
          {stmt && (
            <Badge tone={stmt.saldoActual <= 0 ? 'ok' : stmt.estadoCartera === 'EN_MORA' ? 'error' : 'warn'}>
              {stmt.saldoActual <= 0 ? 'Al día' : stmt.estadoCartera === 'EN_MORA' ? 'En mora' : 'Saldo pendiente'}
            </Badge>
          )}
        </header>

        {error && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #EF4444',
              color: '#991B1B',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13.5,
            }}
          >
            {error}
          </div>
        )}

        {aviso && (
          <div
            style={{
              background: '#F0FDFA',
              border: '1px solid #0F766E',
              color: '#115E59',
              borderRadius: 8,
              padding: '12px 14px',
              fontSize: 13.5,
            }}
          >
            {aviso}
          </div>
        )}

        {!token && companySlug && matchedUnits.length === 0 && (
          <section
            style={{
              background: '#FFFFFF',
              border: '1px solid #E4E4E7',
              borderRadius: 8,
              padding: 22,
              maxWidth: 480,
              width: '100%',
              margin: '12px auto',
            }}
          >
            <h2 style={{ margin: '0 0 6px', fontSize: 18, letterSpacing: '-0.02em' }}>
              Validación de usuario
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 13.5, color: '#52525B' }}>
              Ingresa tu número de cédula o NIT registrado para ver tus unidades, cuentas de cobro y pagar en línea.
            </p>
            <form onSubmit={(e) => void consultarPorDocumento(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label className="field">
                <span>Número de documento (Cédula o NIT)</span>
                <input
                  required
                  value={documentoInput}
                  onChange={(e) => setDocumentoInput(e.target.value)}
                  placeholder="Sin puntos ni guiones"
                  autoComplete="off"
                />
              </label>

              {mostrarFiltroUnidad && (
                <label className="field">
                  <span>Filtrar por unidad o apartamento (opcional)</span>
                  <input
                    value={unidadInput}
                    onChange={(e) => setUnidadInput(e.target.value)}
                    placeholder="Ej. Torre A 101 o 101"
                  />
                </label>
              )}

              <button
                type="button"
                onClick={() => setMostrarFiltroUnidad((v) => !v)}
                style={{
                  alignSelf: 'flex-start',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: '#0F766E',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {mostrarFiltroUnidad ? 'Ocultar filtro de apartamento' : 'Filtrar por apartamento específico'}
              </button>

              {companyInfo?.turnstileSiteKey && (
                <div ref={turnstileRef} style={{ minHeight: 65 }} />
              )}

              <Btn type="submit" variant="primary" disabled={buscando}>
                {buscando ? 'Verificando…' : 'Ingresar al portal'}
              </Btn>
            </form>
          </section>
        )}

        {!token && matchedUnits.length > 1 && (
          <section
            style={{
              background: '#FFFFFF',
              border: '1px solid #E4E4E7',
              borderRadius: 8,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 18, letterSpacing: '-0.02em' }}>
                  Selecciona el inmueble ({matchedUnits.length})
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: '#52525B' }}>
                  Encontramos {matchedUnits.length} unidades asociadas a tu documento.
                </p>
              </div>
              <Btn
                size="sm"
                variant="outline"
                onClick={() => {
                  setMatchedUnits([]);
                  setDocumentoInput('');
                  setUnidadInput('');
                }}
              >
                Consultar otro documento
              </Btn>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {matchedUnits.map((u) => (
                <div
                  key={u.unitId}
                  style={{
                    border: '1px solid #E4E4E7',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    background: '#F8F8F7',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>
                      {u.torre} {u.numero}
                    </strong>
                    <Badge tone={u.saldoActual <= 0 ? 'ok' : u.estadoCartera === 'EN_MORA' ? 'error' : 'warn'}>
                      {u.saldoActual <= 0 ? 'Al día' : u.estadoCartera === 'EN_MORA' ? 'En mora' : 'Pendiente'}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#52525B' }}>
                    {u.tipoUnidad} · Cuota {fmtMoney(u.cuotaMensual)}
                  </div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                    {fmtMoney(u.saldoActual)}
                  </div>
                  <Btn size="sm" variant="primary" onClick={() => seleccionarUnidad(u.token)}>
                    Ver cuenta y pagar
                  </Btn>
                </div>
              ))}
            </div>
          </section>
        )}

        {cargando && (
          <div style={{ background: '#FFFFFF', border: '1px solid #E4E4E7', borderRadius: 8, padding: 24, fontSize: 13.5, color: '#52525B' }}>
            Cargando estado de cuenta oficial…
          </div>
        )}

        {stmt && !cargando && (
          <>
            <section
              style={{
                background: '#FFFFFF',
                border: '1px solid #E4E4E7',
                borderRadius: 8,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Unidad {stmt.torre} {stmt.numero} · Coeficiente {fmtCoef(stmt.coeficiente)}
                  </div>
                  <h1 style={{ margin: '4px 0 2px', fontSize: 22, letterSpacing: '-0.02em' }}>
                    {stmt.propietarioNombre}
                  </h1>
                  <div style={{ fontSize: 13, color: '#52525B' }}>
                    Periodo actual: {fmtPeriodo(stmt.periodoActual)}
                    {stmt.arrendatarioNombre ? ` · Arrendatario: ${stmt.arrendatarioNombre}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {matchedUnits.length > 1 && (
                    <Btn size="sm" variant="ghost" onClick={volverASelector}>
                      Cambiar unidad ({matchedUnits.length})
                    </Btn>
                  )}
                  <Btn size="sm" variant="outline" icon="download" onClick={descargarCuentaCobro}>
                    Descargar Cuenta de Cobro
                  </Btn>
                  {stmt.saldoActual <= 0 && (
                    <Btn size="sm" variant="primary" icon="check" onClick={descargarPazYSalvo}>
                      Descargar Paz y Salvo
                    </Btn>
                  )}
                </div>
              </div>

              <div className="stat-grid">
                <div className="stat">
                  <div className="stat-head"><span>Saldo total a pagar</span></div>
                  <div className="stat-value mono">{fmtMoney(stmt.saldoActual)}</div>
                  <div className="stat-hint">
                    {stmt.saldoActual <= 0
                      ? 'Sin obligaciones pendientes'
                      : stmt.cuotaMensual > 0 && stmt.saldoActual > stmt.cuotaMensual
                        ? 'Incluye mes actual y saldos anteriores'
                        : 'Cuota ordinaria vigente'}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-head"><span>Cuota ordinaria mensual</span></div>
                  <div className="stat-value mono">{fmtMoney(stmt.cuotaMensual)}</div>
                  <div className="stat-hint">Presupuesto Ley 675</div>
                </div>
                <div className="stat">
                  <div className="stat-head"><span>Pronto pago (día {stmt.diaCorteProntoPago})</span></div>
                  <div className="stat-value mono">
                    {stmt.descuentoProntoPago > 0 ? fmtMoney(stmt.totalConDescuento) : 'No aplica'}
                  </div>
                  <div className="stat-hint">
                    {stmt.descuentoProntoPago > 0
                      ? `Ahorro ${fmtMoney(stmt.descuentoProntoPago)} (${stmt.descuentoProntoPagoPct}%)`
                      : `Descuento configurado: ${stmt.descuentoProntoPagoPct}%`}
                  </div>
                </div>
              </div>

              {stmt.saldoActual > 0 && (
                <div
                  style={{
                    border: '1px solid #E4E4E7',
                    borderRadius: 8,
                    padding: 16,
                    background: '#F8F8F7',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Btn
                      size="sm"
                      variant={montoMode === 'total' ? 'primary' : 'outline'}
                      onClick={() => setMontoMode('total')}
                    >
                      Pagar saldo total ({fmtMoney(aplicarDescuento && stmt.descuentoProntoPago > 0 ? stmt.totalConDescuento : stmt.saldoActual)})
                    </Btn>
                    <Btn
                      size="sm"
                      variant={montoMode === 'parcial' ? 'primary' : 'outline'}
                      onClick={() => {
                        setMontoMode('parcial');
                        if (!montoParcial) setMontoParcial(String(stmt.cuotaMensual || stmt.saldoActual));
                      }}
                    >
                      Pagar otro valor (abono)
                    </Btn>
                  </div>

                  {montoMode === 'parcial' && (
                    <label className="field" style={{ maxWidth: 260 }}>
                      <span>Valor a abonar (COP)</span>
                      <input
                        type="number"
                        min={1000}
                        max={stmt.saldoActual}
                        value={montoParcial}
                        onChange={(e) => setMontoParcial(e.target.value)}
                      />
                    </label>
                  )}

                  {stmt.descuentoProntoPago > 0 && montoMode === 'total' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={aplicarDescuento}
                        onChange={(e) => setAplicarDescuento(e.target.checked)}
                      />
                      <span>Aplicar descuento de pronto pago (-{fmtMoney(stmt.descuentoProntoPago)})</span>
                    </label>
                  )}

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Btn
                      variant="primary"
                      icon="card"
                      disabled={procesandoPago}
                      onClick={() => void iniciarPago()}
                    >
                      {procesandoPago
                        ? 'Preparando pago…'
                        : stmt.wompiConfigurado && stmt.wompiPublicKey
                          ? 'Pagar en línea (PSE / Nequi / Tarjeta)'
                          : 'Simular pago en línea (modo pruebas)'}
                    </Btn>
                    {stmt.llaveBreB && (
                      <span style={{ fontSize: 13, color: '#52525B' }}>
                        O transfiere con <strong>Llave Bre-B:</strong>{' '}
                        <code className="mono">{stmt.llaveBreB}</code>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section
              style={{
                background: '#FFFFFF',
                border: '1px solid #E4E4E7',
                borderRadius: 8,
                padding: 18,
              }}
            >
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Detalle de cobros y pagos de la unidad</h3>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Comprobante</th>
                      <th>Concepto</th>
                      <th className="num">Cobro</th>
                      <th className="num">Pago / Abono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stmt.movimientos.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ color: '#52525B' }}>
                          Aún no hay movimientos registrados para esta unidad.
                        </td>
                      </tr>
                    ) : (
                      stmt.movimientos.map((m, i) => (
                        <tr key={i}>
                          <td className="mono">{fmtFecha(m.fecha)}</td>
                          <td className="mono">{m.comprobante}</td>
                          <td>{m.descripcion}</td>
                          <td className="num mono">{m.cargo > 0 ? fmtMoney(m.cargo) : '—'}</td>
                          <td className="num mono" style={{ color: m.abono > 0 ? '#0F766E' : undefined }}>
                            {m.abono > 0 ? fmtMoney(m.abono) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
