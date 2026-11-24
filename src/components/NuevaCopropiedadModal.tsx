import { useState } from 'react';
import { acciones, DATOS, useAuth } from '../store';
import type { ToastData } from '../ui-types';
import { Badge, Btn, Modal } from './ui';

export function NuevaCopropiedadModal({
  open,
  onClose,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  toast: (t: ToastData) => void;
}) {
  const { user } = useAuth();
  const [nit, setNit] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [nombreCorto, setNombreCorto] = useState('');
  const [ciudad, setCiudad] = useState('Bogotá D.C.');
  const [direccion, setDireccion] = useState('');
  const [presupuestoAnual, setPresupuestoAnual] = useState('180000000');
  const [fondoPct, setFondoPct] = useState('1');
  const [moraPct, setMoraPct] = useState('1.5');
  const [grupoNiif, setGrupoNiif] = useState('3');
  const [periodoActual, setPeriodoActual] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [guardando, setGuardando] = useState(false);

  const esSuperAdmin = user.rol === 'SUPER_ADMIN' || user.isSuperAdmin;
  const maxCupo = user.maxCopropiedades ?? 1;
  const usadas = DATOS.companies.length;
  const cupoLleno = !esSuperAdmin && usadas >= maxCupo;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await acciones.crearCopropiedad({
        nit: nit.trim(),
        razonSocial: razonSocial.trim(),
        nombreCorto: nombreCorto.trim(),
        ciudad: ciudad.trim() || undefined,
        direccion: direccion.trim() || undefined,
        presupuestoAnual: Number(presupuestoAnual) || 120000000,
        fondoImprevistosPct: Number(fondoPct) || 1,
        tasaMoraMensual: Number(moraPct) || 1.5,
        grupoNiif: Number(grupoNiif) === 2 ? 2 : 3,
        periodoActual: periodoActual.trim() || undefined,
      });
      if (res.ok) {
        toast({
          tone: 'ok',
          title: 'Copropiedad creada',
          msg: `${res.detalle} · Catálogo PUC ESAL inicializado`,
        });
        setNit('');
        setRazonSocial('');
        setNombreCorto('');
        setDireccion('');
        onClose();
      } else {
        toast({ tone: 'error', title: 'No se pudo crear', msg: res.error });
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Crear nueva copropiedad"
      subtitle="Se inicializará automáticamente con el catálogo PUC ESAL y rubros Ley 675"
      width={560}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--surface-2, #f8f8f7)',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            Plan <strong className="mono">{user.planNombre ?? 'PRUEBA'}</strong>
          </span>
          <Badge tone={cupoLleno ? 'warn' : 'ok'}>
            {esSuperAdmin ? 'Cupo ilimitado (SUPER_ADMIN)' : `Cupo: ${usadas} / ${maxCupo} copropiedades`}
          </Badge>
        </div>

        {cupoLleno && (
          <div
            style={{
              border: '1px solid #d97706',
              background: '#fffbeb',
              color: '#92400e',
              borderRadius: 6,
              padding: '9px 12px',
              fontSize: 12.5,
            }}
          >
            Alcanzaste el límite de tu plan ({usadas}/{maxCupo}). Contacta a Vértika para ampliar tu cupo de copropiedades.
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label className="field">
              <span>NIT</span>
              <input
                required
                value={nit}
                onChange={(e) => setNit(e.target.value)}
                placeholder="901.234.567-8"
                disabled={cupoLleno}
              />
            </label>
            <label className="field">
              <span>Nombre corto</span>
              <input
                required
                value={nombreCorto}
                onChange={(e) => setNombreCorto(e.target.value)}
                placeholder="Ej. Torres del Parque"
                disabled={cupoLleno}
              />
            </label>
          </div>

          <label className="field">
            <span>Razón social completa</span>
            <input
              required
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              placeholder="Conjunto Residencial Torres del Parque P.H."
              disabled={cupoLleno}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label className="field">
              <span>Ciudad</span>
              <input value={ciudad} onChange={(e) => setCiudad(e.target.value)} disabled={cupoLleno} />
            </label>
            <label className="field">
              <span>Dirección</span>
              <input
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Calle 100 # 15-20"
                disabled={cupoLleno}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <label className="field">
              <span>Presupuesto anual (COP)</span>
              <input
                type="number"
                min={1000000}
                step={100000}
                value={presupuestoAnual}
                onChange={(e) => setPresupuestoAnual(e.target.value)}
                disabled={cupoLleno}
              />
            </label>
            <label className="field">
              <span>Fondo imprevistos %</span>
              <input
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={fondoPct}
                onChange={(e) => setFondoPct(e.target.value)}
                disabled={cupoLleno}
              />
            </label>
            <label className="field">
              <span>Mora mensual %</span>
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={moraPct}
                onChange={(e) => setMoraPct(e.target.value)}
                disabled={cupoLleno}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <label className="field">
              <span>Grupo NIIF</span>
              <select value={grupoNiif} onChange={(e) => setGrupoNiif(e.target.value)} disabled={cupoLleno}>
                <option value="3">Grupo 3 (Microempresas / ESAL)</option>
                <option value="2">Grupo 2 (PyMES)</option>
              </select>
            </label>
            <label className="field">
              <span>Periodo inicial (AAAA-MM)</span>
              <input
                value={periodoActual}
                onChange={(e) => setPeriodoActual(e.target.value)}
                placeholder="2026-11"
                disabled={cupoLleno}
              />
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <Btn type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Btn>
            <Btn type="submit" variant="primary" disabled={guardando || cupoLleno}>
              {guardando ? 'Creando copropiedad…' : 'Crear copropiedad'}
            </Btn>
          </div>
        </form>
      </div>
    </Modal>
  );
}
