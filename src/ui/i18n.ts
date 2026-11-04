import type { Locale, ProvenanceType, SalesMode, IdentityState, OnboardingStatus, PublicationStatus } from '../lib/contracts/api';

export function formatPosition(pos: number): string {
  return `#${String(pos).padStart(4, '0')}`;
}

export function formatUsdCents(cents: number | null | undefined, locale: Locale = 'en'): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  const formatted = new Intl.NumberFormat(locale === 'es' ? 'es-CO' : 'en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(dollars);
  return `$${formatted} USD`;
}

export function formatDate(iso: string | null | undefined, locale: Locale = 'en'): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function provenanceLabel(type: ProvenanceType | string, locale: Locale): { label: string; tone: 'gold' | 'blue' | 'emerald' | 'slate' } {
  const es = locale === 'es';
  switch (type) {
    case 'owner_declared':
      return { label: es ? 'Declarado por el titular' : 'Owner-declared', tone: 'gold' };
    case 'ai_generated':
      return { label: es ? 'Estructurado con IA (aprobado por titular)' : 'AI-structured (owner-approved)', tone: 'blue' };
    case 'ai_translated':
      return { label: es ? 'Traducido con IA (aprobado por titular)' : 'AI-translated (owner-approved)', tone: 'blue' };
    case 'corroborated':
      return { label: es ? 'Corroborado documentalmente' : 'Corroborated', tone: 'emerald' };
    default:
      return { label: String(type), tone: 'slate' };
  }
}

export function salesModeCopy(mode: SalesMode, locale: Locale): { badge: string; title: string; description: string; tone: 'emerald' | 'amber' | 'gold' | 'slate' } {
  const es = locale === 'es';
  switch (mode) {
    case 'selling':
      return {
        badge: es ? 'Asignación abierta' : 'Allocation open',
        title: es ? 'Reserva y adjudicación automática disponibles' : 'Direct reservation and allocation available',
        description: es
          ? 'Los cupos del tramo activo se adjudican por orden de confirmación de pago tras validar la empresa.'
          : 'Positions in the active tier are allocated in order of payment confirmation after company validation.',
        tone: 'emerald',
      };
    case 'awaiting_founder_allocation':
      return {
        badge: es ? 'Tramo en transición' : 'Tier transition pending',
        title: es ? 'El siguiente tramo aún no está abierto' : 'The next tier has not opened yet',
        description: es
          ? 'Los cupos pagados del primer tramo se han agotado. El Tramo 2 se abrirá únicamente cuando las 600 posiciones iniciales estén definitivamente adjudicadas.'
          : 'Paid positions in Tier 1 are sold out. Tier 2 opens only once all 600 initial positions are definitively allocated.',
        tone: 'amber',
      };
    case 'premium_admission':
      return {
        badge: es ? 'Admisión Premium (1351–1500)' : 'Premium Admission (1351–1500)',
        title: es ? 'Últimas 150 posiciones mediante solicitud de admisión' : 'Final 150 positions via human admission review',
        description: es
          ? 'El checkout automático no está disponible en este tramo. Las empresas presentan una solicitud desde su portal de cuenta; enviarla no reserva posición.'
          : 'Automatic checkout is not available in this tier. Companies submit an application from their account portal; applying does not hold a position.',
        tone: 'gold',
      };
    case 'closed_archive':
      return {
        badge: es ? 'Archivo completo (1.500 / 1.500)' : 'Archive complete (1,500 / 1,500)',
        title: es ? 'Las 1.500 posiciones han sido consumidas' : 'All 1,500 positions have been allocated',
        description: es
          ? 'No quedan posiciones disponibles para la venta. El directorio público, el buscador y el asistente permanecen plenamente operativos.'
          : 'No positions remain for sale. The public directory, search and assistant remain fully operational.',
        tone: 'slate',
      };
  }
}

export function identityStateLabel(state: IdentityState, locale: Locale): { label: string; desc: string; canBuy: boolean; tone: 'emerald' | 'amber' | 'red' } {
  const es = locale === 'es';
  switch (state) {
    case 'self_declared':
      return {
        label: es ? 'Dominio corporativo validado' : 'Corporate domain matched',
        desc: es ? 'El correo coincide con el dominio corporativo declarado. Elegible para reservar cupo.' : 'Sign-in email matches the declared website domain. Eligible to reserve a position.',
        canBuy: true,
        tone: 'emerald',
      };
    case 'admin_verified':
      return {
        label: es ? 'Verificada por administración' : 'Administratively verified',
        desc: es ? 'Revisión documental completada por administración. Elegible para reservar cupo.' : 'Administrative review completed. Eligible to reserve a position.',
        canBuy: true,
        tone: 'emerald',
      };
    case 'pending_review':
      return {
        label: es ? 'En revisión administrativa' : 'Under administrative review',
        desc: es ? 'Tu registro requiere verificación administrativa antes de poder reservar una posición.' : 'Your registration requires administrative verification before reserving a position.',
        canBuy: false,
        tone: 'amber',
      };
    case 'rejected':
      return {
        label: es ? 'Registro rechazado' : 'Registration rejected',
        desc: es ? 'Este registro no superó la revisión de identidad corporativa.' : 'This registration did not pass corporate identity verification.',
        canBuy: false,
        tone: 'red',
      };
  }
}

export function publicationStatusLabel(status: PublicationStatus, locale: Locale): { label: string; tone: 'slate' | 'amber' | 'blue' | 'emerald' | 'red' } {
  const es = locale === 'es';
  switch (status) {
    case 'draft':
      return { label: es ? 'Borrador pendiente' : 'Draft pending', tone: 'slate' };
    case 'generated':
      return { label: es ? 'Vista previa generada' : 'Preview generated', tone: 'amber' };
    case 'owner_approved':
      return { label: es ? 'Aprobado por titular' : 'Owner approved', tone: 'blue' };
    case 'published':
      return { label: es ? 'Publicado en directorio' : 'Published in directory', tone: 'emerald' };
    case 'withdrawn':
      return { label: es ? 'Cupo retirado' : 'Position withdrawn', tone: 'red' };
  }
}

export function onboardingStatusLabel(status: OnboardingStatus, locale: Locale): { label: string; tone: 'emerald' | 'amber' | 'red' | 'blue' | 'slate' } {
  const es = locale === 'es';
  switch (status) {
    case 'active':
      return { label: es ? 'Plazo ordinario activo (15 días)' : 'Standard onboarding window (15 days)', tone: 'emerald' };
    case 'extended':
      return { label: es ? 'Prórroga automática (día 15 a 30)' : 'Extended window (days 15–30)', tone: 'amber' };
    case 'suspended':
      return { label: es ? 'Incorporación suspendida (reactivación disponible hasta día 45)' : 'Onboarding suspended (reactivation available until day 45)', tone: 'red' };
    case 'reactivation_requested':
      return { label: es ? 'Reactivación solicitada (en revisión administrativa)' : 'Reactivation requested (under administrative review)', tone: 'amber' };
    case 'reactivation_approved':
      return { label: es ? 'Reactivación aprobada (formulario habilitado)' : 'Reactivation approved (form unlocked)', tone: 'blue' };
    case 'reactivated':
      return { label: es ? 'Reactivado (15 días calendario para enviar formulario)' : 'Reactivated (15 calendar days to submit form)', tone: 'blue' };
    case 'admin_review':
      return { label: es ? 'Revisión individual por administración' : 'Individual administrative review', tone: 'amber' };
    case 'completed':
      return { label: es ? 'Formulario enviado / Incorporación completada' : 'Form submitted / Onboarding completed', tone: 'emerald' };
    case 'cancelled':
      return { label: es ? 'Expediente cancelado' : 'Onboarding cancelled', tone: 'red' };
  }
}
