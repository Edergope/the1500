/** Thin transactional mail client. Absent configuration is reported, never simulated. */
export interface MailEnv {RESEND_API_KEY?:string;MAIL_FROM?:string;RESEND_API_BASE?:string;}
export interface MailMessage {to:string;subject:string;text:string;}
export function mailConfigured(env:MailEnv):boolean {return !!env.RESEND_API_KEY&&!!env.MAIL_FROM;}
export async function sendMail(env:MailEnv,message:MailMessage):Promise<boolean> {
  if (!mailConfigured(env)) return false;
  try {
    const response=await fetch(`${env.RESEND_API_BASE||'https://api.resend.com'}/emails`,{
      method:'POST',signal:AbortSignal.timeout(10_000),
      headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:env.MAIL_FROM,to:[message.to],subject:message.subject,text:message.text})
    });
    return response.ok;
  } catch {return false;}
}
