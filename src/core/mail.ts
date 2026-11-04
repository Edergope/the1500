/**
 * One door for outgoing mail. The core never names a provider: switching is MAIL_PROVIDER plus that provider's
 * configuration. Absent configuration is reported, never simulated. "Accepted" means the provider took the message,
 * not that it reached the inbox.
 */
export interface MailEnv {MAIL_PROVIDER?:string;MAIL_FROM?:string;EMAIL?:SendEmail;RESEND_API_KEY?:string;RESEND_API_BASE?:string;}
export interface MailMessage {to:string;subject:string;text:string;}
/** rejected: this message will never go through. blocked: nothing will until someone acts or the quota resets. transient: try again. */
export type MailFailure='rejected'|'blocked'|'transient';
export type MailOutcome={accepted:true;provider:string;messageId:string|null}|{accepted:false;provider:string;failure:MailFailure;code:string};
interface MailProvider {name:string;configured:boolean;send(message:MailMessage):Promise<MailOutcome>;}

// Diagnostics for operators, kept apart from the API error codes that users see.
const UNKNOWN_FAILURE='E_UNKNOWN',NETWORK_FAILURE='NETWORK';
const CLOUDFLARE_FAILURES:Record<string,MailFailure>={
  E_RECIPIENT_SUPPRESSED:'rejected',E_RECIPIENT_NOT_ALLOWED:'rejected',E_VALIDATION_ERROR:'rejected',E_FIELD_MISSING:'rejected',E_TOO_MANY_RECIPIENTS:'rejected',E_CONTENT_TOO_LARGE:'rejected',
  E_SENDER_NOT_VERIFIED:'blocked',E_SENDER_DOMAIN_NOT_AVAILABLE:'blocked',E_ACCOUNT_SUSPENDED:'blocked',E_DAILY_LIMIT_EXCEEDED:'blocked',E_RATE_LIMIT_EXCEEDED:'blocked',
};
/** The binding accepts a plain address or {email,name}, not the "Name <address>" form MAIL_FROM uses. */
export function parseSender(from:string):string|EmailAddress {
  const match=from.match(/^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  return match?{name:match[1]!,email:match[2]!}:from.trim();
}
function cloudflareProvider(env:MailEnv):MailProvider {
  const name='cloudflare';
  return {name,configured:!!env.EMAIL&&!!env.MAIL_FROM,async send(message) {
    try {
      const result=await env.EMAIL!.send({from:parseSender(env.MAIL_FROM!),to:message.to,subject:message.subject,text:message.text});
      return {accepted:true,provider:name,messageId:result.messageId??null};
    } catch (error) {
      const code=(error as {code?:unknown}).code;
      const known=typeof code==='string'?code:UNKNOWN_FAILURE;
      return {accepted:false,provider:name,failure:CLOUDFLARE_FAILURES[known]??'transient',code:known};
    }
  }};
}
function resendProvider(env:MailEnv):MailProvider {
  const name='resend';
  return {name,configured:!!env.RESEND_API_KEY&&!!env.MAIL_FROM,async send(message) {
    try {
      const response=await fetch(`${env.RESEND_API_BASE||'https://api.resend.com'}/emails`,{
        method:'POST',signal:AbortSignal.timeout(10_000),
        headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({from:env.MAIL_FROM,to:[message.to],subject:message.subject,text:message.text})
      });
      if (response.ok) {
        const data=await response.json().catch(()=>null) as {id?:string}|null;
        return {accepted:true,provider:name,messageId:data?.id??null};
      }
      const failure:MailFailure=[401,403,429].includes(response.status)?'blocked':response.status>=400&&response.status<500?'rejected':'transient';
      return {accepted:false,provider:name,failure,code:`HTTP_${response.status}`};
    } catch {return {accepted:false,provider:name,failure:'transient',code:NETWORK_FAILURE};}
  }};
}
function provider(env:MailEnv):MailProvider|null {
  const chosen=env.MAIL_PROVIDER||'cloudflare';
  return chosen==='cloudflare'?cloudflareProvider(env):chosen==='resend'?resendProvider(env):null;
}
export function mailStatus(env:MailEnv) {
  const current=provider(env);
  return {provider:current?.name??null,configured:!!current?.configured,bindingPresent:!!env.EMAIL,keyPresent:!!env.RESEND_API_KEY,from:env.MAIL_FROM??null};
}
export function mailConfigured(env:MailEnv):boolean {return !!provider(env)?.configured;}
export async function sendMail(env:MailEnv,message:MailMessage):Promise<MailOutcome> {
  const current=provider(env);
  if (!current?.configured) return {accepted:false,provider:current?.name??'none',failure:'blocked',code:'MAIL_NOT_CONFIGURED'};
  return current.send(message);
}
