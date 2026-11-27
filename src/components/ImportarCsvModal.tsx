import { useMemo, useState } from 'react';
import {
  descargarPlantillaCsv,
  parsePucCsv,
  parseSaldosInicialesCsv,
  parseTercerosCsv,
  parseUnidadesCsv,
  PLANTILLA_PUC_CSV,
  PLANTILLA_SALDOS_CSV,
  PLANTILLA_TERCEROS_CSV,
  PLANTILLA_UNIDADES_CSV,
  type CsvImportKind,
} from '../domain/csvImport';
import { CUENTAS } from '../domain/puc';
import { fmtMoney } from '../domain/format';
import { apiEnabled } from '../api';
import { acciones, DATOS, tercerosDe, unidadesDe } from '../store';
import type { Copropiedad, EstadoApp } from '../domain/types';
import type { ToastData } from '../ui-types';
import { Badge, Btn, Modal } from './ui';

const CONFIG: Record<
  CsvImportKind,
  { title: string; subtitle: string; filename: string; plantilla: string }
> = {
  unidades: {
    title: 'Importar unidades y propietarios (Excel / CSV)',
    subtitle: 'Carga apartamentos, coeficientes y crea automáticamente los propietarios faltantes',
    filename: 'plantilla-unidades-vertika.csv',
    plantilla: PLANTILLA_UNIDADES_CSV,
  },
  terceros: {
    title: 'Importar terceros y proveedores (Excel / CSV)',
    subtitle: 'Carga masiva de proveedores, propietarios o empleados sin duplicar documentos',
    filename: 'plantilla-terceros-vertika.csv',
    plantilla: PLANTILLA_TERCEROS_CSV,
  },
  saldos: {
    title: 'Importar saldos iniciales / Balance de apertura (CSV)',
    subtitle: 'Crea el comprobante contable CC de apertura validando partida doble al peso exacto',
    filename: 'plantilla-saldos-iniciales-vertika.csv',
    plantilla: PLANTILLA_SALDOS_CSV,
  },
  puc: {
    title: 'Importar catálogo PUC propio (Excel / CSV)',
    subtitle: 'Agrega tus cuentas personalizadas; tipo y naturaleza se deducen automáticamente si se omiten',
    filename: 'plantilla-puc-vertika.csv',
    plantilla: PLANTILLA_PUC_CSV,
  },
};

export function ImportarCsvModal({
  open,
  kind,
  empresa,
  estado,
  onClose,
  toast,
}: {
  open: boolean;
  kind: CsvImportKind;
  empresa: Copropiedad;
  estado: EstadoApp;
  onClose: () => void;
  toast: (t: ToastData) => void;
}) {
  const [rawText, setRawText] = useState('');
  const [fechaApertura, setFechaApertura] = useState(`${estado.periodo}-01`);
  const [importando, setImportando] = useState(false);
  const [progreso, setProgreso] = useState('');

  const cfg = CONFIG[kind];

  const parsed = useMemo(() => {
    if (!rawText.trim()) return null;
    if (kind === 'unidades') return { kind: 'unidades' as const, ...parseUnidadesCsv(rawText) };
    if (kind === 'terceros') return { kind: 'terceros' as const, ...parseTercerosCsv(rawText) };
    if (kind === 'puc') return { kind: 'puc' as const, ...parsePucCsv(rawText) };
    return { kind: 'saldos' as const, ...parseSaldosInicialesCsv(rawText) };
  }, [kind, rawText]);

  const saldosTotales = useMemo(() => {
    if (!parsed || parsed.kind !== 'saldos') return null;
    const debito = parsed.rows.reduce((s, r) => s + r.debito, 0);
    const credito = parsed.rows.reduce((s, r) => s + r.credito, 0);
    return { debito, credito, cuadra: debito > 0 && debito === credito };
  }, [parsed]);

  const coefTotal = useMemo(() => {
    if (!parsed || parsed.kind !== 'unidades') return 0;
    return parsed.rows.reduce((s, r) => s + r.coeficiente, 0);
  }, [parsed]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      try {
        const { readSheet } = await import('read-excel-file/browser');
        const rows = await readSheet(file);
        const lines = rows.map((row) =>
          row
            .map((cell) => {
              if (cell === null || cell === undefined) return '';
              if (cell instanceof Date) return cell.toISOString().slice(0, 10);
              const str = String(cell).replace(/\r?\n/g, ' ').trim();
              return str.includes(';') || str.includes('"')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            })
            .join(';'),
        );
        setRawText(lines.join('\r\n'));
      } catch (e: unknown) {
        toast({
          tone: 'error',
          title: 'No se pudo leer el archivo Excel',
          msg: e instanceof Error ? e.message : 'Verifica que sea un archivo .xlsx válido.',
        });
      }
      return;
    }
    const text = await file.text();
    setRawText(text);
  };

  const ejecutarImportacion = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setImportando(true);
    setProgreso('Iniciando importación…');
    try {
      if (parsed.kind === 'terceros') {
        const existentes = new Set(
          tercerosDe(estado).map((t) => t.documento.trim().toLowerCase()),
        );
        let creados = 0;
        let omitidos = 0;
        let fallidos = 0;
        for (let i = 0; i < parsed.rows.length; i++) {
          const row = parsed.rows[i];
          setProgreso(`Procesando tercero ${i + 1} de ${parsed.rows.length}…`);
          const key = row.documento.trim().toLowerCase();
          if (existentes.has(key)) {
            omitidos += 1;
            continue;
          }
          const res = await acciones.crearTercero({
            nombre: row.nombre,
            tipo: row.tipo,
            documento: row.documento,
            dv: row.dv,
            email: row.email,
            telefono: row.telefono,
            ciudad: row.ciudad,
            retefuentePct: row.retefuentePct,
            reteicaPct: row.reteicaPct,
            reteivaPct: row.reteivaPct,
            noObligado: row.noObligado,
          });
          if (res.ok) {
            existentes.add(key);
            creados += 1;
          } else {
            fallidos += 1;
          }
        }
        toast({
          tone: fallidos > 0 && creados === 0 ? 'error' : 'ok',
          title: 'Importación de terceros completada',
          msg: `${creados} creado(s) · ${omitidos} omitido(s)${fallidos > 0 ? ` · ${fallidos} error(es)` : ''}`,
        });
        setRawText('');
        onClose();
        return;
      }

      if (parsed.kind === 'unidades') {
        if (apiEnabled) {
          let creadas = 0;
          let propCreados = 0;
          let omitidas = 0;
          let fallidas = 0;
          const chunkSize = 250;
          for (let start = 0; start < parsed.rows.length; start += chunkSize) {
            const slice = parsed.rows.slice(start, start + chunkSize);
            setProgreso(
              `Importando lote ${Math.floor(start / chunkSize) + 1} (${start + 1}–${Math.min(start + slice.length, parsed.rows.length)} de ${parsed.rows.length})…`,
            );
            const res = await acciones.importarUnidadesLote(
              slice.map((row) => ({
                torre: row.torre,
                numero: row.numero,
                tipo: row.tipo,
                area: row.area,
                coeficiente: row.coeficiente,
                matricula: row.matricula,
                propietarioNombre: row.propietarioNombre,
                propietarioDocumento: row.propietarioDocumento,
                propietarioEmail: row.propietarioEmail,
                propietarioTelefono: row.propietarioTelefono,
                carteraCongelada: false,
              })),
            );
            if (res.ok) {
              creadas += res.data.creadas;
              omitidas += res.data.omitidas;
              propCreados += res.data.propietariosCreados;
              fallidas += res.data.errores.length;
            } else {
              fallidas += slice.length;
              toast({ tone: 'error', title: 'Error en lote', msg: res.error });
            }
          }
          toast({
            tone: fallidas > 0 && creadas === 0 ? 'error' : 'ok',
            title: 'Importación en lote completada',
            msg: `${creadas} unidad(es) · ${propCreados} propietario(s) nuevos · ${omitidas} omitida(s)${fallidas > 0 ? ` · ${fallidas} error(es)` : ''}`,
          });
          setRawText('');
          onClose();
          return;
        }

        const docToId = new Map<string, string>();
        for (const t of tercerosDe(estado)) {
          docToId.set(t.documento.trim().toLowerCase(), t.id);
        }
        const existingUnits = new Set(
          unidadesDe(estado).map((u) => `${u.torre.toUpperCase()}-${u.numero.toUpperCase()}`),
        );
        let creadas = 0;
        let propCreados = 0;
        let omitidas = 0;
        let fallidas = 0;

        for (let i = 0; i < parsed.rows.length; i++) {
          const row = parsed.rows[i];
          setProgreso(`Importando unidad ${i + 1} de ${parsed.rows.length} (${row.torre}-${row.numero})…`);
          const unitKey = `${row.torre.toUpperCase()}-${row.numero.toUpperCase()}`;
          if (existingUnits.has(unitKey)) {
            omitidas += 1;
            continue;
          }

          let propId = '';
          const docKey = row.propietarioDocumento.trim().toLowerCase();
          if (docKey && docToId.has(docKey)) {
            propId = docToId.get(docKey) ?? '';
          } else if (row.propietarioNombre && row.propietarioDocumento) {
            const tpRes = await acciones.crearTercero({
              nombre: row.propietarioNombre,
              tipo: 'PROPIETARIO',
              documento: row.propietarioDocumento,
              email: row.propietarioEmail,
              telefono: row.propietarioTelefono,
              ciudad: empresa.ciudad || 'Bogotá D.C.',
              retefuentePct: 0,
              reteicaPct: 0,
              reteivaPct: 0,
              noObligado: true,
            });
            if (tpRes.ok) {
              propCreados += 1;
              const recien = DATOS.terceros.find(
                (t) =>
                  t.empresaId === empresa.id &&
                  t.documento.trim().toLowerCase() === docKey,
              );
              if (recien) {
                propId = recien.id;
                docToId.set(docKey, recien.id);
              }
            }
          }

          if (!propId) {
            const fallbackProp = tercerosDe(estado).find((t) => t.tipo === 'PROPIETARIO') ?? tercerosDe(estado)[0];
            propId = fallbackProp?.id ?? '';
          }
          if (!propId) {
            fallidas += 1;
            continue;
          }

          const uRes = await acciones.crearUnidad({
            torre: row.torre,
            numero: row.numero,
            tipo: row.tipo,
            area: row.area,
            coeficiente: row.coeficiente,
            matricula: row.matricula,
            propietarioId: propId,
            carteraCongelada: false,
          });
          if (uRes.ok) {
            existingUnits.add(unitKey);
            creadas += 1;
          } else {
            fallidas += 1;
          }
        }

        toast({
          tone: fallidas > 0 && creadas === 0 ? 'error' : 'ok',
          title: 'Importación de unidades completada',
          msg: `${creadas} unidad(es) · ${propCreados} propietario(s) nuevos · ${omitidas} omitida(s)${fallidas > 0 ? ` · ${fallidas} error(es)` : ''}`,
        });
        setRawText('');
        onClose();
        return;
      }

      if (parsed.kind === 'puc') {
        const existentes = new Set(CUENTAS.map((c) => c.codigo.trim()));
        let creadas = 0;
        let omitidas = 0;
        let fallidas = 0;
        for (let i = 0; i < parsed.rows.length; i++) {
          const row = parsed.rows[i];
          setProgreso(`Importando cuenta ${i + 1} de ${parsed.rows.length} (${row.codigo})…`);
          if (existentes.has(row.codigo)) {
            omitidas += 1;
            continue;
          }
          const res = await acciones.crearCuentaPuc({
            codigo: row.codigo,
            nombre: row.nombre,
            tipo: row.tipo,
            naturaleza: row.naturaleza,
            requiereTercero: row.requiereTercero,
            requiereUnidad: row.requiereUnidad,
            nota: row.nota,
          });
          if (res.ok) {
            existentes.add(row.codigo);
            creadas += 1;
          } else {
            fallidas += 1;
          }
        }
        toast({
          tone: fallidas > 0 && creadas === 0 ? 'error' : 'ok',
          title: 'Importación de PUC completada',
          msg: `${creadas} cuenta(s) creada(s) · ${omitidas} ya existía(n)${fallidas > 0 ? ` · ${fallidas} error(es)` : ''}`,
        });
        setRawText('');
        onClose();
        return;
      }

      if (parsed.kind === 'saldos') {
        if (!saldosTotales?.cuadra) {
          toast({
            tone: 'error',
            title: 'Balance descuadrado',
            msg: 'La suma de débitos debe ser exactamente igual a la suma de créditos.',
          });
          return;
        }
        setProgreso('Asentando comprobante de apertura…');
        const ters = tercerosDe(estado);
        const unis = unidadesDe(estado);
        const lines = parsed.rows.map((r, idx) => {
          const ter = r.terceroDocumento
            ? ters.find((t) => t.documento.replace(/[^0-9A-Za-z]/g, '') === r.terceroDocumento)
            : undefined;
          const uni = r.unidadCodigo
            ? unis.find(
                (u) =>
                  `${u.torre}-${u.numero}`.toUpperCase() === r.unidadCodigo.toUpperCase() ||
                  u.numero.toUpperCase() === r.unidadCodigo.toUpperCase(),
              )
            : undefined;
          return {
            id: `ini-${idx + 1}`,
            cuenta: r.cuenta,
            descripcion: r.descripcion,
            debito: r.debito,
            credito: r.credito,
            ...(ter ? { terceroId: ter.id } : {}),
            ...(uni ? { unidadId: uni.id } : {}),
          };
        });

        const res = await acciones.crearComprobanteManual({
          companyId: empresa.id,
          period: estado.periodo,
          entryType: 'CC',
          date: fechaApertura || `${estado.periodo}-01`,
          description: `Asiento de apertura / Saldos iniciales (${empresa.nombreCorto})`,
          reference: `APERTURA-${estado.periodo}`,
          origin: 'IMPORTACION_CSV',
          lines,
        });
        if (res.ok) {
          toast({
            tone: 'ok',
            title: 'Saldos iniciales asentados',
            msg: `${res.detalle} · ${lines.length} líneas cuadradas`,
          });
          setRawText('');
          onClose();
        } else {
          toast({ tone: 'error', title: 'No se pudo asentar', msg: res.error });
        }
      }
    } finally {
      setImportando(false);
      setProgreso('');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={cfg.title} subtitle={cfg.subtitle} width={720}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 12px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--bg)',
          }}
        >
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            Sube un archivo <strong>Excel (.xlsx)</strong>, <strong>CSV (;/,)</strong> o pega directo desde Excel.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn
              size="xs"
              variant="outline"
              icon="download"
              type="button"
              onClick={() => descargarPlantillaCsv(cfg.filename, cfg.plantilla)}
            >
              Descargar plantilla
            </Btn>
            <label className="btn btn-xs btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>Subir .xlsx o .csv</span>
              <input
                type="file"
                accept=".xlsx,.csv,.txt"
                style={{ display: 'none' }}
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>

        {kind === 'saldos' && (
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Fecha del asiento de apertura</span>
            <input
              type="date"
              value={fechaApertura}
              onChange={(e) => setFechaApertura(e.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span>O pega aquí las filas directamente desde Excel (incluyendo la primera fila de encabezados)</span>
          <textarea
            rows={5}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={cfg.plantilla}
            className="mono"
            style={{
              padding: '8px 10px',
              borderRadius: 4,
              border: '1px solid var(--line)',
              fontSize: 12,
              width: '100%',
              resize: 'vertical',
            }}
          />
        </label>

        {parsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge tone="info">{parsed.rows.length} fila(s) válidas</Badge>
              {parsed.kind === 'unidades' && (
                <Badge tone={Math.abs(coefTotal - 1) < 0.005 ? 'ok' : 'warn'}>
                  Suma coeficientes: {(coefTotal * 100).toFixed(2)} %
                </Badge>
              )}
              {saldosTotales && (
                <>
                  <Badge tone={saldosTotales.cuadra ? 'ok' : 'error'}>
                    Débito: {fmtMoney(saldosTotales.debito)} · Crédito: {fmtMoney(saldosTotales.credito)}
                  </Badge>
                  {!saldosTotales.cuadra && (
                    <Badge tone="error">
                      Diferencia: {fmtMoney(Math.abs(saldosTotales.debito - saldosTotales.credito))}
                    </Badge>
                  )}
                </>
              )}
              {parsed.errors.length > 0 && (
                <Badge tone="warn">{parsed.errors.length} aviso(s)</Badge>
              )}
            </div>

            {parsed.errors.length > 0 && (
              <div
                style={{
                  border: '1px solid #d97706',
                  background: '#fffbeb',
                  color: '#92400e',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 12,
                  maxHeight: 90,
                  overflowY: 'auto',
                }}
              >
                {parsed.errors.slice(0, 6).map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            )}

            {parsed.rows.length > 0 && (
              <div className="table-scroll" style={{ maxHeight: 190, border: '1px solid var(--line)', borderRadius: 6 }}>
                <table className="data-table">
                  <thead>
                    {parsed.kind === 'unidades' ? (
                      <tr>
                        <th>Unidad</th>
                        <th>Tipo</th>
                        <th className="num">Área</th>
                        <th className="num">Coef.</th>
                        <th>Propietario</th>
                      </tr>
                    ) : parsed.kind === 'terceros' ? (
                      <tr>
                        <th>Nombre</th>
                        <th>Tipo</th>
                        <th>Documento</th>
                        <th className="num">RF / ICA / IVA</th>
                      </tr>
                    ) : parsed.kind === 'puc' ? (
                      <tr>
                        <th>Código</th>
                        <th>Nombre de cuenta</th>
                        <th>Tipo</th>
                        <th>Nat.</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Cuenta</th>
                        <th>Descripción</th>
                        <th className="num">Débito</th>
                        <th className="num">Crédito</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {parsed.kind === 'puc' &&
                      parsed.rows.slice(0, 15).map((r, i) => (
                        <tr key={i}>
                          <td className="mono">{r.codigo}</td>
                          <td>{r.nombre}</td>
                          <td>{r.tipo}</td>
                          <td className="mono">{r.naturaleza}</td>
                        </tr>
                      ))}
                    {parsed.kind === 'unidades' &&
                      parsed.rows.slice(0, 12).map((r, i) => (
                        <tr key={i}>
                          <td className="mono">{r.torre}-{r.numero}</td>
                          <td>{r.tipo}</td>
                          <td className="num mono">{r.area} m²</td>
                          <td className="num mono">{(r.coeficiente * 100).toFixed(4)} %</td>
                          <td>{r.propietarioNombre || '—'} {r.propietarioDocumento ? `(${r.propietarioDocumento})` : ''}</td>
                        </tr>
                      ))}
                    {parsed.kind === 'terceros' &&
                      parsed.rows.slice(0, 12).map((r, i) => (
                        <tr key={i}>
                          <td>{r.nombre}</td>
                          <td>{r.tipo}</td>
                          <td className="mono">{r.documento}{r.dv ? `-${r.dv}` : ''}</td>
                          <td className="num mono">{r.retefuentePct}% / {r.reteicaPct}% / {r.reteivaPct}%</td>
                        </tr>
                      ))}
                    {parsed.kind === 'saldos' &&
                      parsed.rows.slice(0, 12).map((r, i) => (
                        <tr key={i}>
                          <td className="mono">{r.cuenta}</td>
                          <td>{r.descripcion}</td>
                          <td className="num mono">{r.debito > 0 ? fmtMoney(r.debito) : '—'}</td>
                          <td className="num mono">{r.credito > 0 ? fmtMoney(r.credito) : '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <small className="mono" style={{ color: 'var(--ink-2)' }}>{progreso}</small>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn type="button" variant="ghost" onClick={onClose} disabled={importando}>
              Cancelar
            </Btn>
            <Btn
              type="button"
              variant="primary"
              disabled={
                importando ||
                !parsed ||
                parsed.rows.length === 0 ||
                (parsed.kind === 'saldos' && !saldosTotales?.cuadra)
              }
              onClick={() => void ejecutarImportacion()}
            >
              {importando ? 'Importando…' : `Importar ${parsed?.rows.length ?? 0} fila(s)`}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}
