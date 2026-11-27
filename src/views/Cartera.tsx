import { useMemo, useState } from 'react';
import {
  apiEnabled,
  fetchPortalDispatchesApi,
  fetchPortalLinksApi,
  sendPortalEmailsApi,
  type PortalEmailDispatchItem,
  type PortalUnitLinkItem,
  type SendPortalEmailsResult,
} from '../api';
import { cartera } from '../domain/engine';
import { cuotaMensual } from '../domain/seed';
import { descargarArchivo, generarCuentaDeCobroHTML, generarPazYSalvoHTML } from '../domain/reports';
import { fmtCoef, fmtMoney, fmtPeriodo, hoyISO } from '../domain/format';
import { acciones, DATOS, esPeriodoBloqueado, tienePermiso, useAuth } from '../store';
import type { VistaProps } from '../ui-types';
import { Badge, Btn, Chip, Empty, Modal, Stat, Toggle, ViewHeader } from '../components/ui';

const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function Cartera(props: VistaProps) {
  const { empresa, estado, filtros, setFiltros, modo, toast } = props;
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [modalCausar, setModalCausar] = useState(false);
  const [incluirMora, setIncluirMora] = useState(true);
  const [causando, setCausando] = useState(false);

  const bloqueado = esPeriodoBloqueado(estado, estado.periodo);
  const puedeCausar = tienePermiso(auth.user.rol, 'maestros');
  const puedeContabilizar = tienePermiso(auth.user.rol, 'contabilidad');

  // Registro rápido de Recibo de Caja (RC)
  const [rcFila, setRcFila] = useState<(typeof filas)[number] | null>(null);
  const [rcValor, setRcValor] = useState('');
  const [rcDescuento, setRcDescuento] = useState('0');
  const [rcBanco, setRcBanco] = useState('111005');
  const [rcFecha, setRcFecha] = useState(hoyISO());
  const [rcRef, setRcRef] = useState('');
  const [rcGuardando, setRcGuardando] = useState(false);

  // Links personalizados / WhatsApp / Cuenta de cobro / Envío masivo
  const [linksCache, setLinksCache] = useState<Record<string, PortalUnitLinkItem>>({});
  const [cobroModalFila, setCobroModalFila] = useState<(typeof filas)[number] | null>(null);
  const [cobroLinkUrl, setCobroLinkUrl] = useState('');
  const [cargandoLink, setCargandoLink] = useState(false);
  const [exportandoLinks, setExportandoLinks] = useState(false);
  const [modalEnvioMasivo, setModalEnvioMasivo] = useState(false);
  const [soloConSaldoMasivo, setSoloConSaldoMasivo] = useState(true);
  const [enviandoMasivo, setEnviandoMasivo] = useState(false);
  const [resultadoMasivo, setResultadoMasivo] = useState<SendPortalEmailsResult | null>(null);
  const [historialEnvios, setHistorialEnvios] = useState<PortalEmailDispatchItem[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const filas = useMemo(
    () => cartera(estado.comprobantes, empresa, DATOS.units.filter((u) => u.empresaId === empresa.id), DATOS.terceros, estado.periodo),
    [estado.comprobantes, empresa, estado.periodo],
  );

  const filtradas = useMemo(() => {
    let out = filas;
    if (filtros.unidadId) out = out.filter((f) => f.unidad.id === filtros.unidadId);
    const needle = norm(q.trim());
    if (needle) {
      out = out.filter((f) =>
        norm(
          `${f.unidad.torre} ${f.unidad.numero} ${f.propietario?.nombre ?? ''} ${f.arrendatario?.nombre ?? ''} ${f.unidad.matricula}`,
        ).includes(needle),
      );
    }
    return out;
  }, [filas, filtros.unidadId, q]);

  const totales = useMemo(() => {
    const saldo = filtradas.reduce((s, f) => s + f.saldo, 0);
    const vencida = filtradas.filter((f) => f.estado === 'EN_MORA').reduce((s, f) => s + f.saldo, 0);
    const alDia = filtradas.filter((f) => f.estado === 'AL_DIA').length;
    const congeladas = filtradas.filter((f) => f.estado === 'CONGELADA').length;
    const mora = filtradas.filter((f) => f.estado === 'EN_MORA').length;
    return { saldo, vencida, alDia, congeladas, mora };
  }, [filtradas]);

  const antiguedad = useMemo(() => {
    const buckets = [
      { key: '1-30', label: '1 a 30 días', min: 1, max: 30, total: 0, n: 0 },
      { key: '31-60', label: '31 a 60 días', min: 31, max: 60, total: 0, n: 0 },
      { key: '61-90', label: '61 a 90 días', min: 61, max: 90, total: 0, n: 0 },
      { key: '90+', label: 'Más de 90 días', min: 91, max: 9999, total: 0, n: 0 },
    ];
    for (const f of filtradas) {
      if (f.saldo <= 0) continue;
      const b = buckets.find((x) => f.diasVencido >= x.min && f.diasVencido <= x.max);
      if (b) {
        b.total += f.saldo;
        b.n += 1;
      }
    }
    return buckets;
  }, [filtradas]);

  const exportar = () => {
    const encabezado = ['Unidad', 'Coeficiente', 'Propietario', 'Arrendatario', 'Cuota', 'Cargado', 'Pagado', 'Saldo', 'Días vencido', 'Estado'];
    const lineas = filtradas.map((f) => [
      `${f.unidad.torre} ${f.unidad.numero}`,
      f.coeficiente,
      f.propietario?.nombre ?? '',
      f.arrendatario?.nombre ?? '',
      cuotaMensual(empresa, f.unidad),
      f.cargado,
      f.pagado,
      f.saldo,
      f.diasVencido,
      f.estado,
    ]);
    const csv = [encabezado, ...lineas]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    descargarArchivo(`cartera-${empresa.id}-${estado.periodo}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
    toast({ tone: 'ok', title: 'Cartera exportada', msg: `${filtradas.length} unidades` });
  };

  const descargarPazYSalvo = (f: (typeof filas)[number]) => {
    const html = generarPazYSalvoHTML(empresa, f, estado.periodo);
    descargarArchivo(
      `paz-y-salvo-${empresa.id}-${f.unidad.torre.replace(/\s+/g, '')}-${f.unidad.numero}.html`,
      html,
      'text/html;charset=utf-8',
    );
    toast({
      tone: 'ok',
      title: 'Paz y salvo generado',
      msg: `${f.unidad.torre} ${f.unidad.numero} · Ley 675`,
    });
  };

  const ejecutarCausacion = async () => {
    setCausando(true);
    try {
      const res = await acciones.causarExpensasMes(estado.periodo, incluirMora);
      if (res.ok) {
        toast({ tone: 'ok', title: 'Expensas causadas', msg: res.detalle });
        setModalCausar(false);
      } else {
        toast({ tone: 'error', title: 'No se pudo causar', msg: res.error });
      }
    } finally {
      setCausando(false);
    }
  };

  const copiarEnlacePortalGeneral = () => {
    const url = `${window.location.origin}/portal/${encodeURIComponent(empresa.id)}`;
    void navigator.clipboard?.writeText(url);
    toast({ tone: 'ok', title: 'Enlace del portal copiado', msg: url });
  };

  const exportarLinksCsv = async () => {
    if (!apiEnabled) {
      toast({ tone: 'error', title: 'Requiere conexión API', msg: 'Conecta el servidor para firmar los enlaces de pago.' });
      return;
    }
    setExportandoLinks(true);
    try {
      const links = await fetchPortalLinksApi(empresa.id);
      const nextMap: Record<string, PortalUnitLinkItem> = {};
      for (const item of links) nextMap[item.unitId] = item;
      setLinksCache(nextMap);

      const generalUrl = `${window.location.origin}/portal/${encodeURIComponent(empresa.id)}`;
      const rows = filtradas.map((f) => {
        const linkItem = nextMap[f.unidad.id];
        const payUrl = linkItem
          ? `${window.location.origin}/pagar/${encodeURIComponent(linkItem.token)}`
          : generalUrl;
        const dest = f.arrendatario ?? f.propietario;
        return [
          f.unidad.torre,
          f.unidad.numero,
          dest?.nombre ?? f.propietario?.nombre ?? '',
          dest?.documento ?? f.propietario?.documento ?? '',
          dest?.email ?? f.propietario?.email ?? '',
          dest?.telefono ?? f.propietario?.telefono ?? '',
          cuotaMensual(empresa, f.unidad),
          f.saldo,
          f.estado,
          payUrl,
          generalUrl,
        ];
      });
      const header = [
        'Torre',
        'Unidad',
        'Propietario / Pagador',
        'Documento',
        'Correo',
        'Teléfono',
        'Cuota',
        'Saldo pendiente',
        'Estado',
        'Link personalizado',
        'Portal del conjunto',
      ];
      const csv = [header, ...rows]
        .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      descargarArchivo(`links-pago-${empresa.id}-${estado.periodo}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
      toast({ tone: 'ok', title: 'Links exportados', msg: `${rows.length} unidades con enlace listo para campaña` });
    } catch (e: unknown) {
      toast({ tone: 'error', title: 'No se pudieron exportar los links', msg: e instanceof Error ? e.message : 'Error de red' });
    } finally {
      setExportandoLinks(false);
    }
  };

  const abrirEnvioMasivo = async () => {
    setModalEnvioMasivo(true);
    setResultadoMasivo(null);
    if (!apiEnabled) return;
    setCargandoHistorial(true);
    try {
      const items = await fetchPortalDispatchesApi(empresa.id, estado.periodo);
      setHistorialEnvios(items);
    } catch {
      setHistorialEnvios([]);
    } finally {
      setCargandoHistorial(false);
    }
  };

  const ejecutarEnvioMasivo = async (dryRun: boolean) => {
    if (!apiEnabled) {
      toast({ tone: 'error', title: 'Requiere conexión API', msg: 'Conecta el servidor para enviar correos masivos.' });
      return;
    }
    setEnviandoMasivo(true);
    try {
      const res = await sendPortalEmailsApi(empresa.id, {
        periodo: estado.periodo,
        soloConSaldo: soloConSaldoMasivo,
        portalBaseUrl: window.location.origin,
        dryRun,
      });
      setResultadoMasivo(res);
      if (!dryRun) {
        const items = await fetchPortalDispatchesApi(empresa.id, estado.periodo);
        setHistorialEnvios(items);
      }
      toast({
        tone: res.errores > 0 && res.enviados === 0 ? 'error' : 'ok',
        title: dryRun
          ? 'Vista previa lista'
          : res.modo === 'RESEND'
            ? 'Envío masivo ejecutado'
            : 'Simulación completada',
        msg: `${res.enviados} enviados · ${res.simulados} simulados · ${res.omitidosSinCorreo} sin correo`,
      });
    } catch (e: unknown) {
      toast({ tone: 'error', title: 'No se pudo ejecutar el envío', msg: e instanceof Error ? e.message : 'Error' });
    } finally {
      setEnviandoMasivo(false);
    }
  };

  const abrirModalRc = (f: (typeof filas)[number]) => {
    setRcFila(f);
    setRcValor(String(Math.max(0, Math.round(f.saldo))));
    setRcDescuento('0');
    setRcBanco('111005');
    setRcFecha(hoyISO());
    setRcRef(`BREB-${f.unidad.torre}-${f.unidad.numero}`);
  };

  const registrarPagoRc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rcFila) return;
    const valor = Math.round(Number(rcValor) || 0);
    const descuento = Math.max(0, Math.round(Number(rcDescuento) || 0));
    if (valor <= 0) {
      toast({ tone: 'error', title: 'Valor inválido', msg: 'El pago debe ser mayor a $ 0.' });
      return;
    }
    const pagadorId = rcFila.arrendatario?.id || rcFila.propietario?.id;
    const unidadLabel = `${rcFila.unidad.torre} ${rcFila.unidad.numero}`;
    const lineas = [
      {
        id: 'l-1',
        cuenta: rcBanco,
        descripcion: `Recaudo expensas ${unidadLabel}${rcRef.trim() ? ` · ${rcRef.trim()}` : ''}`,
        debito: valor,
        credito: 0,
        terceroId: pagadorId,
        unidadId: rcFila.unidad.id,
      },
      ...(descuento > 0
        ? [
            {
              id: 'l-2',
              cuenta: '417035',
              descripcion: `Descuento pronto pago ${unidadLabel}`,
              debito: descuento,
              credito: 0,
              terceroId: pagadorId,
              unidadId: rcFila.unidad.id,
            },
          ]
        : []),
      {
        id: descuento > 0 ? 'l-3' : 'l-2',
        cuenta: '130505',
        descripcion: `Abono cartera unidad ${unidadLabel}`,
        debito: 0,
        credito: valor + descuento,
        terceroId: pagadorId,
        unidadId: rcFila.unidad.id,
      },
    ];

    setRcGuardando(true);
    try {
      const res = await acciones.crearComprobanteManual({
        companyId: empresa.id,
        period: estado.periodo,
        entryType: 'RC',
        date: rcFecha || hoyISO(),
        description: `Recaudo expensas ${unidadLabel}`,
        reference: rcRef.trim() || undefined,
        origin: 'CONTADOR_MANUAL',
        lines: lineas,
      });
      if (res.ok) {
        toast({ tone: 'ok', title: 'Recibo de Caja asentado', msg: `${res.detalle} · ${fmtMoney(valor)}` });
        setRcFila(null);
      } else {
        toast({ tone: 'error', title: 'No se pudo registrar pago', msg: res.error });
      }
    } finally {
      setRcGuardando(false);
    }
  };

  const abrirModalCobro = async (f: (typeof filas)[number]) => {
    setCobroModalFila(f);
    setCobroLinkUrl(`${window.location.origin}/portal/${encodeURIComponent(empresa.id)}`);
    if (!apiEnabled) return;
    if (linksCache[f.unidad.id]) {
      setCobroLinkUrl(`${window.location.origin}/pagar/${encodeURIComponent(linksCache[f.unidad.id].token)}`);
      return;
    }
    setCargandoLink(true);
    try {
      const links = await fetchPortalLinksApi(empresa.id);
      const nextMap: Record<string, PortalUnitLinkItem> = {};
      for (const item of links) nextMap[item.unitId] = item;
      setLinksCache(nextMap);
      const match = nextMap[f.unidad.id];
      if (match) {
        setCobroLinkUrl(`${window.location.origin}/pagar/${encodeURIComponent(match.token)}`);
      }
    } catch {
      // Mantiene link general del portal si falla carga individual
    } finally {
      setCargandoLink(false);
    }
  };

  const descargarCuentaCobroUnidad = (f: (typeof filas)[number], link?: string) => {
    const movs = estado.comprobantes
      .filter((c) => c.estado !== 'ANULADO' && c.empresaId === empresa.id)
      .flatMap((c) => {
        let cargo = 0;
        let abono = 0;
        for (const l of c.lineas) {
          if (l.unidadId === f.unidad.id && ['130505', '130510', '130515', '130520'].includes(l.cuenta)) {
            cargo += l.debito;
            abono += l.credito;
          }
        }
        return cargo > 0 || abono > 0
          ? [{ fecha: c.fecha, comprobante: `${c.tipo}-${c.consecutivo}`, descripcion: c.descripcion, cargo, abono }]
          : [];
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    const cuota = cuotaMensual(empresa, f.unidad);
    const desc =
      f.saldo > 0 && empresa.descuentoProntoPagoPct > 0
        ? Math.round((Math.min(cuota, f.saldo) * empresa.descuentoProntoPagoPct) / 100)
        : 0;

    const html = generarCuentaDeCobroHTML({
      razonSocial: empresa.razonSocial,
      nit: empresa.nit,
      ciudad: empresa.ciudad,
      direccion: empresa.direccion,
      periodoActual: estado.periodo,
      unidadLabel: `${f.unidad.torre} ${f.unidad.numero}`,
      propietarioNombre: f.propietario?.nombre ?? 'Propietario',
      propietarioDocumento: f.propietario?.documento ?? '',
      arrendatarioNombre: f.arrendatario?.nombre ?? null,
      cuotaMensual: cuota,
      cargadoTotal: f.cargado,
      pagadoTotal: f.pagado,
      saldoActual: f.saldo,
      descuentoProntoPago: desc,
      totalConDescuento: Math.max(0, f.saldo - desc),
      diaCorteProntoPago: empresa.diaCorteProntoPago,
      llaveBreB: empresa.llaveBreB,
      linkPago: link,
      movimientos: movs,
    });
    descargarArchivo(
      `cuenta-cobro-${empresa.id}-${f.unidad.torre}-${f.unidad.numero}-${estado.periodo}.html`,
      html,
      'text/html;charset=utf-8',
    );
  };

  return (
    <div className="vista">
      <ViewHeader
        icon="wallet"
        title="Cartera y paz y salvo"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)}`}
        actions={
          <>
            <Badge tone={modo === 0 ? 'info' : 'neutral'}>{modo === 0 ? 'Vista: unidades' : 'Vista: antigüedad'}</Badge>
            <Btn
              size="sm"
              variant="primary"
              icon="spark"
              onClick={() => setModalCausar(true)}
              disabled={bloqueado || !puedeCausar}
              title={
                !puedeCausar
                  ? 'Requiere rol Contador o Administrador'
                  : bloqueado
                    ? 'Periodo cerrado o sin abrir'
                    : 'Liquidar expensas ordinarias del mes'
              }
            >
              Causar expensas del mes
            </Btn>
            <Btn size="sm" variant="outline" icon="nfc" onClick={copiarEnlacePortalGeneral}>
              Portal residentes
            </Btn>
            <Btn
              size="sm"
              variant="outline"
              icon="download"
              onClick={() => void exportarLinksCsv()}
              disabled={filtradas.length === 0 || exportandoLinks}
            >
              {exportandoLinks ? 'Exportando…' : 'Exportar links (CSV)'}
            </Btn>
            {puedeCausar && (
              <Btn size="sm" variant="outline" icon="arrowRight" onClick={() => void abrirEnvioMasivo()} disabled={filas.length === 0}>
                Envío masivo (Email)
              </Btn>
            )}
            <Btn size="sm" icon="download" onClick={exportar} disabled={filtradas.length === 0}>
              Exportar CSV
            </Btn>
          </>
        }
      />

      <div className="stat-grid">
        <Stat label="Cartera total" value={fmtMoney(totales.saldo)} tone={totales.saldo > 0 ? 'warn' : 'ok'} icon="wallet" />
        <Stat label="Cartera vencida" value={fmtMoney(totales.vencida)} tone={totales.vencida > 0 ? 'error' : 'neutral'} icon="alert" />
        <Stat label="Unidades al día" value={totales.alDia} tone="ok" icon="check" />
        <Stat label="Unidades en mora" value={totales.mora} tone={totales.mora > 0 ? 'warn' : 'neutral'} icon="clock" />
      </div>

      <div className="toolbar">
        <div className="search">
          <input value={q} placeholder="Buscar por unidad, propietario o matrícula…" onChange={(e) => setQ(e.target.value)} />
        </div>
        {filtros.unidadId && (
          <Chip
            label={`Unidad ${filtros.unidadId}`}
            onClear={() => setFiltros({ unidadId: undefined })}
          />
        )}
      </div>

      {filtradas.length === 0 ? (
        <Empty icon="wallet" title="Sin cartera" text="Todas las unidades están al día o no hay resultados para el filtro." />
      ) : modo === 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Unidad</th>
                <th className="num">Coef.</th>
                <th>Propietario</th>
                <th>Arrendatario</th>
                <th className="num">Cuota</th>
                <th className="num">Cargado</th>
                <th className="num">Pagado</th>
                <th className="num">Saldo</th>
                <th>Antigüedad</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((f) => (
                <tr key={f.unidad.id}>
                  <td>
                    <strong>
                      {f.unidad.torre} {f.unidad.numero}
                    </strong>
                    <span className="unidad-matricula mono">{f.unidad.matricula}</span>
                  </td>
                  <td className="num">{fmtCoef(f.coeficiente)}</td>
                  <td className="celda-tercero">
                    <span>{f.propietario?.nombre}</span>
                    <small>{f.propietario?.documento}</small>
                  </td>
                  <td className="celda-tercero">
                    {f.arrendatario ? (
                      <>
                        <span>{f.arrendatario.nombre}</span>
                        <small>{f.arrendatario.documento}</small>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">{fmtMoney(cuotaMensual(empresa, f.unidad))}</td>
                  <td className="num">{fmtMoney(f.cargado)}</td>
                  <td className="num">{fmtMoney(f.pagado)}</td>
                  <td className={`num ${f.saldo > 0 ? 'text-warn' : 'text-ok'}`}>{fmtMoney(f.saldo)}</td>
                  <td>{f.diasVencido > 0 ? `${f.diasVencido} días` : '—'}</td>
                  <td>
                    {f.estado === 'AL_DIA' && <Badge tone="ok">Paz y salvo</Badge>}
                    {f.estado === 'EN_MORA' && <Badge tone="error">En mora</Badge>}
                    {f.estado === 'POR_VENCER' && <Badge tone="warn">Por vencer</Badge>}
                    {f.estado === 'CONGELADA' && <Badge tone="info">Congelada</Badge>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Btn size="xs" variant="outline" onClick={() => void abrirModalCobro(f)}>
                        Cobro / Link
                      </Btn>
                      {f.saldo > 0 && puedeContabilizar && !bloqueado && (
                        <Btn size="xs" variant="primary" onClick={() => abrirModalRc(f)}>
                          Pagar (RC)
                        </Btn>
                      )}
                      {f.estado === 'AL_DIA' && (
                        <Btn size="xs" icon="download" onClick={() => descargarPazYSalvo(f)}>
                          Paz y salvo
                        </Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rango de antigüedad</th>
                <th className="num">Unidades</th>
                <th className="num">Saldo</th>
                <th className="w-48">Participación</th>
              </tr>
            </thead>
            <tbody>
              {antiguedad.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td className="num">{b.n}</td>
                  <td className="num">{fmtMoney(b.total)}</td>
                  <td>
                    <div className="progress-cell">
                      <div className="progress">
                        <div
                          className={`progress-bar ${b.key === '90+' ? 'progress-error' : b.key === '61-90' ? 'progress-warn' : 'progress-ok'}`}
                          style={{ width: `${totales.saldo > 0 ? (b.total / totales.saldo) * 100 : 0}%` }}
                        />
                      </div>
                      <small>{totales.saldo > 0 ? `${((b.total / totales.saldo) * 100).toFixed(1)}%` : '0%'}</small>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalCausar}
        onClose={() => setModalCausar(false)}
        title="Causación masiva de expensas"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)}`}
        width={520}
      >
        <p className="card-note" style={{ marginTop: 0 }}>
          Se liquidará el presupuesto mensual ({fmtMoney(empresa.presupuestoAnual / 12)}) distribuido por
          coeficiente entre {filas.length} unidades, apropiando {empresa.fondoImprevistosPct}% al fondo de imprevistos
          (cuenta <span className="mono">281510</span>).
        </p>
        <div className="checklist" style={{ marginBottom: 14 }}>
          <div className="check-item">
            <Toggle checked={incluirMora} onChange={setIncluirMora} />
            <div>
              <strong>Liquidar intereses de mora ({empresa.tasaMoraMensual}% mensual)</strong>
              <small>Aplica a unidades con saldo vencido anterior cuya cartera no esté congelada.</small>
            </div>
          </div>
        </div>
        <div className="cierre-acciones" style={{ justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={() => setModalCausar(false)}>
            Cancelar
          </Btn>
          <Btn variant="primary" icon="check" onClick={() => void ejecutarCausacion()} disabled={causando}>
            {causando ? 'Causando…' : 'Confirmar causación (CC)'}
          </Btn>
        </div>
      </Modal>

      <Modal
        open={Boolean(rcFila)}
        onClose={() => setRcFila(null)}
        title="Registrar pago de residente (RC)"
        subtitle={rcFila ? `${rcFila.unidad.torre} ${rcFila.unidad.numero} · Saldo ${fmtMoney(rcFila.saldo)}` : ''}
        width={480}
      >
        {rcFila && (
          <form onSubmit={(e) => void registrarPagoRc(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <label className="field">
                <span>Valor recibido (COP)</span>
                <input
                  type="number"
                  min={1}
                  required
                  value={rcValor}
                  onChange={(e) => setRcValor(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Descuento pronto pago</span>
                <input
                  type="number"
                  min={0}
                  value={rcDescuento}
                  onChange={(e) => setRcDescuento(e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <label className="field">
                <span>Cuenta destino</span>
                <select value={rcBanco} onChange={(e) => setRcBanco(e.target.value)}>
                  <option value="111005">111005 · Bancos cuenta recaudadora</option>
                  <option value="110505">110505 · Caja general</option>
                </select>
              </label>
              <label className="field">
                <span>Fecha</span>
                <input type="date" required value={rcFecha} onChange={(e) => setRcFecha(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Referencia bancaria / Bre-B</span>
              <input value={rcRef} onChange={(e) => setRcRef(e.target.value)} placeholder="Transferencia / consignación" />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn type="button" variant="ghost" onClick={() => setRcFila(null)}>
                Cancelar
              </Btn>
              <Btn type="submit" variant="primary" disabled={rcGuardando}>
                {rcGuardando ? 'Asentando…' : 'Asentar Recibo de Caja (RC)'}
              </Btn>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(cobroModalFila)}
        onClose={() => setCobroModalFila(null)}
        title="Cobro y Link de Pago Personalizado"
        subtitle={
          cobroModalFila
            ? `${cobroModalFila.unidad.torre} ${cobroModalFila.unidad.numero} · ${cobroModalFila.propietario?.nombre ?? ''}`
            : ''
        }
        width={540}
      >
        {cobroModalFila && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg)' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Saldo pendiente</div>
              <strong className="mono" style={{ fontSize: 18 }}>{fmtMoney(cobroModalFila.saldo)}</strong>
            </div>

            <label className="field">
              <span>Enlace personalizado del apartamento {cargandoLink ? '(generando…)' : ''}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={cobroLinkUrl} className="mono" style={{ flex: 1, fontSize: 12 }} />
                <Btn
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(cobroLinkUrl);
                    toast({ tone: 'ok', title: 'Link copiado' });
                  }}
                >
                  Copiar
                </Btn>
              </div>
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn
                type="button"
                size="sm"
                variant="primary"
                onClick={() => {
                  const dest = cobroModalFila.arrendatario ?? cobroModalFila.propietario;
                  const tel = (dest?.telefono ?? '').replace(/[^0-9]/g, '');
                  const phone = tel.length === 10 ? `57${tel}` : tel;
                  const msg = encodeURIComponent(
                    `Hola ${dest?.nombre ?? ''}, te compartimos tu Cuenta de Cobro de ${empresa.nombreCorto} (Unidad ${cobroModalFila.unidad.torre} ${cobroModalFila.unidad.numero}). Saldo actual: ${fmtMoney(cobroModalFila.saldo)}. Consulta y paga en línea aquí: ${cobroLinkUrl}`,
                  );
                  const waUrl = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
                  window.open(waUrl, '_blank', 'noopener');
                }}
              >
                Enviar por WhatsApp
              </Btn>
              <Btn
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const dest = cobroModalFila.arrendatario ?? cobroModalFila.propietario;
                  const subject = encodeURIComponent(
                    `Cuenta de Cobro ${empresa.nombreCorto} · ${cobroModalFila.unidad.torre} ${cobroModalFila.unidad.numero} (${fmtPeriodo(estado.periodo)})`,
                  );
                  const body = encodeURIComponent(
                    `Cordial saludo ${dest?.nombre ?? ''},\n\nAdjunto enlace personalizado para consultar tu Cuenta de Cobro de ${empresa.nombreCorto} (Unidad ${cobroModalFila.unidad.torre} ${cobroModalFila.unidad.numero}), descargar el estado de cuenta y pagar en línea:\n\nSaldo actual: ${fmtMoney(cobroModalFila.saldo)}\nEnlace de pago: ${cobroLinkUrl}\n${empresa.llaveBreB ? `Llave Bre-B: ${empresa.llaveBreB}\n` : ''}\nAdministración ${empresa.nombreCorto}`,
                  );
                  window.location.href = `mailto:${dest?.email ?? ''}?subject=${subject}&body=${body}`;
                }}
              >
                Enviar por correo
              </Btn>
              <Btn
                type="button"
                size="sm"
                variant="outline"
                icon="download"
                onClick={() => descargarCuentaCobroUnidad(cobroModalFila, cobroLinkUrl)}
              >
                Cuenta de cobro PDF
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={modalEnvioMasivo}
        onClose={() => {
          if (!enviandoMasivo) setModalEnvioMasivo(false);
        }}
        title="Envío masivo de cuentas de cobro por correo"
        subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(estado.periodo)}`}
        width={640}
      >
        {(() => {
          const objetivo = soloConSaldoMasivo ? filas.filter((f) => f.saldo > 0) : filas;
          const conCorreo = objetivo.filter((f) => ((f.arrendatario ?? f.propietario)?.email ?? '').includes('@')).length;
          const sinCorreo = objetivo.length - conCorreo;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="stat-grid">
                <div className="stat">
                  <div className="stat-head"><span>Unidades objetivo</span></div>
                  <div className="stat-value mono">{objetivo.length}</div>
                </div>
                <div className="stat">
                  <div className="stat-head"><span>Con correo válido</span></div>
                  <div className="stat-value mono">{conCorreo}</div>
                </div>
                <div className="stat">
                  <div className="stat-head"><span>Sin correo (se omiten)</span></div>
                  <div className="stat-value mono">{sinCorreo}</div>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                <span>Enviar solo a unidades con saldo pendiente (&gt; $ 0)</span>
                <Toggle checked={soloConSaldoMasivo} onChange={setSoloConSaldoMasivo} />
              </label>

              {resultadoMasivo && (
                <div
                  style={{
                    border: '1px solid #E4E4E7',
                    borderRadius: 8,
                    padding: 12,
                    background: '#F8F8F7',
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <strong>Resultado ({resultadoMasivo.modo})</strong>
                    <Badge tone={resultadoMasivo.modo === 'RESEND' ? 'ok' : 'info'}>
                      {resultadoMasivo.modo === 'RESEND' ? 'Enviado vía Resend' : 'Modo Simulado'}
                    </Badge>
                  </div>
                  <div>
                    Enviados: <strong className="mono">{resultadoMasivo.enviados}</strong> · Simulados:{' '}
                    <strong className="mono">{resultadoMasivo.simulados}</strong> · Sin correo:{' '}
                    <strong className="mono">{resultadoMasivo.omitidosSinCorreo}</strong> · Errores:{' '}
                    <strong className="mono">{resultadoMasivo.errores}</strong>
                  </div>
                  {resultadoMasivo.modo === 'SIMULADO' && (
                    <div style={{ marginTop: 6, color: '#52525B', fontSize: 12 }}>
                      Para entregar correos reales en producción, configura <code>RESEND_API_KEY</code> y{' '}
                      <code>RESEND_FROM_EMAIL</code> en el backend de Render.
                    </div>
                  )}
                </div>
              )}

              <div>
                <strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
                  Historial reciente de envíos ({fmtPeriodo(estado.periodo)})
                </strong>
                {cargandoHistorial ? (
                  <div style={{ fontSize: 12.5, color: '#52525B' }}>Cargando trazabilidad…</div>
                ) : historialEnvios.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: '#52525B' }}>
                    Aún no hay envíos registrados para este periodo.
                  </div>
                ) : (
                  <div className="table-scroll" style={{ maxHeight: 210 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Unidad</th>
                          <th>Correo</th>
                          <th>Estado</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historialEnvios.slice(0, 40).map((d) => (
                          <tr key={d.id}>
                            <td className="mono">{d.torre} {d.numero}</td>
                            <td style={{ fontSize: 12 }}>{d.emailDestino || '—'}</td>
                            <td>
                              <Badge tone={d.estado === 'ENVIADO' ? 'ok' : d.estado === 'ERROR' ? 'error' : 'info'}>
                                {d.estado}
                              </Badge>
                            </td>
                            <td style={{ fontSize: 12, color: '#52525B' }}>{d.detalleError ?? 'OK'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <Btn variant="ghost" onClick={() => setModalEnvioMasivo(false)} disabled={enviandoMasivo}>
                  Cerrar
                </Btn>
                <Btn variant="outline" onClick={() => void ejecutarEnvioMasivo(true)} disabled={enviandoMasivo}>
                  {enviandoMasivo ? 'Procesando…' : 'Simular / Vista previa'}
                </Btn>
                <Btn variant="primary" icon="arrowRight" onClick={() => void ejecutarEnvioMasivo(false)} disabled={enviandoMasivo}>
                  {enviandoMasivo ? 'Enviando…' : 'Enviar cobros por correo'}
                </Btn>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
