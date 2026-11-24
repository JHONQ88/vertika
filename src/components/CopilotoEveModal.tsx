import { useState } from 'react';
import { useEveAgent } from 'eve/react';
import { activeTurn, openInteractions } from 'eve/events';
import type { Copropiedad } from '../domain/types';
import { fmtPeriodo } from '../domain/format';
import { getAuthToken } from '../api';
import { acciones } from '../store';
import { Badge, Btn, Modal } from './ui';

function formatAgentError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);
  if (/429|rate\s*limit|quota|resource_exhausted/i.test(raw)) {
    return 'Límite temporal de cuota de IA alcanzado (429). Intenta de nuevo en 1 minuto; el motor contable determinista (Bandeja, F6, F10, Cartera y Cierre) sigue funcionando con normalidad.';
  }
  return raw;
}

const TOOL_TONE = (state: string): 'ok' | 'error' | 'warn' | 'info' => {
  if (state === 'completed') return 'ok';
  if (state === 'failed' || state === 'rejected' || state === 'cancelled') return 'error';
  if (state === 'approval' || state === 'blocked') return 'warn';
  return 'info';
};

export function CopilotoEveModal({
  empresa,
  periodo,
  vistaActual,
  onClose,
}: {
  empresa: Copropiedad;
  periodo: string;
  vistaActual: string;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const agent = useEveAgent({
    headers: (): Readonly<Record<string, string>> => {
      const token = getAuthToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    prepareSend: (turn) => ({
      ...turn,
      clientContext: {
        companyId: empresa.id,
        companyName: empresa.nombreCorto,
        period: periodo,
        activeView: vistaActual,
      },
    }),
    onFinish: () => {
      void acciones.sincronizar();
    },
  });

  const isResuming = agent.status === 'resuming';
  const isBusy = agent.status === 'busy';
  const hasActiveTurn = activeTurn(agent.view) !== undefined;
  const pendingApprovals = openInteractions(agent.view).filter(
    (item) => item.request.kind !== 'sign-in' && item.answer === undefined,
  );

  const sugerencias = [
    `Dame un resumen del estado actual de ${empresa.nombreCorto} (${empresa.id}) en ${periodo} y confirma si el balance de prueba cuadra.`,
    `En ${empresa.nombreCorto} (${empresa.id}) calcula retenciones con el motor y valida un borrador de honorarios contables en ${periodo} por $2.500.000.`,
    `Lista las cuentas PUC ESAL de gastos y retenciones disponibles en ${empresa.nombreCorto} (${empresa.id}).`,
  ];

  const enviar = (texto: string) => {
    const clean = texto.trim();
    if (!clean || isResuming) return;
    setInput('');
    void agent.send(clean);
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Copiloto Contable Eve IA"
      subtitle={`${empresa.nombreCorto} · ${fmtPeriodo(periodo)} · Conectado al motor determinista Rust`}
      width={720}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge tone={isBusy ? 'info' : 'ok'}>
              {isResuming
                ? 'Reconectando…'
                : isBusy
                  ? 'Analizando…'
                  : 'Listo · Solo borrador PENDIENTE'}
            </Badge>
            <small className="mono" style={{ color: 'var(--ink-3)' }}>
              Regla de oro: no asienta en firme
            </small>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {hasActiveTurn && (
              <Btn size="xs" variant="danger" type="button" onClick={() => void agent.cancel()}>
                Detener
              </Btn>
            )}
            <Btn
              size="xs"
              variant="ghost"
              type="button"
              onClick={() => agent.newSession()}
              disabled={agent.messages.length === 0 && !isBusy}
            >
              Nueva sesión
            </Btn>
          </div>
        </div>

        <div
          style={{
            minHeight: 260,
            maxHeight: 380,
            overflowY: 'auto',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 12,
            background: 'var(--surface-2, #f8fafc)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {agent.messages.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p className="card-note" style={{ margin: 0 }}>
                Pregunta sobre saldos, PUC ESAL, comprobantes o pídeme preparar un pre-asiento con cálculo
                determinista de retenciones. Prueba una consulta rápida:
              </p>
              {sugerencias.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  disabled={isResuming}
                  style={{
                    textAlign: 'left',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    background: 'var(--surface, #ffffff)',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--ink-1)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            agent.messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: '90%',
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: isUser ? 'var(--accent, #0f766e)' : 'var(--surface, #ffffff)',
                    color: isUser ? '#ffffff' : 'var(--ink-1)',
                    border: isUser ? 'none' : '1px solid var(--line)',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      opacity: 0.75,
                      marginBottom: 4,
                      fontWeight: 600,
                    }}
                  >
                    {isUser ? 'Contador / Usuario' : 'Eve IA Contable'}
                  </div>
                  {msg.parts.map((part, idx) => {
                    if (part.type === 'text') {
                      return (
                        <div
                          key={part.id ?? idx}
                          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                        >
                          {part.text}
                        </div>
                      );
                    }
                    if (part.type === 'tool') {
                      return (
                        <div
                          key={part.callId}
                          style={{ margin: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Badge tone={TOOL_TONE(part.state)}>
                            {part.label || part.name} · {part.state}
                          </Badge>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              );
            })
          )}
        </div>

        {pendingApprovals.map(({ interactionId, request }) => (
          <div
            key={interactionId}
            style={{
              border: '1px solid #f59e0b',
              background: '#fffbeb',
              borderRadius: 10,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <strong style={{ fontSize: 13, color: '#92400e' }}>
              {request.kind === 'approval' ? 'Confirmación requerida' : 'Pregunta del agente'}
            </strong>
            <p style={{ margin: 0, fontSize: 13, color: '#78350f' }}>{request.prompt}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {request.options?.map((option, idx) => (
                <Btn
                  key={option.id}
                  size="sm"
                  type="button"
                  variant={idx === 0 ? 'primary' : 'outline'}
                  disabled={isResuming}
                  onClick={() =>
                    void agent
                      .respond([{ interactionId, optionId: option.id }])
                      .then(() => {
                        window.setTimeout(() => {
                          void acciones.sincronizar();
                        }, 1200);
                      })
                  }
                >
                  {option.label}
                </Btn>
              ))}
            </div>
          </div>
        ))}

        {agent.error !== undefined && agent.error !== null && (
          <div
            style={{
              border: '1px solid #ef4444',
              background: '#fef2f2',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12.5,
              color: '#991b1b',
            }}
          >
            <strong>Error de Eve:</strong> {formatAgentError(agent.error)}
            <div style={{ marginTop: 4, opacity: 0.9 }}>
              Si faltan credenciales del modelo en local, ejecuta <span className="mono">npm exec -- eve login</span>{' '}
              o define <span className="mono">OPENAI_API_KEY</span> / <span className="mono">AI_GATEWAY_API_KEY</span>{' '}
              antes de iniciar <span className="mono">npm run dev</span>.
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(input);
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Escribe tu consulta contable para ${empresa.nombreCorto}…`}
            disabled={isResuming}
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              fontSize: 13.5,
            }}
          />
          <Btn
            type="submit"
            variant="primary"
            icon="spark"
            disabled={isResuming || !input.trim()}
          >
            Enviar
          </Btn>
        </form>
      </div>
    </Modal>
  );
}
