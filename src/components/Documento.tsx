import { useState } from 'react';
import type { Documento } from '../domain/types';
import { fmtFecha, fmtMoney } from '../domain/format';
import { Badge, Btn } from './ui';
import { Icon } from './Icon';

export function DocumentoView({ doc }: { doc: Documento }) {
  const [tab, setTab] = useState<'doc' | 'xml'>('doc');
  const esRecibo = doc.clase === 'RECIBO';

  return (
    <div className="doc">
      <div className="doc-toolbar">
        <div className="doc-tabs">
          <button className={tab === 'doc' ? 'is-active' : ''} onClick={() => setTab('doc')}>
            Documento
          </button>
          {doc.xml && (
            <button className={tab === 'xml' ? 'is-active' : ''} onClick={() => setTab('xml')}>
              XML / Metadatos
            </button>
          )}
        </div>
        <Badge tone={esRecibo ? 'ok' : doc.clase === 'SOPORTE' ? 'warn' : 'info'}>
          {esRecibo ? 'Recibo de caja' : doc.clase === 'SOPORTE' ? 'Documento soporte' : 'Factura electrónica'}
        </Badge>
      </div>

      {tab === 'xml' && doc.xml ? (
        <pre className="xml">{doc.xml}</pre>
      ) : (
        <div className="doc-sheet">
          <div className="doc-head">
            <div>
              <small>{esRecibo ? 'Emite' : 'Emisor'}</small>
              <strong>{doc.emisor}</strong>
              <span>NIT {doc.nit}</span>
            </div>
            <div className="doc-head-right">
              <small>{esRecibo ? 'Referencia' : 'Número'}</small>
              <strong>{doc.numero}</strong>
              <span>{fmtFecha(doc.fecha)}</span>
            </div>
          </div>

          {doc.unidadLabel && (
            <div className="doc-unidad">
              <Icon name="building" size={15} />
              <span>{doc.unidadLabel}</span>
              {doc.pagador && <span className="muted">· {doc.pagador}</span>}
            </div>
          )}

          <table className="doc-items">
            <thead>
              <tr>
                <th>Concepto</th>
                <th className="num">Cant.</th>
                <th className="num">Vr. unitario</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.descripcion}</td>
                  <td className="num">{it.cantidad}</td>
                  <td className="num">{fmtMoney(it.valorUnitario)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="doc-totals">
            <div>
              <span>Subtotal</span>
              <strong>{fmtMoney(doc.subtotal)}</strong>
            </div>
            {doc.iva > 0 && (
              <div>
                <span>IVA</span>
                <strong>{fmtMoney(doc.iva)}</strong>
              </div>
            )}
            {doc.retenciones.map((r) => (
              <div key={r.nombre}>
                <span>
                  {r.nombre} {r.tarifa}%
                </span>
                <strong className="neg">-{fmtMoney(r.valor)}</strong>
              </div>
            ))}
            <div className="doc-total">
              <span>Total</span>
              <strong>{fmtMoney(doc.total)}</strong>
            </div>
          </div>

          {doc.metodo && (
            <div className="doc-pago">
              <Icon name={doc.metodo.includes('Bre-B') ? 'nfc' : 'card'} size={16} />
              <span>
                {doc.metodo} · {doc.referencia}
              </span>
            </div>
          )}

          <div className="doc-code" aria-hidden="true" />
          {doc.cufe && <p className="doc-cufe">CUFE {doc.cufe}</p>}
        </div>
      )}

      <div className="doc-actions">
        <Btn size="xs" variant="ghost" icon="print" onClick={() => window.print()}>
          Imprimir
        </Btn>
        <Btn size="xs" variant="ghost" icon="download" onClick={() => descargarDoc(doc)}>
          Descargar soporte
        </Btn>
      </div>
    </div>
  );
}

function descargarDoc(doc: Documento) {
  const lines = [
    `${doc.clase} ${doc.numero}`,
    `Emisor: ${doc.emisor} · NIT ${doc.nit}`,
    `Fecha: ${doc.fecha}`,
    '',
    ...doc.items.map((i) => `${i.descripcion} | ${i.cantidad} | ${i.valorUnitario}`),
    '',
    `Subtotal: ${doc.subtotal}`,
    `IVA: ${doc.iva}`,
    ...doc.retenciones.map((r) => `${r.nombre}: ${r.valor}`),
    `Total: ${doc.total}`,
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.numero}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
