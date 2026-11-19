import type { Copropiedad, EstadoApp } from './domain/types';
import type { IconName } from './components/Icon';

export type ViewKey =
  | 'bandeja'
  | 'libro'
  | 'balance'
  | 'presupuesto'
  | 'cartera'
  | 'comprobantes'
  | 'maestros'
  | 'cierre'
  | 'ajustes';

export interface FiltrosVista {
  cuenta?: string;
  terceroId?: string;
  unidadId?: string;
  comprobanteId?: string;
}

export interface ToastData {
  tone: 'ok' | 'error' | 'info';
  title: string;
  msg?: string;
}

export interface Toast extends ToastData {
  id: number;
}

export interface VistaProps {
  empresa: Copropiedad;
  estado: EstadoApp;
  filtros: FiltrosVista;
  setFiltros: (f: Partial<FiltrosVista>) => void;
  setView: (v: ViewKey) => void;
  toast: (t: ToastData) => void;
  modo: number;
  setModo: (n: number) => void;
}

export const MODO_COUNT: Record<ViewKey, number> = {
  bandeja: 1,
  libro: 2,
  balance: 3,
  presupuesto: 1,
  cartera: 2,
  comprobantes: 1,
  maestros: 1,
  cierre: 1,
  ajustes: 1,
};

export const NAV: Array<{
  grupo: string;
  items: Array<{ key: ViewKey; label: string; icon: IconName }>;
}> = [
  {
    grupo: 'Operación',
    items: [
      { key: 'bandeja', label: 'Bandeja de pre-asientos', icon: 'bot' },
      { key: 'cartera', label: 'Cartera y paz y salvo', icon: 'wallet' },
    ],
  },
  {
    grupo: 'Contabilidad',
    items: [
      { key: 'libro', label: 'Libro auxiliar', icon: 'book' },
      { key: 'balance', label: 'Balance de prueba', icon: 'scale' },
      { key: 'comprobantes', label: 'Comprobantes', icon: 'file' },
      { key: 'presupuesto', label: 'Ejecución presupuestal', icon: 'pie' },
    ],
  },
  {
    grupo: 'Maestros',
    items: [{ key: 'maestros', label: 'PUC, unidades y terceros', icon: 'database' }],
  },
  {
    grupo: 'Cierre',
    items: [
      { key: 'cierre', label: 'Cierre mensual', icon: 'lock' },
      { key: 'ajustes', label: 'Ajustes y auditoría', icon: 'settings' },
    ],
  },
];
