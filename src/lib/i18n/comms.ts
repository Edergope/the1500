/** Transactional messages. Copy only; no commercial promise beyond approved decisions. */
import type {Locale} from './messages';
type Mail={subject:string;text:string};
export function loginEmail(l:Locale,url:string):Mail {
  return l==='es'?{subject:'Tu enlace de acceso a THE1500',
    text:`Accede a THE1500 (válido durante 15 minutos):\n${url}\n\nSi no lo solicitaste, ignora este mensaje.`}:
    {subject:'Your THE1500 sign-in link',
    text:`Sign in to THE1500 (valid for 15 minutes):\n${url}\n\nIf you didn't request this, ignore this message.`};
}
export function founderInvitationEmail(l:Locale,company:string,expiresAt:string,baseUrl:string):Mail {
  return l==='es'?{subject:`Invitación a THE1500 para ${company}`,
    text:`${company} ha sido invitada a incorporarse a THE1500 sin cargo.\nLa invitación vence el ${expiresAt}. Acéptala desde tu cuenta: ${baseUrl}/mi-cuenta`}:
    {subject:`THE1500 invitation for ${company}`,
    text:`${company} has been invited to join THE1500 at no charge.\nThe invitation expires on ${expiresAt}. Accept it from your account: ${baseUrl}/mi-cuenta`};
}
export function founderAwardedEmail(l:Locale,company:string,position:number,baseUrl:string):Mail {
  return l==='es'?{subject:`THE1500: cupo ${position} adjudicado`,
    text:`Se adjudicó formalmente a ${company} el cupo número ${position}, sin cargo.\nTienes 15 días para completar el formulario: ${baseUrl}/mi-cuenta`}:
    {subject:`THE1500: position ${position} awarded`,
    text:`${company} has been formally awarded position ${position}, at no charge.\nYou have 15 days to complete the form: ${baseUrl}/mi-cuenta`};
}
const onboardingCopy={
  extended:{en:['Your THE1500 form deadline was extended','We granted a single automatic 15-day extension to complete your company form.'],
    es:['Se amplió el plazo de tu formulario de THE1500','Concedimos una única prórroga automática de 15 días para completar el formulario de tu empresa.']},
  suspended:{en:['Your THE1500 onboarding is suspended','Your company form was not completed within 30 days. Onboarding is suspended. You may request reactivation within 15 days. Your payment and position are not lost because of this suspension.'],
    es:['Tu incorporación a THE1500 está suspendida','El formulario de tu empresa no se completó en 30 días. La incorporación queda suspendida. Puedes solicitar la reactivación dentro de 15 días. Esta suspensión no implica pérdida del pago ni del cupo.']},
} as const;
export function onboardingEmail(l:Locale,kind:keyof typeof onboardingCopy,baseUrl:string):Mail {
  const [subject,body]=onboardingCopy[kind][l];
  return {subject,text:`${body}\n${baseUrl}/mi-cuenta`};
}
export function purchaseConfirmedEmail(l:Locale,company:string,position:number,baseUrl:string):Mail {
  return l==='es'?{subject:`THE1500: cupo ${position} confirmado`,
    text:`El pago de ${company} está confirmado y su número de cupo es ${position}.\nTienes 15 días para completar el formulario: ${baseUrl}/mi-cuenta`}:
    {subject:`THE1500: position ${position} confirmed`,
    text:`Payment for ${company} is confirmed and its position number is ${position}.\nYou have 15 days to complete the form: ${baseUrl}/mi-cuenta`};
}
export function latePaymentEmail(l:Locale,company:string):Mail {
  return l==='es'?{subject:'THE1500: pago recibido tras vencer la reserva',
    text:`Recibimos el pago de ${company} después de vencer la reserva de 20 minutos. No se ha adjudicado cupo todavía: lo estamos conciliando y te informaremos si se adjudica o se reembolsa.`}:
    {subject:'THE1500: payment received after the reservation expired',
    text:`We received payment for ${company} after the 20-minute reservation expired. No position has been assigned yet: we are reconciling it and will tell you whether it is assigned or refunded.`};
}
export function reactivationEmail(l:Locale,kind:'approved'|'rejected'|'lapsed',baseUrl:string):Mail {
  const copy={
    approved:{en:['Your THE1500 reactivation was approved','Your reactivation was approved. You have 15 calendar days from this notice to complete your company form. No automatic extension applies.'],
      es:['Se aprobó la reactivación de tu incorporación a THE1500','Tu reactivación fue aprobada. Tienes 15 días calendario desde este aviso para completar el formulario de tu empresa. No se aplica ninguna prórroga automática.']},
    rejected:{en:['Your THE1500 reactivation is under individual review','Your reactivation request moved to individual administrative review. You do not automatically lose your position or your payment.'],
      es:['Tu reactivación en THE1500 pasó a revisión individual','Tu solicitud de reactivación pasó a revisión administrativa individual. No pierdes automáticamente tu cupo ni tu dinero.']},
    lapsed:{en:['Your THE1500 case is under individual review','The 15 days granted after reactivation ended without a completed form. Your case moved to individual administrative review. You do not automatically lose your position or your payment.'],
      es:['Tu expediente de THE1500 pasó a revisión individual','Los 15 días concedidos tras la reactivación terminaron sin formulario completado. Tu expediente pasó a revisión administrativa individual. No pierdes automáticamente tu cupo ni tu dinero.']},
  }[kind][l];
  return {subject:copy[0]!,text:`${copy[1]}\n${baseUrl}/mi-cuenta`};
}
export function serviceRequestDecisionEmail(l:Locale,company:string,kind:'withdrawal'|'cancellation',decision:'completed'|'rejected'):Mail {
  const what=l==='es'?(kind==='withdrawal'?'retiro':'cancelación'):kind;
  return l==='es'?{subject:`THE1500: decisión sobre tu solicitud de ${what}`,
    text:decision==='completed'?`Se ejecutó la solicitud de ${what} de ${company}.`:`La solicitud de ${what} de ${company} fue rechazada. Puedes pedir el motivo respondiendo a este mensaje.`}:
    {subject:`THE1500: decision on your ${what} request`,
    text:decision==='completed'?`The ${what} request for ${company} was carried out.`:`The ${what} request for ${company} was rejected. You can ask for the reason by replying to this message.`};
}
export function latePaymentResolvedEmail(l:Locale,company:string,position:number|null):Mail {
  return l==='es'?{subject:'THE1500: resolución de tu pago tardío',
    text:position?`Conciliamos el pago de ${company} y se adjudicó el cupo número ${position}.`:`Conciliamos el pago de ${company}. No pudo adjudicarse un cupo, por lo que corresponde su reembolso.`}:
    {subject:'THE1500: your late payment was resolved',
    text:position?`We reconciled the payment for ${company} and assigned position ${position}.`:`We reconciled the payment for ${company}. No position could be assigned, so it is being refunded.`};
}
export function premiumDecisionEmail(l:Locale,company:string,status:'in_review'|'accepted'|'rejected'):Mail {
  const es={in_review:'está en evaluación. Podríamos escribirte o proponerte una reunión si necesitamos más información',accepted:'fue aceptada. Administración te indicará cómo continuar; aceptarla no adjudica todavía un cupo',rejected:'no fue aceptada'};
  const en={in_review:'is being evaluated. We may email you or suggest a meeting if we need more information',accepted:'was accepted. Administration will tell you how to proceed; acceptance does not assign a position yet',rejected:'was not accepted'};
  return l==='es'?{subject:'THE1500: tu solicitud Premium',text:`La solicitud Premium de ${company} ${es[status]}.`}:
    {subject:'THE1500: your Premium application',text:`The Premium application for ${company} ${en[status]}.`};
}
