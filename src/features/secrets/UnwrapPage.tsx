import { useState } from 'react';
import { Eye, EyeOff, Link2Off, ShieldAlert } from 'lucide-react';
import { bao } from '@/lib/api';
import { mask } from '@/lib/format';
import {
  clearWrappingTokenFromUrl,
  wrappingTokenFromHash,
  type SharedSecretPayload,
} from '@/lib/wrapping';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/Extras';

/** A revealed field re-masks on its own; no value stays on screen indefinitely. */
function RevealedField({ name, value }: { name: string; value: unknown }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="secret-field" data-testid={`unwrap-field-${name}`}>
      <span className="secret-field__key" title={name}>{name}</span>
      <span className={`secret-field__value mono ${revealed ? '' : 'masked'}`}>
        {revealed ? (value === null || value === undefined ? '' : String(value)) : mask(value)}
      </span>
      <span className="secret-field__actions">
        <button
          className="icon-btn"
          onClick={() => setRevealed((open) => !open)}
          aria-label={revealed ? `Hide ${name}` : `Reveal ${name}`}
          title={revealed ? 'Hide' : 'Reveal'}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </div>
  );
}

/**
 * Standalone recipient view for a one-time share link. Lives outside AppShell
 * so a recipient does not need a console session: the short-lived wrapping
 * token in the URL fragment authenticates the single unwrap call.
 */
export function UnwrapPage() {
  const token = wrappingTokenFromHash();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [payload, setPayload] = useState<SharedSecretPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revealOnce() {
    if (!token) return;
    setPhase('loading');
    setError(null);
    try {
      const result = await bao.unwrapResponse(token);
      const body = result.data as unknown as SharedSecretPayload;
      setPayload({
        source: body?.source ?? 'unknown path',
        wrapped_at: body?.wrapped_at ?? '',
        data: body?.data && typeof body.data === 'object' ? body.data : {},
      });
      // Burn the token from the address bar so reloads/back-navigation cannot
      // retry it. The value is never written to storage or logged.
      clearWrappingTokenFromUrl();
      setPhase('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This link could not be unwrapped.');
      clearWrappingTokenFromUrl();
      setPhase('error');
    }
  }

  if (!token && phase === 'idle') {
    return (
      <div className="state" style={{ minHeight: '100vh' }}>
        <EmptyState icon={<Link2Off size={28} />} title="No share token in this link">
          This one-time link is missing its wrapping token. Ask the sender for a fresh link.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="state" style={{ minHeight: '100vh', padding: '2rem 1rem' }}>
      <div className="panel" style={{ width: 'min(640px, 100%)' }} data-testid="unwrap-page">
        <div className="panel__head"><ShieldAlert size={17} /><h3>One-time secret share</h3></div>
        <div className="panel__body grid" style={{ gap: '0.9rem', textAlign: 'left' }}>
          {phase === 'idle' && (
            <>
              <div className="notice warning small">
                This link is single-use. Revealing it consumes the wrapping token — it cannot be
                opened again, and it expires on its own.
              </div>
              <Button variant="primary" data-testid="unwrap-reveal" onClick={() => void revealOnce()}>
                Reveal once
              </Button>
            </>
          )}
          {phase === 'loading' && <p className="small muted">Unwrapping…</p>}
          {phase === 'error' && (
            <>
              <div className="notice error small">{error}</div>
              <p className="small muted">
                The link may have expired or already been used. Ask the sender for a fresh one.
              </p>
            </>
          )}
          {phase === 'done' && payload && (
            <>
              <div className="notice success small" data-testid="unwrap-success">
                Revealed once. The token has been consumed and removed from the address bar.
              </div>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 0.8rem', fontSize: '0.82rem' }}>
                <dt className="muted">Source</dt>
                <dd className="mono" style={{ margin: 0 }} data-testid="unwrap-source">{payload.source}</dd>
                <dt className="muted">Wrapped</dt>
                <dd style={{ margin: 0 }}>{payload.wrapped_at || 'unknown'}</dd>
                <dt className="muted">Fields</dt>
                <dd style={{ margin: 0 }}><Badge size="small" variant="primary">{Object.keys(payload.data).length}</Badge></dd>
              </dl>
              <div className="section-title">Secret fields</div>
              <div className="panel" style={{ background: 'var(--color-background)' }}>
                <div className="panel__body grid" style={{ gap: '0.3rem', padding: '0.5rem' }} data-testid="unwrap-fields">
                  {Object.entries(payload.data).map(([name, value]) => (
                    <RevealedField key={name} name={name} value={value} />
                  ))}
                  {Object.keys(payload.data).length === 0 && (
                    <p className="small muted">The wrapped payload contained no fields.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
