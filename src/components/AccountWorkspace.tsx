import React, { useEffect, useState, useCallback } from 'react';
import type {
  ApiError,
  CanonicalProfile,
  CheckoutResponse,
  CompanyStatusResponse,
  DraftResponse,
  HoldResponse,
  InventorySummary,
  LegalBasis,
  Locale,
  MeResponse,
  PremiumContactPreference,
} from '../lib/contracts/api';
import {
  formatDate,
  formatPosition,
  formatUsdCents,
  identityStateLabel,
  onboardingStatusLabel,
  provenanceLabel,
  publicationStatusLabel,
} from '../ui/i18n';

interface Props {
  initialEmail: string;
  lang?: Locale;
}

interface ProfileGetResponse {
  companyId: string;
  version: number;
  canonical: CanonicalProfile;
  preview: unknown;
  previewEs: unknown;
  approvedAt: string | null;
  publishedAt: string | null;
  reviewStatus: 'not_required' | 'pending' | 'cleared' | 'rejected';
  generation: {
    mode?: 'llm' | 'deterministic';
    kind?: 'llm' | 'deterministic';
    reason?: string | null;
    provider?: string | null;
    model?: string | null;
  } | null;
  contentDigest: string;
}

function generateIdempotencyKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return `${prefix}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export default function AccountWorkspace({ initialEmail, lang = 'en' }: Props) {
  const es = lang === 'es';

  const [me, setMe] = useState<MeResponse | null>(null);
  const [stats, setStats] = useState<InventorySummary | null>(null);
  const [founderInvites, setFounderInvites] = useState<
    Array<{ invitationId: string; companyId: string; companyName: string; expiresAt: string }>
  >([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companyStatus, setCompanyStatus] = useState<CompanyStatusResponse | null>(null);
  const [activeProfile, setActiveProfile] = useState<ProfileGetResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [globalBanner, setGlobalBanner] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null);

  // Registration Form State
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [regName, setRegName] = useState('');
  const [regCountry, setRegCountry] = useState('US');
  const [regIndustry, setRegIndustry] = useState('');
  const [regWebsite, setRegWebsite] = useState('');
  const [regAuthority, setRegAuthority] = useState(false);
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Hold & Checkout State
  const [holdData, setHoldData] = useState<HoldResponse | null>(null);
  const [checkoutData, setCheckoutData] = useState<CheckoutResponse | null>(null);
  const [acceptCheckoutTerms, setAcceptCheckoutTerms] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const [checkoutReturnedPolling, setCheckoutReturnedPolling] = useState(false);

  // Founder Accept State
  const [acceptFounderTerms, setAcceptFounderTerms] = useState<Record<string, boolean>>({});
  const [founderBusy, setFounderBusy] = useState(false);

  // Profile Editor State
  const [declLang, setDeclLang] = useState<'en' | 'es'>(lang);
  const [declDesc, setDeclDesc] = useState('');
  const [declDescEs, setDeclDescEs] = useState('');
  const [declServices, setDeclServices] = useState('');
  const [declAudiences, setDeclAudiences] = useState('');
  const [declProblem, setDeclProblem] = useState('');
  const [declSolution, setDeclSolution] = useState('');
  const [declCountries, setDeclCountries] = useState('US');
  const [declFoundedYear, setDeclFoundedYear] = useState('');
  const [declAdvantages, setDeclAdvantages] = useState('');
  const [declCertifications, setDeclCertifications] = useState('');
  const [declPublishAdv, setDeclPublishAdv] = useState(false);
  const [declPublishCert, setDeclPublishCert] = useState(false);
  const [declCorrectionNote, setDeclCorrectionNote] = useState('');
  const [declConsent, setDeclConsent] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [acceptDisclosure, setAcceptDisclosure] = useState(false);

  // Holder Requests / Reactivation / Final Notice / Premium / Team State
  const [finalNoticeReply, setFinalNoticeReply] = useState('');
  const [reqKind, setReqKind] = useState<'withdrawal' | 'cancellation'>('withdrawal');
  const [reqReason, setReqReason] = useState('');
  const [reqLegalBasis, setReqLegalBasis] = useState<'' | LegalBasis>('');
  const [premiumMessage, setPremiumMessage] = useState('');
  const [premiumPref, setPremiumPref] = useState<PremiumContactPreference>('no_preference');
  const [memberEmail, setMemberEmail] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const loadAccountOverview = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, statsRes, invRes] = await Promise.all([
        fetch(`/api/v1/auth/me?lang=${lang}`, { headers: { 'X-Locale': lang } }),
        fetch(`/api/v1/public/stats?lang=${lang}`, { headers: { 'X-Locale': lang } }),
        fetch(`/api/v1/me/founder-invitations?lang=${lang}`, { headers: { 'X-Locale': lang } }),
      ]);

      if (meRes.ok) {
        const meJson = (await meRes.json()) as MeResponse;
        setMe(meJson);
        if (meJson.companies.length > 0) {
          setSelectedCompanyId((prev) => prev || meJson.companies[0]!.id);
          setShowRegisterForm(false);
        } else {
          setShowRegisterForm(true);
        }
      }
      if (statsRes.ok) {
        setStats((await statsRes.json()) as InventorySummary);
      }
      if (invRes.ok) {
        const invJson = (await invRes.json()) as { invitations?: typeof founderInvites };
        setFounderInvites(invJson.invitations || []);
      }
    } catch {
      setGlobalBanner({
        kind: 'error',
        text: es ? 'No se pudo cargar la información de la cuenta.' : 'Unable to load account overview.',
      });
    } finally {
      setLoading(false);
    }
  }, [lang, es]);

  const loadCompanyDetails = useCallback(
    async (companyId: string) => {
      try {
        const res = await fetch(`/api/v1/me/company?companyId=${encodeURIComponent(companyId)}&lang=${lang}`, {
          headers: { 'X-Locale': lang },
        });
        if (!res.ok) return;
        const statusJson = (await res.json()) as CompanyStatusResponse;
        setCompanyStatus(statusJson);

        if (statusJson.profileVersions && statusJson.profileVersions.length > 0) {
          const latestVersion = Math.max(...statusJson.profileVersions.map((v) => v.version));
          const profRes = await fetch(
            `/api/v1/me/company/profile?companyId=${encodeURIComponent(companyId)}&version=${latestVersion}&lang=${lang}`,
            { headers: { 'X-Locale': lang } }
          );
          if (profRes.ok) {
            const profJson = (await profRes.json()) as ProfileGetResponse;
            setActiveProfile(profJson);
          } else {
            setActiveProfile(null);
          }
        } else {
          setActiveProfile(null);
        }
      } catch {
        // ignore transient fetch errors
      }
    },
    [lang]
  );

  useEffect(() => {
    loadAccountOverview();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('checkout') === 'returned') {
        setCheckoutReturnedPolling(true);
      }
    }
  }, [loadAccountOverview]);

  useEffect(() => {
    if (selectedCompanyId) {
      loadCompanyDetails(selectedCompanyId);
    }
  }, [selectedCompanyId, loadCompanyDetails]);

  // Poll GET /me/company when returning from Stripe until position appears
  useEffect(() => {
    if (!checkoutReturnedPolling || !selectedCompanyId) return;
    if (companyStatus?.position) {
      setCheckoutReturnedPolling(false);
      setGlobalBanner({
        kind: 'success',
        text: es
          ? `Pago confirmado y posición ${formatPosition(companyStatus.position.position)} adjudicada.`
          : `Payment confirmed and position ${formatPosition(companyStatus.position.position)} allocated.`,
      });
      return;
    }
    const timer = setInterval(() => {
      loadCompanyDetails(selectedCompanyId);
    }, 3500);
    return () => clearInterval(timer);
  }, [checkoutReturnedPolling, selectedCompanyId, companyStatus?.position, loadCompanyDetails, es]);

  // Countdown for active reservation (20 minutes)
  useEffect(() => {
    const expiresIso = checkoutData?.reservationExpiresAt || holdData?.hold?.expiresAt || companyStatus?.activeHold?.expiresAt;
    if (!expiresIso) {
      setCountdownSec(null);
      return;
    }
    const updateClock = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresIso).getTime() - Date.now()) / 1000));
      setCountdownSec(diff);
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [checkoutData, holdData, companyStatus?.activeHold]);

  async function handleSignOut(everywhere = false) {
    try {
      await fetch(everywhere ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
      });
      window.location.href = es ? '/es/login' : '/login';
    } catch {
      window.location.href = es ? '/es/login' : '/login';
    }
  }

  async function handleRegisterCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!regAuthority) {
      setGlobalBanner({
        kind: 'error',
        text: es
          ? 'Debes declarar tu autoridad para representar a la empresa.'
          : 'You must declare authority to represent the company.',
      });
      return;
    }
    setRegSubmitting(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/registrations?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({
          displayName: regName.trim(),
          country: regCountry.trim().toUpperCase(),
          industry: regIndustry.trim(),
          website: regWebsite.trim(),
          declareAuthority: true,
        }),
      });
      const data = (await res.json()) as { displayName: string; id: string } & ApiError;
      if (!res.ok) {
        const err = data as ApiError;
        setGlobalBanner({ kind: 'error', text: err?.error?.message || 'Registration failed' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text: es ? `Empresa "${data.displayName}" registrada correctamente.` : `Company "${data.displayName}" registered.`,
        });
        setRegName('');
        setRegIndustry('');
        setRegWebsite('');
        setShowRegisterForm(false);
        await loadAccountOverview();
        setSelectedCompanyId(data.id);
      }
    } catch {
      setGlobalBanner({ kind: 'error', text: es ? 'Error de red al registrar empresa.' : 'Network error registering company.' });
    } finally {
      setRegSubmitting(false);
    }
  }

  async function handleCreateHold() {
    if (!selectedCompanyId) return;
    setOrderBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/orders/hold?lang=${lang}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Locale': lang,
          'Idempotency-Key': generateIdempotencyKey('hold'),
        },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = data as ApiError;
        setGlobalBanner({ kind: 'error', text: err?.error?.message || 'Could not create reservation.' });
      } else {
        const holdResp = data as HoldResponse;
        setHoldData(holdResp);
        await loadCompanyDetails(selectedCompanyId);
      }
    } catch {
      setGlobalBanner({ kind: 'error', text: es ? 'Error al reservar cupo.' : 'Could not create reservation.' });
    } finally {
      setOrderBusy(false);
    }
  }

  async function handleStartCheckout() {
    const activeHoldId = holdData?.hold?.holdId || companyStatus?.activeHold?.holdId;
    if (!selectedCompanyId || !activeHoldId) return;
    if (!acceptCheckoutTerms) {
      setGlobalBanner({
        kind: 'error',
        text: es ? 'Debes aceptar los términos aplicables antes de continuar.' : 'You must accept the applicable terms.',
      });
      return;
    }
    setOrderBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/orders/checkout?lang=${lang}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Locale': lang,
          'Idempotency-Key': generateIdempotencyKey('chk'),
        },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          holdId: activeHoldId,
          acceptTerms: true,
          termsVersion: 'terms-2026-11',
          locale: lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = data as ApiError;
        setGlobalBanner({ kind: 'error', text: err?.error?.message || 'Checkout unavailable.' });
      } else {
        const chk = data as CheckoutResponse;
        setCheckoutData(chk);
      }
    } catch {
      setGlobalBanner({ kind: 'error', text: es ? 'Error al iniciar checkout.' : 'Failed to initialize checkout.' });
    } finally {
      setOrderBusy(false);
    }
  }

  async function handleAcceptFounderInvite(invitationId: string) {
    if (!acceptFounderTerms[invitationId]) {
      setGlobalBanner({
        kind: 'error',
        text: es ? 'Debes aceptar las condiciones de fundador.' : 'You must accept the founder terms.',
      });
      return;
    }
    setFounderBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/me/founder-invitations/accept?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({
          invitationId,
          acceptTerms: true,
          termsVersion: 'founder-2026-11',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Could not accept invitation.' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text: es
            ? 'Invitación aceptada. Pendiente de adjudicación administrativa formal del número de posición.'
            : 'Invitation accepted. Pending formal administrative position award.',
        });
        await loadAccountOverview();
        if (selectedCompanyId) await loadCompanyDetails(selectedCompanyId);
      }
    } finally {
      setFounderBusy(false);
    }
  }

  async function handleGenerateProfileDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId) return;
    if (!declConsent) {
      setGlobalBanner({
        kind: 'error',
        text: es
          ? 'Se requiere autorización expresa para procesar la información.'
          : 'Express authorization is required to process this information.',
      });
      return;
    }
    setProfileBusy(true);
    setGlobalBanner(null);
    try {
      const services = declServices
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const audiences = declAudiences
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const countries = declCountries
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const advantages = declAdvantages
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const certifications = declCertifications
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch(`/api/v1/me/company/profile?lang=${lang}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          language: declLang,
          description: declDesc.trim(),
          ...(declDescEs.trim() ? { descriptionEs: declDescEs.trim() } : {}),
          services,
          ...(audiences.length ? { audiences } : {}),
          ...(declProblem.trim() && declSolution.trim()
            ? { problemSolutions: [{ problem: declProblem.trim(), solution: declSolution.trim() }] }
            : {}),
          ...(countries.length ? { serviceCountries: countries } : {}),
          ...(declFoundedYear ? { foundedYear: Number(declFoundedYear) } : {}),
          ...(advantages.length ? { advantages } : {}),
          ...(certifications.length ? { certifications } : {}),
          publish: { advantages: declPublishAdv, certifications: declPublishCert },
          ...(declCorrectionNote.trim() ? { correctionNote: declCorrectionNote.trim() } : {}),
          consent: { processingAuthorized: true, documentVersion: 'consent-2026-11' },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Could not generate profile draft.' });
      } else {
        const draft = data as DraftResponse;
        setGlobalBanner({
          kind: 'success',
          text: es
            ? `Versión v${draft.version} estructurada (${draft.generation.mode}). Revisa y aprueba explícitamente antes de publicar.`
            : `Version v${draft.version} structured (${draft.generation.mode}). Review and explicitly approve before publishing.`,
        });
        await loadCompanyDetails(selectedCompanyId);
      }
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleApproveProfile() {
    if (!selectedCompanyId || !activeProfile) return;
    if (!acceptDisclosure) {
      setGlobalBanner({
        kind: 'error',
        text: es
          ? 'Debes marcar la casilla de aprobación expresa y divulgación pública.'
          : 'You must check the explicit approval and public disclosure box.',
      });
      return;
    }
    setProfileBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/me/company/approve?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          version: activeProfile.version,
          contentDigest: activeProfile.contentDigest,
          acceptPublicDisclosure: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Approval failed.' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text: es
            ? `Versión v${activeProfile.version} aprobada por el titular.`
            : `Profile version v${activeProfile.version} approved by owner.`,
        });
        await loadCompanyDetails(selectedCompanyId);
      }
    } finally {
      setProfileBusy(false);
    }
  }

  async function handlePublishProfile() {
    if (!selectedCompanyId || !activeProfile) return;
    setProfileBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/me/company/publish?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          version: activeProfile.version,
        }),
      });
      const data = (await res.json()) as { slotNumber: number } & ApiError;
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Publication failed.' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text: es
            ? `Perfil publicado en la posición #${data.slotNumber}.`
            : `Profile published at position #${data.slotNumber}.`,
        });
        await loadCompanyDetails(selectedCompanyId);
      }
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleReactivate() {
    if (!selectedCompanyId) return;
    setActionBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/me/company/reactivate?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Reactivation request failed.' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text: es
            ? 'Solicitud de reactivación enviada a administración.'
            : 'Reactivation request submitted for administrative review.',
        });
        await loadCompanyDetails(selectedCompanyId);
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function handleFinalNoticeResponse(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId || !finalNoticeReply.trim()) return;
    setActionBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/me/company/final-notice-response?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({ companyId: selectedCompanyId, message: finalNoticeReply.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Failed to send response.' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text: es ? 'Respuesta a la última notificación registrada.' : 'Response to final notice recorded.',
        });
        setFinalNoticeReply('');
        await loadCompanyDetails(selectedCompanyId);
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function handleCreateServiceRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId || !reqReason.trim()) return;
    setActionBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/me/company/requests?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          kind: reqKind,
          reason: reqReason.trim(),
          ...(reqKind === 'withdrawal' && reqLegalBasis ? { legalBasis: reqLegalBasis } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Request failed.' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text: es
            ? 'Solicitud registrada. La administración revisará y ejecutará la decisión.'
            : 'Request recorded. Administration will review and execute the decision.',
        });
        setReqReason('');
        await loadCompanyDetails(selectedCompanyId);
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSubmitPremiumRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId || premiumMessage.trim().length < 10) return;
    setActionBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/me/company/premium-request?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          message: premiumMessage.trim(),
          contactPreference: premiumPref,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Premium application failed.' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text: es
            ? 'Solicitud de admisión Premium recibida. Enviarla no reserva posición.'
            : 'Premium admission application received. Applying does not hold a position.',
        });
        setPremiumMessage('');
        await loadCompanyDetails(selectedCompanyId);
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function handleMemberAction(action: 'add' | 'remove') {
    if (!selectedCompanyId || !memberEmail.trim()) return;
    setActionBusy(true);
    setGlobalBanner(null);
    try {
      const res = await fetch(`/api/v1/me/company/members?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Locale': lang },
        body: JSON.stringify({ companyId: selectedCompanyId, email: memberEmail.trim(), action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalBanner({ kind: 'error', text: (data as ApiError)?.error?.message || 'Could not update member.' });
      } else {
        setGlobalBanner({
          kind: 'success',
          text:
            action === 'add'
              ? es
                ? `Editor ${memberEmail} añadido.`
                : `Editor ${memberEmail} added.`
              : es
                ? `Miembro ${memberEmail} eliminado.`
                : `Member ${memberEmail} removed.`,
        });
        setMemberEmail('');
      }
    } finally {
      setActionBusy(false);
    }
  }

  function formatCountdown(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const identityInfo = companyStatus ? identityStateLabel(companyStatus.company.identityState, lang) : null;
  const pubInfo = companyStatus ? publicationStatusLabel(companyStatus.company.publicationStatus, lang) : null;
  const onbInfo = companyStatus?.onboarding ? onboardingStatusLabel(companyStatus.onboarding.status, lang) : null;

  const isFormLockedByOnboarding =
    companyStatus?.onboarding &&
    ['suspended', 'reactivation_requested', 'admin_review', 'cancelled'].includes(companyStatus.onboarding.status);

  return (
    <div>
      {/* Top Account Session Bar */}
      <div
        className="surface-card"
        style={{
          marginTop: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '1.1rem 1.5rem',
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: '0.2rem' }}>
            {es ? 'PORTAL DE TITULAR VERIFICADO' : 'VERIFIED MEMBER PORTAL'}
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>
            {es ? 'Sesión activa como' : 'Authenticated as'}{' '}
            <span className="mono" style={{ color: 'var(--gold-primary)' }}>
              {me?.user?.email || initialEmail}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowRegisterForm((v) => !v)}
          >
            {showRegisterForm
              ? es
                ? 'Cerrar registro de empresa'
                : 'Close registration form'
              : es
                ? '+ Registrar nueva empresa'
                : '+ Register company'}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => handleSignOut(false)}>
            {es ? 'Cerrar sesión' : 'Sign out'}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => handleSignOut(true)}>
            {es ? 'Cerrar todas las sesiones' : 'Sign out everywhere'}
          </button>
        </div>
      </div>

      {globalBanner && (
        <div
          className={`notice ${
            globalBanner.kind === 'error' ? 'notice-error' : globalBanner.kind === 'success' ? 'notice-success' : ''
          }`}
          role="alert"
        >
          {globalBanner.text}
        </div>
      )}

      {checkoutReturnedPolling && !companyStatus?.position && (
        <div className="notice" role="status">
          <strong>
            {es
              ? 'Confirmando pago con el servidor (volver de Stripe no adjudica el cupo por sí mismo)…'
              : 'Confirming payment via server webhook (returning from Stripe alone does not allocate a position)…'}
          </strong>{' '}
          {es
            ? 'Consultando automáticamente GET /api/v1/me/company hasta que aparezca la posición confirmada.'
            : 'Polling GET /api/v1/me/company automatically until your confirmed position appears.'}
        </div>
      )}

      {/* Founder Invitations Banner */}
      {founderInvites.length > 0 && (
        <section className="surface-card surface-card-gold" aria-label={es ? 'Invitaciones de fundador' : 'Founder invitations'}>
          <div className="eyebrow">{es ? 'INVITACIÓN DE FUNDADOR PENDIENTE' : 'PENDING FOUNDER INVITATION'}</div>
          {founderInvites.map((inv) => (
            <div
              key={inv.invitationId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                paddingTop: '0.5rem',
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>{inv.companyName}</h3>
                <p className="muted" style={{ margin: '0.25rem 0 0 0' }}>
                  {es ? 'Vence el' : 'Expires on'} {formatDate(inv.expiresAt, lang)}.{' '}
                  {es
                    ? 'Aceptar la invitación requiere aceptar términos y queda pendiente de adjudicación formal por administración.'
                    : 'Accepting requires terms acceptance and remains pending formal administrative position award.'}
                </p>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.6rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(acceptFounderTerms[inv.invitationId])}
                    onChange={(e) =>
                      setAcceptFounderTerms((prev) => ({ ...prev, [inv.invitationId]: e.target.checked }))
                    }
                  />
                  <span>
                    {es
                      ? 'Acepto expresamente los términos de participación de fundador (founder-2026-11).'
                      : 'I explicitly accept the founder participation terms (founder-2026-11).'}
                  </span>
                </label>
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={founderBusy}
                onClick={() => handleAcceptFounderInvite(inv.invitationId)}
              >
                {es ? 'Aceptar invitación' : 'Accept invitation'}
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Company Registration Form */}
      {showRegisterForm && (
        <section className="surface-card surface-card-gold">
          <div className="eyebrow">{es ? 'ALTA DE EMPRESA' : 'COMPANY REGISTRATION'}</div>
          <h2 style={{ marginTop: 0 }}>
            {es ? 'Registrar una empresa en THE1500' : 'Register a company in THE1500'}
          </h2>
          <p className="muted">
            {es
              ? 'Si el dominio de tu correo coincide con el sitio web corporativo declarado, tu empresa queda validada y podrás reservar posición inmediatamente.'
              : 'If your sign-in email domain matches the declared corporate website, your company is validated and you can reserve a position immediately.'}
          </p>

          <form onSubmit={handleRegisterCompany} className="grid-2">
            <div>
              <label htmlFor="reg-name">{es ? 'Nombre comercial o razón social' : 'Company display name'}</label>
              <input
                id="reg-name"
                type="text"
                required
                maxLength={120}
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Acme Logistics LLC"
              />
            </div>

            <div>
              <label htmlFor="reg-country">{es ? 'País (código ISO de 2 letras)' : 'Country (2-letter ISO code)'}</label>
              <input
                id="reg-country"
                type="text"
                required
                maxLength={2}
                value={regCountry}
                onChange={(e) => setRegCountry(e.target.value.toUpperCase())}
                placeholder="US, CO, MX, ES..."
              />
            </div>

            <div>
              <label htmlFor="reg-industry">{es ? 'Sector o industria principal' : 'Primary industry / sector'}</label>
              <input
                id="reg-industry"
                type="text"
                required
                maxLength={80}
                value={regIndustry}
                onChange={(e) => setRegIndustry(e.target.value)}
                placeholder={es ? 'Logística marítima, Ciberseguridad...' : 'Ocean freight, Cybersecurity...'}
              />
            </div>

            <div>
              <label htmlFor="reg-website">{es ? 'Sitio web corporativo (https://...)' : 'Corporate website (https://...)'}</label>
              <input
                id="reg-website"
                type="url"
                required
                value={regWebsite}
                onChange={(e) => setRegWebsite(e.target.value)}
                placeholder="https://yourcompany.com"
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={regAuthority}
                  onChange={(e) => setRegAuthority(e.target.checked)}
                />
                <span>
                  {es
                    ? 'Declaro bajo mi responsabilidad que cuento con facultades suficientes para representar a esta empresa.'
                    : 'I declare that I hold sufficient authority to represent and bind this company.'}
                </span>
              </label>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="btn-primary" disabled={regSubmitting}>
                {regSubmitting
                  ? es
                    ? 'Registrando empresa…'
                    : 'Registering company…'
                  : es
                    ? 'Registrar empresa'
                    : 'Register company'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Company Switcher if user belongs to multiple companies */}
      {me && me.companies.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            flexWrap: 'wrap',
            margin: '1.25rem 0',
          }}
        >
          <span className="muted" style={{ fontSize: '0.84rem' }}>
            {es ? 'Empresas vinculadas:' : 'Linked companies:'}
          </span>
          {me.companies.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCompanyId(c.id)}
              className={selectedCompanyId === c.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            >
              <span>{c.displayName}</span>
              <span className="mono" style={{ opacity: 0.75, fontSize: '0.72rem' }}>
                ({c.role})
              </span>
            </button>
          ))}
        </div>
      )}

      {loading && <p className="muted">{es ? 'Cargando estado de la cuenta…' : 'Loading account status…'}</p>}

      {/* Active Company Workspace */}
      {companyStatus && (
        <div>
          {/* 1. Company Status & Slot Card */}
          <section className="surface-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '1rem',
                paddingBottom: '1.25rem',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {identityInfo && <span className={`badge badge-${identityInfo.tone}`}>{identityInfo.label}</span>}
                  {pubInfo && <span className={`badge badge-${pubInfo.tone}`}>{pubInfo.label}</span>}
                  <span className="badge badge-slate">{companyStatus.role === 'owner' ? (es ? 'Titular' : 'Owner') : (es ? 'Editor' : 'Editor')}</span>
                </div>
                <h2 style={{ margin: 0 }}>{companyStatus.company.displayName}</h2>
                <p className="muted" style={{ margin: '0.25rem 0 0 0' }}>
                  {companyStatus.company.industry || '—'} · {companyStatus.company.country} ·{' '}
                  {companyStatus.company.website && (
                    <a
                      href={
                        companyStatus.company.website.startsWith('http')
                          ? companyStatus.company.website
                          : `https://${companyStatus.company.website}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {companyStatus.company.website}
                    </a>
                  )}
                </p>
                {identityInfo && (
                  <p className="muted" style={{ margin: '0.35rem 0 0 0', fontSize: '0.83rem' }}>
                    {identityInfo.desc}
                  </p>
                )}
              </div>

              <div
                style={{
                  padding: '1rem 1.35rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-gold)',
                  textAlign: 'right',
                  minWidth: '210px',
                }}
              >
                <div className="mono muted" style={{ fontSize: '0.74rem' }}>
                  {es ? 'POSICIÓN EN THE1500' : 'THE1500 POSITION'}
                </div>
                {companyStatus.position ? (
                  <>
                    <div
                      className="mono"
                      style={{
                        fontSize: '1.9rem',
                        fontWeight: 800,
                        color: companyStatus.position.status === 'retired' ? 'var(--red)' : 'var(--gold-primary)',
                      }}
                    >
                      {formatPosition(companyStatus.position.position)}
                    </div>
                    <div className="mono muted" style={{ fontSize: '0.78rem' }}>
                      {companyStatus.position.status === 'retired'
                        ? es
                          ? 'Cupo retirado — No disponible'
                          : 'Position retired — Not available'
                        : es
                          ? `Tramo ${companyStatus.position.phase} · Adjudicado`
                          : `Tier ${companyStatus.position.phase} · Allocated`}
                    </div>
                  </>
                ) : companyStatus.founderInvitation ? (
                  <div style={{ fontSize: '0.9rem', color: 'var(--amber)', fontWeight: 600, marginTop: '0.25rem' }}>
                    {companyStatus.founderInvitation.status === 'accepted'
                      ? es
                        ? 'Invitación aceptada · Pendiente de adjudicación'
                        : 'Invitation accepted · Pending administrative award'
                      : es
                        ? 'Invitación pendiente de aceptación'
                        : 'Invitation awaiting acceptance'}
                  </div>
                ) : (
                  <div style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.25rem' }}>
                    {es ? 'Sin posición adjudicada' : 'No position allocated yet'}
                  </div>
                )}
              </div>
            </div>

            {companyStatus.company.publicationBlock && (
              <div className="notice notice-error" style={{ marginTop: '1rem' }}>
                <strong>{es ? 'Publicación bloqueada:' : 'Publication blocked:'}</strong>{' '}
                {companyStatus.company.publicationBlock}
              </div>
            )}

            {/* Onboarding Timelines & Final Notice */}
            {companyStatus.onboarding && (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.65rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>
                    {es ? 'Estado de incorporación:' : 'Onboarding status:'}
                  </strong>
                  {onbInfo && <span className={`badge badge-${onbInfo.tone}`}>{onbInfo.label}</span>}
                </div>

                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <div className="stat-tile">
                    <span className="muted">{es ? 'Plazo ordinario (15d)' : 'Initial form due (15d)'}</span>
                    <div className="mono" style={{ fontWeight: 600, marginTop: '0.2rem' }}>
                      {formatDate(companyStatus.onboarding.formDueAt, lang)}
                    </div>
                  </div>
                  <div className="stat-tile">
                    <span className="muted">{es ? 'Prórroga (30d)' : 'Extension due (30d)'}</span>
                    <div className="mono" style={{ fontWeight: 600, marginTop: '0.2rem' }}>
                      {formatDate(companyStatus.onboarding.extensionDueAt, lang)}
                    </div>
                  </div>
                  <div className="stat-tile">
                    <span className="muted">{es ? 'Límite reactivación (45d)' : 'Reactivation limit (45d)'}</span>
                    <div className="mono" style={{ fontWeight: 600, marginTop: '0.2rem' }}>
                      {formatDate(companyStatus.onboarding.reactivationDueAt, lang)}
                    </div>
                  </div>
                  {companyStatus.onboarding.reactivationFormDueAt && (
                    <div className="stat-tile">
                      <span className="muted">{es ? 'Plazo tras reactivación (15d)' : 'Reactivated form due (15d)'}</span>
                      <div className="mono" style={{ fontWeight: 600, color: 'var(--amber)', marginTop: '0.2rem' }}>
                        {formatDate(companyStatus.onboarding.reactivationFormDueAt, lang)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Reactivation States per §8 */}
                {companyStatus.onboarding.status === 'suspended' && (
                  <div className="notice" style={{ marginTop: '1rem' }}>
                    <p style={{ margin: '0 0 0.65rem 0' }}>
                      {es
                        ? 'Tu incorporación se encuentra suspendida tras el día 30. Puedes solicitar la reactivación hasta el día 45. Solicitarla no reabre el formulario automáticamente hasta que administración la apruebe.'
                        : 'Your onboarding is suspended past day 30. You may request reactivation until day 45. Requesting does not reopen the form until approved by administration.'}
                    </p>
                    <button type="button" className="btn-primary btn-sm" disabled={actionBusy} onClick={handleReactivate}>
                      {es ? 'Solicitar reactivación de incorporación' : 'Request onboarding reactivation'}
                    </button>
                  </div>
                )}

                {companyStatus.onboarding.status === 'reactivation_requested' && (
                  <div className="notice" style={{ marginTop: '1rem' }}>
                    {es
                      ? 'Tu solicitud de reactivación está siendo revisada por administración. El formulario permanece cerrado hasta su aprobación.'
                      : 'Your reactivation request is under review by administration. The profile form remains closed until approved.'}
                  </div>
                )}

                {(companyStatus.onboarding.status === 'reactivation_approved' ||
                  companyStatus.onboarding.status === 'reactivated') && (
                  <div className="notice notice-success" style={{ marginTop: '1rem' }}>
                    {es
                      ? `Reactivación aprobada. Cuentas con 15 días calendario hasta ${formatDate(
                          companyStatus.onboarding.reactivationFormDueAt,
                          lang
                        )} sin prórroga automática. No enviar el formulario nunca implica perder el cupo ni el dinero automáticamente: pasa a revisión individual.`
                      : `Reactivation approved. You have 15 calendar days until ${formatDate(
                          companyStatus.onboarding.reactivationFormDueAt,
                          lang
                        )} with no automatic extension. Failing to submit never automatically forfeits your position or payment: it moves to individual review.`}
                  </div>
                )}

                {/* Final Notice per §8 */}
                {companyStatus.onboarding.finalNoticeSentAt && !companyStatus.onboarding.finalNoticeResponseAt && (
                  <div className="notice notice-error" style={{ marginTop: '1rem' }}>
                    <h4 style={{ margin: '0 0 0.35rem 0', color: 'var(--text-primary)' }}>
                      {es ? 'Última notificación recibida' : 'Final notice awaiting your response'}
                    </h4>
                    <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.88rem' }}>
                      {es
                        ? `Plazo de respuesta (7 días calendario): ${formatDate(
                            companyStatus.onboarding.finalNoticeDueAt,
                            lang
                          )}. El silencio por sí solo no cancela el servicio ni implica pérdida del dinero; administración revisará el caso.`
                        : `Response deadline (7 calendar days): ${formatDate(
                            companyStatus.onboarding.finalNoticeDueAt,
                            lang
                          )}. Silence alone does not cancel the service or forfeit your payment; administration reviews every case.`}
                    </p>
                    <form onSubmit={handleFinalNoticeResponse} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <textarea
                        rows={3}
                        required
                        minLength={3}
                        maxLength={1000}
                        value={finalNoticeReply}
                        onChange={(e) => setFinalNoticeReply(e.target.value)}
                        placeholder={
                          es
                            ? 'Explica tu situación o confirma tu intención de continuar con la estructuración (3–1000 caracteres)…'
                            : 'Explain your situation or confirm your intent to complete onboarding (3–1000 chars)…'
                        }
                      />
                      <div>
                        <button type="submit" className="btn-primary btn-sm" disabled={actionBusy}>
                          {es ? 'Enviar respuesta a la última notificación' : 'Submit response to final notice'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 2. Reservation & Purchase Section (when no position is allocated) */}
          {!companyStatus.position && !companyStatus.founderInvitation && companyStatus.role === 'owner' && (
            <section className="surface-card surface-card-gold">
              <div className="eyebrow">{es ? 'RESERVA Y ADJUDICACIÓN DE POSICIÓN' : 'POSITION RESERVATION & ALLOCATION'}</div>
              <h3 style={{ marginTop: 0 }}>
                {es ? 'Adquirir una posición numerada en THE1500' : 'Acquire a numbered position in THE1500'}
              </h3>
              <p className="muted">
                {es
                  ? 'El número de posición se asigna únicamente al confirmarse el pago. Una reserva temporal bloquea capacidad durante 20 minutos sin exponer número.'
                  : 'Your position number is assigned strictly upon payment confirmation. A temporary hold reserves capacity for 20 minutes without exposing a number.'}
              </p>

              {stats && stats.salesMode === 'premium_admission' ? (
                <div style={{ marginTop: '1rem' }}>
                  <div className="notice">
                    {es
                      ? 'Tramo 4 — Admisión Premium (posiciones 1351–1500). No existe checkout automático. Envía tu solicitud de admisión; enviarla no reserva posición y la reunión nunca es un requisito obligatorio.'
                      : 'Tier 4 — Premium Admission (positions 1351–1500). Automatic checkout is not available. Submit your admission application below; applying does not hold a position and a meeting is never a mandatory requirement.'}
                  </div>
                  {companyStatus.premiumRequest ? (
                    <div className="stat-tile" style={{ marginTop: '0.75rem' }}>
                      <span className="badge badge-gold mono">status: {companyStatus.premiumRequest.status}</span>
                      <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.88rem' }}>
                        {es ? 'Solicitud enviada el' : 'Application submitted on'}{' '}
                        {formatDate(companyStatus.premiumRequest.createdAt, lang)} (
                        {companyStatus.premiumRequest.contactPreference})
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmitPremiumRequest} style={{ display: 'grid', gap: '0.85rem', marginTop: '1rem' }}>
                      <div>
                        <label htmlFor="premium-msg">
                          {es ? 'Presentación de la empresa y motivo de solicitud (10–2000 caracteres)' : 'Company presentation & application note (10–2000 chars)'}
                        </label>
                        <textarea
                          id="premium-msg"
                          rows={3}
                          minLength={10}
                          maxLength={2000}
                          required
                          value={premiumMessage}
                          onChange={(e) => setPremiumMessage(e.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor="premium-pref">
                          {es ? 'Preferencia de contacto (opcional, reunión nunca obligatoria)' : 'Contact preference (optional, meeting never required)'}
                        </label>
                        <select
                          id="premium-pref"
                          value={premiumPref}
                          onChange={(e) => setPremiumPref(e.target.value as PremiumContactPreference)}
                        >
                          <option value="no_preference">{es ? 'Sin preferencia' : 'No preference'}</option>
                          <option value="email">{es ? 'Correo electrónico' : 'Email'}</option>
                          <option value="meeting">{es ? 'Reunión opcional' : 'Optional meeting'}</option>
                        </select>
                      </div>
                      <div>
                        <button type="submit" className="btn-primary" disabled={actionBusy}>
                          {es ? 'Enviar solicitud Premium' : 'Submit Premium application'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <div>
                  {!companyStatus.activeHold && !holdData ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={
                          orderBusy ||
                          !identityInfo?.canBuy ||
                          (stats !== null && !stats.checkoutOpen)
                        }
                        onClick={handleCreateHold}
                      >
                        {orderBusy
                          ? es
                            ? 'Reservando capacidad…'
                            : 'Reserving capacity…'
                          : es
                            ? 'Reservar cupo por 20 minutos'
                            : 'Hold a position for 20 minutes'}
                      </button>
                      {stats && (
                        <span className="mono muted" style={{ fontSize: '0.85rem' }}>
                          {stats.currentPriceUsdCents !== null
                            ? `${formatUsdCents(stats.currentPriceUsdCents, lang)} (${es ? 'antes de impuestos' : 'before tax'})`
                            : ''}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        marginTop: '1rem',
                        padding: '1.15rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-gold)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <div>
                          <span className="badge badge-amber mono">
                            {es ? 'RESERVA ACTIVA (SIN NÚMERO ASIGNADO AÚN)' : 'ACTIVE HOLD (NO POSITION NUMBER YET)'}
                          </span>
                        </div>
                        {countdownSec !== null && (
                          <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gold-primary)' }}>
                            ⏱ {formatCountdown(countdownSec)}
                          </div>
                        )}
                      </div>

                      <p className="muted" style={{ fontSize: '0.84rem', marginBottom: '0.85rem' }}>
                        {es
                          ? 'Advertencia: Tu reserva dura 20 minutos. La página de Stripe puede permanecer abierta hasta ~31 minutos (su mínimo técnico es 30m). Un pago realizado después de vencer la reserva de 20 minutos pasa a conciliación manual y puede ser reembolsado.'
                          : 'Notice: Your reservation lasts 20 minutes. The Stripe checkout session may stay open up to ~31 minutes (Stripe minimum is 30m). Payments completed after the 20-minute hold expires are reconciled by staff and may be refunded.'}
                      </p>

                      {holdData && holdData.checkoutEnabled === false ? (
                        <div className="notice">
                          {es
                            ? 'Los cobros están deshabilitados en este entorno. Tu reserva fue creada correctamente, pero no se redirigirá a pasarela de pago.'
                            : 'Payments are disabled in this environment. Your hold is active, so we will not send you to an external payment page.'}
                        </div>
                      ) : !checkoutData ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={acceptCheckoutTerms}
                              onChange={(e) => setAcceptCheckoutTerms(e.target.checked)}
                            />
                            <span>
                              {es
                                ? 'Acepto las condiciones de contratación y publicación por 12 meses (terms-2026-11).'
                                : 'I accept the terms of service and 12-month publication agreement (terms-2026-11).'}
                            </span>
                          </label>
                          <div>
                            <button type="button" className="btn-primary" disabled={orderBusy} onClick={handleStartCheckout}>
                              {orderBusy
                                ? es
                                  ? 'Preparando checkout…'
                                  : 'Preparing checkout…'
                                : es
                                  ? 'Continuar al checkout'
                                  : 'Proceed to checkout'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: '0.75rem' }}>
                          <div className="stats-grid" style={{ marginBottom: '0.85rem' }}>
                            <div className="stat-tile">
                              <span className="muted">{es ? 'Importe base' : 'Base amount'}</span>
                              <strong>{formatUsdCents(checkoutData.amount.baseUsdCents, lang)}</strong>
                            </div>
                            <div className="stat-tile">
                              <span className="muted">{es ? 'Impuestos' : 'Tax'}</span>
                              <strong style={{ fontSize: '1.1rem' }}>{checkoutData.amount.taxStatus}</strong>
                              <span className="muted" style={{ fontSize: '0.75rem' }}>
                                {es ? 'Modo de prueba (sandbox)' : 'Sandbox / test mode'}
                              </span>
                            </div>
                            <div className="stat-tile">
                              <span className="muted">{es ? 'Total' : 'Total'}</span>
                              <strong>{formatUsdCents(checkoutData.amount.totalMinor, lang)}</strong>
                            </div>
                          </div>
                          {checkoutData.checkoutUrl && (
                            <a href={checkoutData.checkoutUrl} className="btn-primary">
                              {es ? 'Abrir pasarela de pago (Modo Test) →' : 'Open Stripe Checkout (Test Mode) →'}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* 3. Semantic Profile Studio (when position is assigned or profile versions exist) */}
          {(companyStatus.position || activeProfile) && (
            <section className="surface-card">
              <div className="eyebrow">{es ? 'ESTUDIO DE PERFIL SEMÁNTICO' : 'SEMANTIC PROFILE STUDIO'}</div>
              <h3 style={{ marginTop: 0 }}>
                {es ? 'Declaración, Vista Previa, Aprobación y Publicación' : 'Declaration, Preview, Explicit Approval & Publication'}
              </h3>

              {/* Existing Profile Preview & Approval */}
              {activeProfile && (
                <div
                  style={{
                    padding: '1.25rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-strong)',
                    marginBottom: '1.5rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge badge-gold mono">v{activeProfile.version}</span>
                      {(() => {
                        const genMode = activeProfile.generation?.mode || activeProfile.generation?.kind || 'deterministic';
                        const isLlm = genMode === 'llm';
                        return (
                          <span className={`badge ${isLlm ? 'badge-blue' : 'badge-slate'} mono`}>
                            {!isLlm
                              ? es
                                ? 'Modo determinista — Sin texto de IA'
                                : 'Deterministic mode — No AI text present'
                              : es
                                ? `Estructurado con IA (${activeProfile.generation?.provider || 'LLM'})`
                                : `AI-structured (${activeProfile.generation?.provider || 'LLM'})`}
                          </span>
                        );
                      })()}
                      {activeProfile.reviewStatus !== 'not_required' && (
                        <span className="badge badge-slate mono">{es ? 'Revisión' : 'Review'}: {activeProfile.reviewStatus}</span>
                      )}
                    </div>
                    <div className="mono muted" style={{ fontSize: '0.75rem' }}>
                      {es ? 'Huella del contenido' : 'Content fingerprint'}: {activeProfile.contentDigest.slice(0, 20)}…
                    </div>
                  </div>

                  {activeProfile.reviewStatus === 'pending' && (
                    <div className="notice" style={{ marginBottom: '1rem' }}>
                      {es
                        ? 'Revisión pendiente: Este perfil requiere revisión por una persona de administración antes de poder publicarse.'
                        : 'Review pending: A human administrator must review this profile before it can be published.'}
                    </div>
                  )}

                  {activeProfile.canonical.unsupportedClaims && activeProfile.canonical.unsupportedClaims.length > 0 && (
                    <div className="notice notice-error" style={{ marginBottom: '1rem' }}>
                      <strong>{es ? 'Afirmaciones no corroboradas detectadas:' : 'Unsupported claims detected:'}</strong>
                      <ul style={{ margin: '0.4rem 0 0 1.1rem', padding: 0 }}>
                        {activeProfile.canonical.unsupportedClaims.map((c, i) => (
                          <li key={i}>
                            "{c.text}" — <span className="mono">{c.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid-2" style={{ marginBottom: '1rem' }}>
                    <div className="stat-tile">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span className="muted">{es ? 'Descripción (EN)' : 'Description (EN)'}</span>
                        {activeProfile.canonical.provenance?.descriptionEn && (
                          <span className="badge badge-blue" style={{ fontSize: '0.68rem' }}>
                            {provenanceLabel(activeProfile.canonical.provenance.descriptionEn.type, lang).label}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                        {activeProfile.canonical.descriptionEn || activeProfile.canonical.descriptionOriginal}
                      </p>
                    </div>

                    <div className="stat-tile">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span className="muted">{es ? 'Descripción (ES)' : 'Description (ES)'}</span>
                        {activeProfile.canonical.provenance?.descriptionEs && (
                          <span className="badge badge-blue" style={{ fontSize: '0.68rem' }}>
                            {provenanceLabel(activeProfile.canonical.provenance.descriptionEs.type, lang).label}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                        {activeProfile.canonical.descriptionEs || '—'}
                      </p>
                    </div>
                  </div>

                  {/* Everything else the approval makes public */}
                  <div className="stat-tile" style={{ marginBottom: '1rem', display: 'grid', gap: '0.6rem', fontSize: '0.88rem' }}>
                    <div>
                      <span className="muted">{es ? 'Servicios: ' : 'Services: '}</span>
                      {(es && activeProfile.canonical.servicesEs ? activeProfile.canonical.servicesEs : activeProfile.canonical.services)?.join(', ') || '—'}
                    </div>
                    <div>
                      <span className="muted">{es ? 'Audiencias: ' : 'Audiences: '}</span>
                      {(es && activeProfile.canonical.audiencesEs ? activeProfile.canonical.audiencesEs : activeProfile.canonical.audiences)?.join(', ') || '—'}
                    </div>
                    {(es && activeProfile.canonical.problemSolutionsEs ? activeProfile.canonical.problemSolutionsEs : activeProfile.canonical.problemSolutions)?.map((ps, i) => (
                      <div key={i}>
                        <span className="muted">{es ? 'Problema: ' : 'Problem: '}</span>
                        {ps.problem}
                        <br />
                        <span className="muted">{es ? 'Solución: ' : 'Solution: '}</span>
                        {ps.solution}
                      </div>
                    ))}
                    <div>
                      <span className="muted">{es ? 'Países de servicio: ' : 'Service countries: '}</span>
                      {activeProfile.canonical.serviceCountries?.join(', ') || '—'}
                    </div>
                    {activeProfile.canonical.publish?.advantages && activeProfile.canonical.advantages?.length > 0 && (
                      <div>
                        <span className="muted">{es ? 'Ventajas: ' : 'Advantages: '}</span>
                        {activeProfile.canonical.advantages.join(', ')}
                      </div>
                    )}
                    {activeProfile.canonical.publish?.certifications && activeProfile.canonical.certifications?.length > 0 && (
                      <div>
                        <span className="muted">{es ? 'Certificaciones: ' : 'Certifications: '}</span>
                        {activeProfile.canonical.certifications.join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Provenance Summary */}
                  <div style={{ marginBottom: '1rem' }}>
                    <div className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.4rem' }}>
                      {es ? 'De dónde sale cada dato:' : 'Where each detail comes from:'}
                    </div>
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                      {Object.entries(activeProfile.canonical.provenance || {}).map(([field, meta]) => {
                        const pInfo = provenanceLabel(meta.type, lang);
                        return (
                          <span key={field} className={`badge badge-${pInfo.tone} mono`} style={{ fontSize: '0.72rem' }}>
                            {field}: {pInfo.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Approval & Publication Controls */}
                  {companyStatus.role === 'owner' && (
                    <div
                      style={{
                        paddingTop: '1rem',
                        borderTop: '1px solid var(--border-subtle)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '1rem',
                      }}
                    >
                      {!activeProfile.approvedAt ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', flex: 1 }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={acceptDisclosure}
                              onChange={(e) => setAcceptDisclosure(e.target.checked)}
                            />
                            <span>
                              {es
                                ? 'Apruebo expresamente esta vista previa y autorizo su divulgación pública (la inactividad nunca constituye aprobación).'
                                : 'I explicitly approve this preview and authorize its public disclosure (inactivity never counts as approval).'}
                            </span>
                          </label>
                          <div>
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={profileBusy}
                              onClick={handleApproveProfile}
                            >
                              {es ? `Aprobar versión v${activeProfile.version}` : `Approve version v${activeProfile.version}`}
                            </button>
                          </div>
                        </div>
                      ) : !activeProfile.publishedAt ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                          <span className="badge badge-emerald">
                            {es ? 'Aprobado por el titular' : 'Approved by owner'} ({formatDate(activeProfile.approvedAt, lang)})
                          </span>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={profileBusy || activeProfile.reviewStatus === 'pending'}
                            onClick={handlePublishProfile}
                          >
                            {es ? 'Publicar perfil en el directorio' : 'Publish profile to directory'}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                          <span className="badge badge-emerald">
                            {es ? 'Publicado el' : 'Published on'} {formatDate(activeProfile.publishedAt, lang)}
                          </span>
                          <a
                            href={`${es ? '/es' : ''}/empresas/${companyStatus.company.slug}`}
                            className="btn-secondary btn-sm"
                          >
                            {es ? 'Ver ficha pública →' : 'View public profile →'}
                          </a>
                          <a
                            href={`/api/v1/me/company/export?companyId=${encodeURIComponent(selectedCompanyId!)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary btn-sm mono"
                          >
                            {es ? 'Exportar perfil semántico (JSON)' : 'Export semantic profile (JSON)'}
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isFormLockedByOnboarding && !activeProfile && (
                <div className="notice" style={{ margin: 0 }}>
                  {es
                    ? 'El formulario está cerrado mientras se resuelve el estado de incorporación indicado arriba.'
                    : 'The form is closed while the onboarding status shown above is resolved.'}
                </div>
              )}

              {/* Form to Submit or Update Profile Declaration */}
              {!isFormLockedByOnboarding && companyStatus.company.publicationStatus !== 'withdrawn' && (
                <form onSubmit={handleGenerateProfileDraft} style={{ display: 'grid', gap: '1rem' }}>
                  <h4 style={{ margin: 0 }}>
                    {activeProfile
                      ? es
                        ? 'Enviar nueva versión o corrección del perfil'
                        : 'Submit a new profile version or correction'
                      : es
                        ? 'Completar declaración estructurada de la empresa'
                        : 'Complete structured company declaration'}
                  </h4>

                  <div className="grid-2">
                    <div>
                      <label htmlFor="decl-desc">
                        {es ? 'Descripción de la actividad empresarial (obligatoria)' : 'Business description (required)'}
                      </label>
                      <textarea
                        id="decl-desc"
                        rows={3}
                        required
                        value={declDesc}
                        onChange={(e) => setDeclDesc(e.target.value)}
                        placeholder={
                          es
                            ? 'Describe con precisión qué hace tu empresa, para quién y cómo entrega valor…'
                            : 'Describe clearly what your company does, who it serves, and how it delivers value…'
                        }
                      />
                    </div>

                    <div>
                      <label htmlFor="decl-desc-es">
                        {es ? 'Descripción en español (opcional si la principal es inglés)' : 'Spanish description (optional)'}
                      </label>
                      <textarea
                        id="decl-desc-es"
                        rows={3}
                        value={declDescEs}
                        onChange={(e) => setDeclDescEs(e.target.value)}
                        placeholder="Descripción autorizada en español…"
                      />
                    </div>

                    <div>
                      <label htmlFor="decl-services">
                        {es ? 'Servicios principales (separados por coma, mín. 1)' : 'Core services (comma-separated, min 1)'}
                      </label>
                      <input
                        id="decl-services"
                        type="text"
                        required
                        value={declServices}
                        onChange={(e) => setDeclServices(e.target.value)}
                        placeholder="Ocean freight coordination, Shipment visibility"
                      />
                    </div>

                    <div>
                      <label htmlFor="decl-audiences">
                        {es ? 'Clientes / Audiencias objetivo (separados por coma)' : 'Target B2B audiences (comma-separated)'}
                      </label>
                      <input
                        id="decl-audiences"
                        type="text"
                        value={declAudiences}
                        onChange={(e) => setDeclAudiences(e.target.value)}
                        placeholder="Importers, Supply chain teams"
                      />
                    </div>

                    <div>
                      <label htmlFor="decl-problem">
                        {es ? 'Problema específico que resuelves' : 'Specific client problem solved'}
                      </label>
                      <input
                        id="decl-problem"
                        type="text"
                        value={declProblem}
                        onChange={(e) => setDeclProblem(e.target.value)}
                        placeholder="Importers lack shipment status visibility"
                      />
                    </div>

                    <div>
                      <label htmlFor="decl-solution">
                        {es ? 'Solución que aporta tu empresa' : 'How your company solves it'}
                      </label>
                      <input
                        id="decl-solution"
                        type="text"
                        value={declSolution}
                        onChange={(e) => setDeclSolution(e.target.value)}
                        placeholder="Consolidated container tracking updates"
                      />
                    </div>

                    <div>
                      <label htmlFor="decl-countries">
                        {es ? 'Países donde presta servicio (ISO-2 separados por coma)' : 'Service countries (comma-separated ISO-2)'}
                      </label>
                      <input
                        id="decl-countries"
                        type="text"
                        value={declCountries}
                        onChange={(e) => setDeclCountries(e.target.value)}
                        placeholder="US, CO, MX"
                      />
                    </div>

                    <div>
                      <label htmlFor="decl-year">{es ? 'Año de fundación (opcional)' : 'Founded year (optional)'}</label>
                      <input
                        id="decl-year"
                        type="number"
                        min={1800}
                        max={2026}
                        value={declFoundedYear}
                        onChange={(e) => setDeclFoundedYear(e.target.value)}
                        placeholder="2018"
                      />
                    </div>

                    <div>
                      <label htmlFor="decl-adv">
                        {es ? 'Ventajas declaradas (opcional, separadas por coma)' : 'Declared advantages (optional, comma-separated)'}
                      </label>
                      <input
                        id="decl-adv"
                        type="text"
                        value={declAdvantages}
                        onChange={(e) => setDeclAdvantages(e.target.value)}
                      />
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem', fontWeight: 400 }}>
                        <input
                          type="checkbox"
                          checked={declPublishAdv}
                          onChange={(e) => setDeclPublishAdv(e.target.checked)}
                        />
                        <span>{es ? 'Mostrar ventajas en la ficha pública' : 'Publish advantages on public profile'}</span>
                      </label>
                    </div>

                    <div>
                      <label htmlFor="decl-cert">
                        {es ? 'Certificaciones declaradas (opcional, separadas por coma)' : 'Declared certifications (optional, comma-separated)'}
                      </label>
                      <input
                        id="decl-cert"
                        type="text"
                        value={declCertifications}
                        onChange={(e) => setDeclCertifications(e.target.value)}
                      />
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem', fontWeight: 400 }}>
                        <input
                          type="checkbox"
                          checked={declPublishCert}
                          onChange={(e) => setDeclPublishCert(e.target.checked)}
                        />
                        <span>{es ? 'Mostrar certificaciones en la ficha pública' : 'Publish certifications on public profile'}</span>
                      </label>
                    </div>
                  </div>

                  {activeProfile && (
                    <div>
                      <label htmlFor="decl-correction">
                        {es ? 'Nota de corrección (opcional)' : 'Correction note (optional)'}
                      </label>
                      <input
                        id="decl-correction"
                        type="text"
                        value={declCorrectionNote}
                        onChange={(e) => setDeclCorrectionNote(e.target.value)}
                        placeholder={es ? 'Motivo del ajuste antes de aprobar…' : 'Reason for update…'}
                      />
                    </div>
                  )}

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={declConsent}
                      onChange={(e) => setDeclConsent(e.target.checked)}
                    />
                    <span>
                      {es
                        ? 'Autorizo expresamente el procesamiento de esta información empresarial para generar el perfil estructurado (consent-2026-11).'
                        : 'I expressly authorize processing this business declaration to generate the structured profile (consent-2026-11).'}
                    </span>
                  </label>

                  <div>
                    <button type="submit" className="btn-primary" disabled={profileBusy}>
                      {profileBusy
                        ? es
                          ? 'Estructurando perfil…'
                          : 'Structuring profile…'
                        : es
                          ? 'Generar vista previa del perfil'
                          : 'Generate profile preview'}
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          {/* 4. Team Members & Service Requests (Owner only) */}
          {companyStatus.role === 'owner' && (
            <div className="grid-2">
              {companyStatus.position?.status === 'assigned' && (
              <section className="surface-card" style={{ margin: 0 }}>
                <div className="eyebrow">{es ? 'SOLICITUDES DEL TITULAR' : 'HOLDER REQUESTS'}</div>
                <h3 style={{ marginTop: 0 }}>
                  {es ? 'Retiro de ficha o cancelación' : 'Profile withdrawal or cancellation'}
                </h3>
                <p className="muted" style={{ fontSize: '0.84rem' }}>
                  {es
                    ? 'Las solicitudes son revisadas y ejecutadas por administración. Un retiro ejecutado sobre un cupo publicado consume la posición definitivamente.'
                    : 'Requests are reviewed and executed by administration. Executing a withdrawal on a published profile permanently retires the position.'}
                </p>

                {companyStatus.requests.length > 0 && (
                  <div style={{ marginBottom: '1rem', display: 'grid', gap: '0.5rem' }}>
                    {companyStatus.requests.map((r) => (
                      <div key={r.id} className="stat-tile" style={{ padding: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="mono" style={{ fontWeight: 600 }}>
                            {r.kind} {r.legalBasis ? `(${r.legalBasis})` : ''}
                          </span>
                          <span className="badge badge-amber mono">{r.status}</span>
                        </div>
                        <div className="muted" style={{ fontSize: '0.76rem', marginTop: '0.25rem' }}>
                          {formatDate(r.requestedAt, lang)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleCreateServiceRequest} style={{ display: 'grid', gap: '0.75rem' }}>
                  <div>
                    <label htmlFor="req-kind">{es ? 'Tipo de solicitud' : 'Request type'}</label>
                    <select
                      id="req-kind"
                      value={reqKind}
                      onChange={(e) => setReqKind(e.target.value as 'withdrawal' | 'cancellation')}
                    >
                      <option value="withdrawal">{es ? 'Retiro de perfil (withdrawal)' : 'Profile withdrawal'}</option>
                      <option value="cancellation">{es ? 'Cancelación de incorporación (cancellation)' : 'Onboarding cancellation'}</option>
                    </select>
                  </div>

                  {reqKind === 'withdrawal' && (
                    <div>
                      <label htmlFor="req-legal">{es ? 'Base legal (opcional)' : 'Legal basis (optional)'}</label>
                      <select
                        id="req-legal"
                        value={reqLegalBasis}
                        onChange={(e) => setReqLegalBasis(e.target.value as '' | LegalBasis)}
                      >
                        <option value="">{es ? 'Solicitud voluntaria del titular' : 'Voluntary owner request'}</option>
                        <option value="data_protection">{es ? 'Protección de datos (data_protection)' : 'Data protection (data_protection)'}</option>
                        <option value="illicit_content">{es ? 'Contenido ilícito (illicit_content)' : 'Illicit content (illicit_content)'}</option>
                      </select>
                    </div>
                  )}

                  <div>
                    <label htmlFor="req-reason">{es ? 'Motivo detallado' : 'Detailed reason'}</label>
                    <textarea
                      id="req-reason"
                      rows={2}
                      required
                      value={reqReason}
                      onChange={(e) => setReqReason(e.target.value)}
                    />
                  </div>

                  <div>
                    <button type="submit" className="btn-secondary btn-sm" disabled={actionBusy}>
                      {es ? 'Enviar solicitud a administración' : 'Submit request to administration'}
                    </button>
                  </div>
                </form>
              </section>
              )}

              <section className="surface-card" style={{ margin: 0 }}>
                <div className="eyebrow">{es ? 'EQUIPO AUTORIZADO' : 'AUTHORIZED TEAM EDITORS'}</div>
                <h3 style={{ marginTop: 0 }}>
                  {es ? 'Gestionar editores de la empresa' : 'Manage company editors'}
                </h3>
                <p className="muted" style={{ fontSize: '0.84rem' }}>
                  {es
                    ? 'La persona invitada debe haber iniciado sesión previamente en THE1500. Los editores pueden preparar borradores del perfil, pero solo el titular aprueba y publica.'
                    : 'The person must sign in to THE1500 first. Editors can prepare profile drafts, while only the owner can approve and publish.'}
                </p>

                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <div>
                    <label htmlFor="member-email">{es ? 'Correo del editor' : 'Editor email'}</label>
                    <input
                      id="member-email"
                      type="email"
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      placeholder="editor@yourcompany.com"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={actionBusy}
                      onClick={() => handleMemberAction('add')}
                    >
                      {es ? 'Añadir editor' : 'Add editor'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={actionBusy}
                      onClick={() => handleMemberAction('remove')}
                    >
                      {es ? 'Revocar editor' : 'Remove editor'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
