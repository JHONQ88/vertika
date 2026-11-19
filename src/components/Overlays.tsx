import { useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoApp } from '../domain/types';
import { CUENTAS } from '../domain/puc';
import { DATOS, acciones } from '../store';
import { fmtPeriodo } from '../domain/format';
import { Badge, Btn, Modal } from './ui';
import { Icon, type IconName } from './Icon';
import type { FiltrosVista, ViewKey } from '../ui-types';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

interface Item {
  id: string;
  grupo: string;
  titulo: string;
  subtitulo?: string;
  icon: IconName;
  keywords: string;
  run: () => void;
}

export function CommandPalette({
  estado,
  onClose,
  onNavigate,
  onAccion,
}: {
  estado: EstadoApp;
  onClose: () => void;
  onNavigate: (v: ViewKey, f: Partial<FiltrosVista>) => void;
  onAccion: (a: 'cierre' | 'empresas' | 'periodo' | 'reset') => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const empresaId = estado.activeCompanyId;
    const salida: Item[] = [];

    for (const c of CUENTAS) {
      salida.push({
        id: `c-${c.codigo}`,
        grupo: 'Cuentas PUC ESAL',
        titulo: `${c.codigo} · ${c.nombre}`,
        subtitulo: c.tipo,
        icon: 'book',
        keywords: `${c.codigo} ${c.nombre} ${c.tipo}`,
        run: () => onNavigate('libro', { cuenta: c.codigo }),
      });
    }

    for (const u of DATOS.units.filter((x) => x.empresaId === empresaId)) {
      salida.push({
        id: `u-${u.id}`,
        grupo: 'Unidades',
        titulo: `${u.torre} ${u.numero}`,
        subtitulo: `Coeficiente ${u.coeficiente.toFixed(4)}%`,
        icon: 'building',
        keywords: `${u.torre} ${u.numero} ${u.matricula} apto unidad`,
        run: () => onNavigate('cartera', { unidadId: u.id }),
      });
    }

    for (const t of DATOS.terceros.filter((x) => !x.empresaId || x.empresaId === empresaId)) {
      salida.push({
        id: `t-${t.id}`,
        grupo: 'Terceros',
        titulo: t.nombre,
        subtitulo: `${t.tipo} · ${t.documento}`,
        icon: 'users',
        keywords: `${t.nombre} ${t.documento} ${t.tipo}`,
        run: () => onNavigate('libro', { terceroId: t.id }),
      });
    }

    for (const c of estado.comprobantes
      .filter((x) => x.empresaId === empresaId)
      .slice(-80)
      .reverse()) {
      salida.push({
        id: `cp-${c.id}`,
        grupo: 'Comprobantes',
        titulo: `${c.tipo}-${c.consecutivo} · ${c.descripcion}`,
        subtitulo: `${c.periodo} · ${c.origen.replace(/_/g, ' ')}`,
        icon: 'file',
        keywords: `${c.tipo} ${c.consecutivo} ${c.descripcion} ${c.periodo}`,
        run: () => onNavigate('comprobantes', { comprobanteId: c.id }),
      });
    }

    salida.push(
      {
        id: 'a-bandeja',
        grupo: 'Acciones',
        titulo: 'Ir a la bandeja de pre-asientos',
        icon: 'bot',
        keywords: 'bandeja pre asientos ia',
        run: () => onNavigate('bandeja', {}),
      },
      {
        id: 'a-cierre',
        grupo: 'Acciones',
        titulo: 'Ejecutar cierre mensual',
        icon: 'lock',
        keywords: 'cierre mensual periodo',
        run: () => {
          onAccion('cierre');
          onClose();
        },
      },
      {
        id: 'a-empresas',
        grupo: 'Acciones',
        titulo: 'Cambiar de conjunto',
        icon: 'building',
        keywords: 'cambiar conjunto empresa',
        run: () => {
          onAccion('empresas');
          onClose();
        },
      },
      {
        id: 'a-periodo',
        grupo: 'Acciones',
        titulo: 'Cambiar periodo contable',
        icon: 'calendar',
        keywords: 'cambiar periodo mes',
        run: () => {
          onAccion('periodo');
          onClose();
        },
      },
      {
        id: 'a-reset',
        grupo: 'Acciones',
        titulo: 'Restablecer datos de demostración',
        icon: 'refresh',
        keywords: 'restablecer demo datos',
        run: () => {
          onAccion('reset');
          onClose();
        },
      },
    );

    return salida;
  }, [estado.activeCompanyId, estado.comprobantes, onNavigate, onAccion, onClose]);

  const resultados = useMemo(() => {
    const needle = norm(q.trim());
    if (!needle) return items.slice(0, 30);
    return items
      .map((it) => {
        const texto = norm(it.keywords);
        const titulo = norm(it.titulo);
        let score = -1;
        if (titulo.startsWith(needle)) score = 100;
        else if (texto.startsWith(needle)) score = 80;
        else if (titulo.includes(needle)) score = 60;
        else if (texto.includes(needle)) score = 40;
        return { it, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((r) => r.it);
  }, [items, q]);

  useEffect(() => {
    const el = listaRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, Item[]>();
    for (const it of resultados) {
      const arr = mapa.get(it.grupo) ?? [];
      arr.push(it);
      mapa.set(it.grupo, arr);
    }
    return Array.from(mapa.entries());
  }, [resultados]);

  return (
    <div className="overlay overlay-top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            autoFocus
            value={q}
            placeholder="Buscar cuenta PUC, unidad, tercero, comprobante o acción…"
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, resultados.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                resultados[idx]?.run();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list" ref={listaRef}>
          {grupos.length === 0 && <p className="palette-empty">Sin resultados para “{q}”.</p>}
          {grupos.map(([grupo, its]) => (
            <div key={grupo}>
              <small className="palette-grupo">{grupo}</small>
              {its.map((it) => {
                const globalIdx = resultados.indexOf(it);
                return (
                  <button
                    key={it.id}
                    data-idx={globalIdx}
                    className={`palette-item ${globalIdx === idx ? 'is-active' : ''}`}
                    onMouseEnter={() => setIdx(globalIdx)}
                    onClick={() => it.run()}
                  >
                    <span className="palette-icon">
                      <Icon name={it.icon} size={16} />
                    </span>
                    <span className="palette-text">
                      <strong>{it.titulo}</strong>
                      {it.subtitulo && <small>{it.subtitulo}</small>}
                    </span>
                    <Icon name="arrowRight" size={14} className="palette-arrow" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <footer className="palette-foot">
          <span>
            <kbd>↑↓</kbd> navegar
          </span>
          <span>
            <kbd>Enter</kbd> abrir
          </span>
          <span>
            <kbd>Ctrl K</kbd> buscar
          </span>
        </footer>
      </div>
    </div>
  );
}

export function EmpresasModal({
  estado,
  onClose,
}: {
  estado: EstadoApp;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title="Cambiar de conjunto" subtitle="Un contador puede operar varios conjuntos desde una sola consola" width={720}>
      <div className="empresas">
        {DATOS.companies.map((c) => {
          const activa = c.id === estado.activeCompanyId;
          const nUnidades = DATOS.units.filter((u) => u.empresaId === c.id).length;
          const pendientes = estado.preAsientos.filter((p) => p.empresaId === c.id).length;
          return (
            <button
              key={c.id}
              className={`empresa-card ${activa ? 'is-active' : ''}`}
              onClick={() => {
                acciones.cambiarEmpresa(c.id);
                onClose();
              }}
            >
              <span className="empresa-avatar" style={{ background: c.color }}>
                {c.sigla}
              </span>
              <span className="empresa-info">
                <strong>{c.razonSocial}</strong>
                <small>
                  {c.nit} · {c.ciudad}
                </small>
                <small>{c.direccion}</small>
              </span>
              <span className="empresa-meta">
                <Badge tone="accent">{nUnidades} unidades</Badge>
                <Badge tone={pendientes > 0 ? 'warn' : 'ok'}>{pendientes} pre-asientos</Badge>
                <Badge tone="neutral">NIIF G{c.grupoNiif}</Badge>
                {activa && <Badge tone="info">Activo</Badge>}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export function PeriodosModal({
  estado,
  onClose,
}: {
  estado: EstadoApp;
  onClose: () => void;
}) {
  const [anio, setAnio] = useState(() => Number(estado.periodo.split('-')[0]) || 2026);
  const cerrados = estado.periodosCerrados[estado.activeCompanyId] ?? [];
  const actual = DATOS.companies.find((c) => c.id === estado.activeCompanyId)?.periodoActual ?? '2026-11';

  return (
    <Modal open onClose={onClose} title="Periodo contable" subtitle="Los periodos cerrados quedan bloqueados para auditoría" width={620}>
      <div className="toolbar" style={{ marginTop: 0, justifyContent: 'space-between' }}>
        <Btn size="sm" variant="outline" onClick={() => setAnio((a) => a - 1)}>
          ‹ {anio - 1}
        </Btn>
        <strong className="mono">{anio}</strong>
        <Btn size="sm" variant="outline" onClick={() => setAnio((a) => a + 1)}>
          {anio + 1} ›
        </Btn>
      </div>
      <div className="periodos">
        {Array.from({ length: 12 }, (_, i) => {
          const p = `${anio}-${String(i + 1).padStart(2, '0')}`;
          const cerrado = cerrados.includes(p);
          const esActual = p === actual;
          const futuro = p > actual;
          return (
            <button
              key={p}
              className={`periodo-card ${estado.periodo === p ? 'is-active' : ''}`}
              onClick={() => {
                acciones.cambiarPeriodo(p);
                onClose();
              }}
            >
              <strong>{fmtPeriodo(p)}</strong>
              {cerrado && <Badge tone="neutral">Cerrado</Badge>}
              {esActual && !cerrado && <Badge tone="ok">Abierto</Badge>}
              {futuro && <Badge tone="warn">Sin abrir</Badge>}
              {estado.periodo === p && <Icon name="check" size={14} className="periodo-check" />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

const ATAJOS: Array<{ k: string; label: string; desc: string }> = [
  { k: 'F1', label: 'Ayuda', desc: 'Abre esta guía de atajos y flujo de trabajo.' },
  { k: 'F2', label: 'Buscador de maestros', desc: 'Cuentas PUC, unidades, terceros y comprobantes.' },
  { k: 'F3', label: 'Cambiar de conjunto', desc: 'Salta entre los conjuntos del contador.' },
  { k: 'F4', label: 'Cambiar de periodo', desc: 'Mes/año contable y bloqueo de cierres.' },
  { k: 'F6', label: 'Acarreo IA', desc: 'Autocompleta retenciones y contrapartida según el NIT.' },
  { k: 'F10', label: 'Asentar', desc: 'Valida y contabiliza el pre-asiento seleccionado.' },
  { k: 'F11', label: 'Cambiar vista', desc: 'Alterna modos de visualización en tablas.' },
  { k: 'Ctrl K', label: 'Búsqueda global', desc: 'Equivalente a F2.' },
];

export function AyudaModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Consola del contador · Ayuda" subtitle="Contaí en la nube, con IA y sin digitación" width={760}>
      <div className="ayuda">
        <section>
          <h3>Atajos de teclado</h3>
          <div className="atajos">
            {ATAJOS.map((a) => (
              <div key={a.k} className="atajo">
                <kbd>{a.k}</kbd>
                <div>
                  <strong>{a.label}</strong>
                  <small>{a.desc}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3>Flujo de trabajo</h3>
          <ol className="flujo">
            <li>
              <strong>El agente lee el documento.</strong> XML UBL 2.1 de la DIAN o PDF de servicios públicos con OCR.
            </li>
            <li>
              <strong>El motor determinista propone el asiento.</strong> Cuentas del PUC ESAL, retenciones y rubro presupuestal.
            </li>
            <li>
              <strong>El contador revisa y asienta con F10.</strong> La partida doble se valida antes de guardar; nada se puede contabilizar descuadrado.
            </li>
            <li>
              <strong>El cierre se ejecuta en un clic.</strong> Depreciación, provisión de cartera y traslado al fondo de imprevistos.
            </li>
          </ol>
        </section>

        <section>
          <h3>Reglas del motor</h3>
          <ul className="reglas">
            <li>Los periodos cerrados son de solo lectura.</li>
            <li>Cada comprobante queda firmado con un hash y queda en la auditoría.</li>
            <li>El PUC ESAL sigue la Orientación Técnica No. 15 del CTCP (Ley 675 de 2001).</li>
          </ul>
        </section>

        <div className="ayuda-acciones">
          <Btn icon="refresh" onClick={() => void acciones.restablecer()}>
            Restablecer demo
          </Btn>
          <Btn variant="primary" onClick={onClose}>
            Entendido
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
