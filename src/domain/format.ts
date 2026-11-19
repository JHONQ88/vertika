const money = new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const money2 = new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$ ${money.format(Math.abs(Math.round(n)))}`;
}

export function fmtMoney2(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$ ${money2.format(Math.abs(n))}`;
}

export function fmtNum(n: number, dec = 2): string {
  return n.toLocaleString('es-CO', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

export function fmtPct(n: number, dec = 1): string {
  return `${n.toLocaleString('es-CO', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).replace(',', '.')}%`;
}

export function fmtCoef(n: number): string {
  return `${n.toFixed(6).replace('.', ',')}%`;
}

const MESES_CORTOS = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function fmtPeriodo(p: string): string {
  const [y, m] = p.split('-').map(Number);
  if (!y || !m) return p;
  return `${MESES_CORTOS[m - 1]} ${y}`;
}

export function fmtPeriodoLargo(p: string): string {
  const [y, m] = p.split('-').map(Number);
  if (!y || !m) return p;
  return `${MESES_LARGOS[m - 1]} de ${y}`;
}

export function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')} ${MESES_CORTOS[m - 1]} ${y}`;
}

export function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export function hoyISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ultimoDia(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${periodo}-${String(d).padStart(2, '0')}`;
}

export function periodosDelAnio(anio: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`);
}

export function diasVencido(desdePeriodo: string, hastaPeriodo: string): number {
  const [y1, m1] = desdePeriodo.split('-').map(Number);
  const [y2, m2] = hastaPeriodo.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function numeroAFecha(isoPeriodo: string): Date {
  const [y, m] = isoPeriodo.split('-').map(Number);
  return new Date(y, m - 1, 1);
}
