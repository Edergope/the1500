import React, { useState } from 'react';
import type { ApiError, Locale } from '../lib/contracts/api';

interface Props {
  lang?: Locale;
  requiredRedirect?: boolean;
}

export default function AuthPortal({ lang = 'en', requiredRedirect = false }: Props) {
  const es = lang === 'es';
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusKind, setStatusKind] = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setStatusKind('idle');
    setStatusMessage('');
    setErrorCode(null);

    try {
      const response = await fetch(`/api/v1/auth/request-link?lang=${lang}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Locale': lang,
        },
        body: JSON.stringify({ email: email.trim(), locale: lang }),
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        setStatusKind('success');
        setStatusMessage(
          es
            ? 'Solicitud recibida. Si la dirección es válida, enviaremos un enlace de acceso de un solo uso válido por 15 minutos.'
            : 'Check your inbox for a sign-in link. One-time links remain valid for 15 minutes.'
        );
      } else {
        const apiErr = data as ApiError | null;
        setStatusKind('error');
        setErrorCode(apiErr?.error?.code || String(response.status));
        setStatusMessage(
          apiErr?.error?.message ||
            (es
              ? 'No se pudo enviar el enlace. El servicio de correo puede no estar configurado en este entorno.'
              : 'Unable to send a link. Email service may not be configured.')
        );
      }
    } catch {
      setStatusKind('error');
      setStatusMessage(
        es ? 'No se pudo conectar con el servicio de autenticación.' : 'Unable to reach the sign-in service.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: '520px', margin: '0 auto' }}>
      {requiredRedirect && (
        <div className="notice" style={{ marginBottom: '1.25rem' }}>
          {es
            ? 'Inicia sesión con tu correo corporativo para acceder al portal de titular y gestionar tu empresa.'
            : 'Please sign in with your corporate email to access the member portal and manage your company.'}
        </div>
      )}

      <div className="surface-card surface-card-gold">
        <div className="eyebrow">{es ? 'ACCESO SIN CONTRASEÑA' : 'PASSWORDLESS CORPORATE ACCESS'}</div>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
          {es ? 'Iniciar sesión en THE1500' : 'Sign in to THE1500'}
        </h1>
        <p style={{ fontSize: '0.94rem', marginBottom: '1.5rem' }}>
          {es
            ? 'Ingresa el correo electrónico corporativo de tu empresa. Recibirás un enlace de verificación de un solo uso válido durante 15 minutos.'
            : 'Enter your corporate business email. We will issue a single-use verification link valid for 15 minutes.'}
        </p>

        <form id="login" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label htmlFor="auth-email-input">
              {es ? 'Correo electrónico corporativo' : 'Business email address'}
            </label>
            <input
              id="auth-email-input"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={es ? 'titular@tuempresa.com' : 'owner@yourcompany.com'}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%' }}>
            {loading
              ? es
                ? 'Solicitando enlace…'
                : 'Requesting sign-in link…'
              : es
                ? 'Enviar enlace de acceso'
                : 'Send sign-in link'}
          </button>
        </form>

        <div
          id="status"
          role="status"
          aria-live="polite"
          style={{ marginTop: statusMessage ? '1.15rem' : 0 }}
        >
          {statusMessage && (
            <div className={`notice ${statusKind === 'error' ? 'notice-error' : 'notice-success'}`} style={{ margin: 0 }}>
              <div style={{ fontWeight: 600 }}>{statusMessage}</div>
              {errorCode && (
                <div className="mono" style={{ fontSize: '0.76rem', marginTop: '0.3rem', opacity: 0.85 }}>
                  Code: {errorCode}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: '1.5rem',
            paddingTop: '1.1rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.83rem',
            color: 'var(--text-muted)',
          }}
        >
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.83rem' }}>
            {es
              ? '¿Primera vez en THE1500? El mismo flujo crea tu cuenta verificada. Una vez dentro de Mi Cuenta podrás registrar los datos de tu empresa y reservar una posición.'
              : 'New to THE1500? The same passwordless flow creates your verified account. Once signed in, you can register your company and reserve a position.'}
          </p>
          <p style={{ margin: 0, fontSize: '0.78rem' }}>
            {es
              ? 'Protección anti-escáneres: abrir el enlace muestra una pantalla de confirmación antes de consumir el token.'
              : 'Scanner-safe verification: opening the link displays an explicit confirmation step before consuming the token.'}
          </p>
        </div>
      </div>
    </div>
  );
}
