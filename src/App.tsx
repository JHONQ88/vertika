import { useCallback, useEffect, useState } from 'react';
import type { PreAsiento } from './domain/types';
import { acarrearPreAsiento } from './domain/engine';
import { acciones, empresaActiva, esPeriodoBloqueado, tienePermiso, useAuth, useEstado, useSyncStatus, DATOS } from './store';
import { fmtPeriodo } from './domain/format';
import { FKeyBar, Sidebar, Topbar } from './components/Shell';
import { AyudaModal, CommandPalette, EmpresasModal, PeriodosModal } from './components/Overlays';
import { AuthModal } from './components/AuthModal';
import { ToastStack } from './components/ui';
import { MODO_COUNT, type FiltrosVista, type Toast, type ToastData, type ViewKey, type VistaProps } from './ui-types';
import { Bandeja } from './views/Bandeja';
import { Libro } from './views/Libro';
import { Balance } from './views/Balance';
import { Presupuesto } from './views/Presupuesto';
import { Cartera } from './views/Cartera';
import { Comprobantes } from './views/Comprobantes';
import { Maestros } from './views/Maestros';
import { Cierre } from './views/Cierre';
import { Ajustes } from './views/Ajustes';

type Overlay = 'palette' | 'empresas' | 'periodos' | 'ayuda' | 'auth' | null;

export default function App() {
  const estado = useEstado();
  const syncStatus = useSyncStatus();
  const auth = useAuth();
  const [view, setView] = useState<ViewKey>('bandeja');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [filtros, setFiltrosState] = useState<FiltrosVista>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modos, setModos] = useState<Record<ViewKey, number>>({
    bandeja: 0,
    libro: 0,
    balance: 0,
    presupuesto: 0,
    cartera: 0,
    comprobantes: 0,
    maestros: 0,
    cierre: 0,
    ajustes: 0,
  });
  const [preSeleccionado, setPreSeleccionado] = useState<string | null>(null);

  const empresa = empresaActiva(estado);
  const pendientes = estado.preAsientos.filter((p) => p.empresaId === empresa.id).length;
  const bloqueado = esPeriodoBloqueado(estado, estado.periodo);

  const toast = useCallback((t: ToastData) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { ...t, id }].slice(-4));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4600);
  }, []);

  const setFiltros = useCallback((f: Partial<FiltrosVista>) => {
    setFiltrosState((prev) => ({ ...prev, ...f }));
  }, []);

  const irA = useCallback((v: ViewKey, f: Partial<FiltrosVista> = {}) => {
    setView(v);
    setFiltrosState({ cuenta: undefined, terceroId: undefined, unidadId: undefined, comprobanteId: undefined, ...f });
  }, []);

  const aprobar = useCallback(
    async (id: string) => {
      const res = await acciones.aprobarPreAsiento(id);
      if (res.ok) {
        toast({
          tone: 'ok',
          title: 'Comprobante asentado',
          msg: `${res.detalle} · ${fmtPeriodo(estado.periodo)}`,
        });
        setPreSeleccionado(null);
      } else {
        toast({ tone: 'error', title: 'No se pudo asentar', msg: res.error });
      }
    },
    [estado.periodo, toast],
  );

  const rechazar = useCallback(
    async (id: string) => {
      const res = await acciones.rechazarPreAsiento(id);
      if (res.ok) {
        toast({ tone: 'info', title: 'Pre-asiento devuelto', msg: 'El agente lo revisará de nuevo.' });
        setPreSeleccionado(null);
      } else {
        toast({ tone: 'error', title: 'No se pudo devolver', msg: res.error });
      }
    },
    [toast],
  );

  const acarrear = useCallback(
    (pre: PreAsiento) => {
      if (!tienePermiso(auth.user.rol, 'contabilidad')) {
        toast({ tone: 'error', title: 'Sin permisos', msg: `El rol ${auth.user.rol} es de solo lectura.` });
        return;
      }
      const res = acarrearPreAsiento(pre, DATOS.terceros);
      if (!res) {
        toast({
          tone: 'info',
          title: 'Sin reglas de acarreo',
          msg: 'Este documento no tiene retenciones o contrapartidas que autocompletar.',
        });
        return;
      }
      acciones.cambiarLineasPreAsiento(pre.id, res.lineas);
      toast({ tone: 'ok', title: 'Acarreo IA aplicado', msg: res.detalle });
    },
    [auth.user.rol, toast],
  );

  const onKey = useCallback(
    (k: string) => {
      if (k === 'F1') setOverlay('ayuda');
      else if (k === 'F2') setOverlay('palette');
      else if (k === 'F3') setOverlay('empresas');
      else if (k === 'F4') setOverlay('periodos');
      else if (k === 'F6') {
        const objetivo = preSeleccionado
          ? estado.preAsientos.find((p) => p.id === preSeleccionado)
          : estado.preAsientos.find((p) => p.empresaId === empresa.id && p.periodo === estado.periodo);
        if (view === 'bandeja' && objetivo) acarrear(objetivo);
        else toast({ tone: 'info', title: 'F6 · Acarreo IA', msg: 'Ubícate en la bandeja de pre-asientos para usarlo.' });
      } else if (k === 'F10') {
        const id =
          preSeleccionado ??
          estado.preAsientos.find((p) => p.empresaId === empresa.id && p.periodo === estado.periodo)?.id;
        if (view === 'bandeja' && id) void aprobar(id);
        else toast({ tone: 'info', title: 'F10 · Asentar', msg: 'Ubícate en la bandeja de pre-asientos para asentar.' });
      } else if (k === 'F11') {
        const count = MODO_COUNT[view] || 1;
        setModos((prev) => ({ ...prev, [view]: ((prev[view] ?? 0) + 1) % count }));
      }
    },
    [view, preSeleccionado, estado.preAsientos, estado.periodo, empresa.id, acarrear, aprobar, toast],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      if (e.key === 'Escape') {
        setOverlay(null);
        return;
      }

      if (e.key === 'F1') {
        e.preventDefault();
        setOverlay('ayuda');
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        setOverlay('palette');
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setOverlay('empresas');
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setOverlay('periodos');
        return;
      }
      if (e.key === 'F6') {
        e.preventDefault();
        onKey('F6');
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        onKey('F10');
        return;
      }
      if (e.key === 'F11') {
        e.preventDefault();
        onKey('F11');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOverlay('palette');
        return;
      }
      if (e.key === '?' && !typing) {
        e.preventDefault();
        setOverlay('ayuda');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onKey]);

  const vistaProps: VistaProps = {
    empresa,
    estado,
    filtros,
    setFiltros,
    setView: irA,
    toast,
    modo: modos[view] ?? 0,
    setModo: (n) => setModos((prev) => ({ ...prev, [view]: n })),
  };

  const renderVista = () => {
    switch (view) {
      case 'bandeja':
        return (
          <Bandeja
            {...vistaProps}
            seleccionado={preSeleccionado}
            setSeleccionado={setPreSeleccionado}
            onAprobar={(id) => void aprobar(id)}
            onRechazar={(id) => void rechazar(id)}
            onAcarrear={acarrear}
          />
        );
      case 'libro':
        return <Libro {...vistaProps} />;
      case 'balance':
        return <Balance {...vistaProps} />;
      case 'presupuesto':
        return <Presupuesto {...vistaProps} />;
      case 'cartera':
        return <Cartera {...vistaProps} />;
      case 'comprobantes':
        return <Comprobantes {...vistaProps} />;
      case 'maestros':
        return <Maestros {...vistaProps} />;
      case 'cierre':
        return <Cierre {...vistaProps} />;
      case 'ajustes':
        return <Ajustes {...vistaProps} />;
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <Topbar
        empresa={empresa}
        pendientes={pendientes}
        periodo={estado.periodo}
        bloqueado={bloqueado}
        syncStatus={syncStatus}
        usuario={auth.user}
        onEmpresas={() => setOverlay('empresas')}
        onPeriodo={() => setOverlay('periodos')}
        onAyuda={() => setOverlay('ayuda')}
        onAuth={() => setOverlay('auth')}
      />

      <div className="body">
        <Sidebar
          view={view}
          setView={irA}
          empresa={empresa}
          pendientes={pendientes}
          periodo={estado.periodo}
          bloqueado={bloqueado}
        />
        <main className="main">{renderVista()}</main>
      </div>

      <FKeyBar onKey={onKey} />

      {overlay === 'palette' && (
        <CommandPalette
          estado={estado}
          onClose={() => setOverlay(null)}
          onNavigate={(v, f) => {
            irA(v, f);
            setOverlay(null);
          }}
          onAccion={(a) => {
            if (a === 'cierre') setView('cierre');
            else if (a === 'empresas') setOverlay('empresas');
            else if (a === 'periodo') setOverlay('periodos');
            else if (a === 'reset') {
              void acciones.restablecer().then(() => toast({ tone: 'info', title: 'Demo restablecida' }));
            }
          }}
        />
      )}

      {overlay === 'empresas' && <EmpresasModal estado={estado} onClose={() => setOverlay(null)} />}
      {overlay === 'periodos' && <PeriodosModal estado={estado} onClose={() => setOverlay(null)} />}
      {overlay === 'ayuda' && <AyudaModal onClose={() => setOverlay(null)} />}
      <AuthModal open={overlay === 'auth'} onClose={() => setOverlay(null)} toast={toast} />

      <ToastStack toasts={toasts} />
    </div>
  );
}
