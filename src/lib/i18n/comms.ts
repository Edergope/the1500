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
