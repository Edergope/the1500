import React, { useEffect, useRef, useState } from 'react';
import type { ApiError, Locale } from '../lib/contracts/api';

interface Props {
  lang?: Locale;
  requiredRedirect?: boolean;
  linkExpired?: boolean;
}

type Problem = 'mail_off' | 'mail_down' | 'limited' | 'network' | 'other';

// Same rule as the server's, so a typing mistake is caught before any request. The server still decides.
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i;

export default function AuthPortal({ lang = 'en', requiredRedirect = false, linkExpired = false }: Props) {
  const es = lang === 'es';
  const prefix = es ? '/es' : '';
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ kind: Problem; code: string } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(linkExpired);
  const input = useRef<HTMLInputElement>(null);
  const sentTitle = useRef<HTMLHeadingElement>(null);

  // On a phone, focusing the field on arrival would cover the page with the keyboard.
  useEffect(() => {
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) input.current?.focus();
  }, []);
  useEffect(() => {
    if (sentTo) sentTitle.current?.focus();
  }, [sentTo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const value = email.trim();
    setProblem(null);
    if (!value || !EMAIL.test(value)) {
      setFieldError(
        !value
          ? es ? 'Escribe tu correo corporativo.' : 'Enter your work email.'
          : es ? 'Revisa el correo: debe tener la forma nombre@empresa.com.' : 'Check the address: it should look like name@company.com.'
      );
      input.current?.focus();
      return;
    }
    setFieldError(null);
    setExpiredNotice(false);
    setLoading(true);

    try {
      const response = await fetch(`/api/v1/auth/request-link?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({ email: value, locale: lang }),
      });
      if (response.ok) {
        setSentTo(value);
        return;
      }
      const data = (await response.json().catch(() => null)) as ApiError | null;
      const code = data?.error?.code || String(response.status);
      // The code stays out of the message, and is left for whoever is diagnosing this.
      console.warn('auth_request_failed', code);
      if (code === 'INVALID_EMAIL') {
        setFieldError(es ? 'Revisa el correo: debe tener la forma nombre@empresa.com.' : 'Check the address: it should look like name@company.com.');
        input.current?.focus();
      } else if (code === 'MAIL_NOT_CONFIGURED' || code === 'INVALID_BASE_URL') {
        setProblem({ kind: 'mail_off', code });
      } else if (code === 'MAIL_DELIVERY_UNAVAILABLE') {
        setProblem({ kind: 'mail_down', code });
      } else if (code === 'TOO_MANY_REQUESTS' || response.status === 429) {
        setProblem({ kind: 'limited', code });
      } else {
        setProblem({ kind: 'other', code });
      }
    } catch {
      console.warn('auth_request_failed', 'NETWORK');
      setProblem({ kind: 'network', code: 'NETWORK' });
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    setSentTo(null);
    setEmail('');
    requestAnimationFrame(() => input.current?.focus());
  }

  const problemText: Record<Problem, [string, string]> = {
    mail_off: es
      ? ['El acceso por correo aún no está activo aquí', 'Este entorno de pruebas todavía no puede enviar correos, así que no se envió ningún enlace.']
      : ['Email sign-in is not active here yet', 'This test environment cannot send email yet, so no link was sent.'],
    mail_down: es
      ? ['No pudimos enviar el enlace', 'El servicio de correo no está disponible en este momento y no salió ningún mensaje. Inténtalo de nuevo en unos minutos.']
      : ['We could not send the link', 'The email service is unavailable right now and no message went out. Try again in a few minutes.'],
    limited: es
      ? ['Demasiados intentos', 'Espera unos minutos antes de pedir otro enlace.']
      : ['Too many attempts', 'Wait a few minutes before asking for another link.'],
    network: es
      ? ['Sin conexión con THE1500', 'No pudimos comunicarnos con el servicio. Revisa tu conexión e inténtalo de nuevo.']
      : ['Could not reach THE1500', 'We could not contact the service. Check your connection and try again.'],
    other: es
      ? ['No pudimos procesar la solicitud', 'No se envió ningún enlace. Inténtalo de nuevo en unos minutos.']
      : ['We could not process the request', 'No link was sent. Try again in a few minutes.'],
  };

  if (sentTo) {
    return (
      <div className="auth-panel auth-sent" role="status">
        <span className="auth-sent-mark" aria-hidden="true"></span>
        <h1 ref={sentTitle} tabIndex={-1}>{es ? 'Revisa tu correo' : 'Check your email'}</h1>
        <p>
          {es ? 'Si ' : 'If '}
          <strong>{sentTo}</strong>
          {es
            ? ' puede recibir correo, te enviamos un enlace de acceso. Funciona una sola vez y vence en 15 minutos.'
            : ' can receive email, we sent it a sign-in link. It works once and expires in 15 minutes.'}
        </p>
        <p className="auth-fine">
          {es
            ? 'Al abrirlo verás una confirmación antes de entrar. Si no llega, revisa el correo no deseado.'
            : 'Opening it shows a confirmation before you enter. If it does not arrive, check your spam folder.'}
        </p>
        <button type="button" className="auth-text-button" onClick={startOver}>
          {es ? 'Usar otro correo' : 'Use a different email'}
        </button>
      </div>
    );
  }

  return (
    <div className="auth-panel">
      {expiredNotice && (
        <div className="auth-note auth-note-warn" role="alert">
          <strong>{es ? 'Ese enlace ya no sirve' : 'That link no longer works'}</strong>
          <span>{es ? 'Ya se usó o venció. Pide uno nuevo aquí abajo.' : 'It was already used or has expired. Ask for a new one below.'}</span>
        </div>
      )}
      {requiredRedirect && !expiredNotice && (
        <div className="auth-note" role="status">
          <span>{es ? 'Inicia sesión para entrar a tu cuenta y gestionar tu empresa.' : 'Sign in to open your account and manage your company.'}</span>
        </div>
      )}

      <h1>{es ? 'Inicia sesión en THE1500' : 'Sign in to THE1500'}</h1>
      <p className="auth-lead">
        {es
          ? 'Sin contraseña: escribe tu correo corporativo y te enviamos un enlace de un solo uso, válido por 15 minutos.'
          : 'No password: enter your work email and we send you a one-time link, valid for 15 minutes.'}
      </p>

      <form id="login" method="post" action="/api/v1/auth/request-link" onSubmit={handleSubmit} noValidate>
        <label htmlFor="auth-email-input">{es ? 'Correo corporativo' : 'Work email'}</label>
        <input
          ref={input}
          id="auth-email-input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'auth-email-error' : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldError) setFieldError(null);
          }}
          placeholder={es ? 'nombre@tuempresa.com' : 'name@yourcompany.com'}
        />
        {fieldError && <p id="auth-email-error" className="auth-field-error" role="alert">{fieldError}</p>}

        <button type="submit" className="btn-primary auth-submit" disabled={loading} aria-busy={loading}>
          {loading && <span className="auth-spinner" aria-hidden="true"></span>}
          {loading ? (es ? 'Enviando enlace…' : 'Sending link…') : es ? 'Enviar enlace de acceso' : 'Send sign-in link'}
        </button>
      </form>

      {problem && (
        <div className={`auth-note ${problem.kind === 'mail_off' ? '' : 'auth-note-error'}`} role="alert" data-reason={problem.code}>
          <strong>{problemText[problem.kind][0]}</strong>
          <span>{problemText[problem.kind][1]}</span>
        </div>
      )}

      <p className="auth-fine">
        {es
          ? '¿Primera vez? Este mismo paso crea tu cuenta. Después podrás registrar tu empresa. '
          : 'First time here? This same step creates your account. You can then register your company. '}
        <a href={`${prefix}/unirse`}>{es ? 'Cómo unirse' : 'How to join'}</a>
      </p>
    </div>
  );
}
