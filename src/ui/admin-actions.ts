/** One confirmation for every sensitive action. The server still checks everything; this only collects what it requires. */
const dialog=document.querySelector<HTMLDialogElement>('#ad-action-dialog');
const form=document.querySelector<HTMLFormElement>('#ad-action-form');
const what=document.querySelector<HTMLElement>('#ad-action-what');
const error=document.querySelector<HTMLElement>('#ad-action-error');
const ok=document.querySelector<HTMLElement>('#ad-action-ok');
const reason=document.querySelector<HTMLFieldSetElement>('#ad-action-reason');
const submit=document.querySelector<HTMLButtonElement>('#ad-action-confirm');
interface Current {endpoint:string;payload:Record<string,unknown>;failed:string;plain:boolean;source:HTMLFormElement|null;nest?:string;success?:string;redirect?:string;}
let current:Current|null=null;
/** Typed values (a key, say) stay in the page only until the request is sent. */
const clearSecrets=(f:HTMLFormElement|null)=>f?.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(i=>{i.value='';});
document.querySelectorAll<HTMLButtonElement>('[data-admin-action]').forEach(button=>{
  button.addEventListener('click',()=>{
    if (!dialog||!form||!what||!error||!ok||!reason||!submit) return;
    const source=button.dataset.form?document.getElementById(button.dataset.form) as HTMLFormElement|null:null;
    if (source&&!source.reportValidity()) return;
    const plain=button.dataset.plain!==undefined;
    current={endpoint:button.dataset.endpoint!,payload:JSON.parse(button.dataset.payload!),failed:button.dataset.failed!,plain,source,
      nest:button.dataset.nest,success:button.dataset.success,redirect:button.dataset.redirect};
    what.textContent=button.dataset.summary!;
    form.reset();error.hidden=true;ok.hidden=true;submit.hidden=false;submit.disabled=false;
    // A disabled fieldset is neither shown nor required.
    reason.disabled=plain;reason.hidden=plain;
    dialog.showModal();
  });
});
// A form must never submit by itself: Enter goes through the same confirmation, and a typed key never reaches a URL.
document.querySelectorAll<HTMLFormElement>('form[data-admin-form]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();f.querySelector<HTMLButtonElement>('[data-admin-action]')?.click();}));
document.querySelector('#ad-action-cancel')?.addEventListener('click',()=>dialog?.close());
dialog?.addEventListener('close',()=>{if (current?.source) clearSecrets(current.source);});
form?.addEventListener('submit',async event=>{
  event.preventDefault();
  if (!current||!error||!ok||!submit) return;
  const data=new FormData(form);
  const fields=current.source?Object.fromEntries([...new FormData(current.source).entries()].map(([k,v])=>[k,String(v)])):{};
  const body:Record<string,unknown>={...current.payload,...(current.nest?{[current.nest]:fields}:fields)};
  if (!current.plain) {body.reasonCode=data.get('reasonCode');body.evidenceReference=data.get('evidenceReference');}
  submit.disabled=true;error.hidden=true;
  try {
    const response=await fetch(current.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if (response.ok) {
      clearSecrets(current.source);
      if (current.redirect) {location.href=current.redirect;return;}
      if (current.success) {ok.textContent=current.success;ok.hidden=false;submit.hidden=true;dialog?.addEventListener('close',()=>location.reload(),{once:true});return;}
      location.reload();return;
    }
    const answer=await response.json().catch(()=>null) as {error?:{message?:string;code?:string}}|null;
    error.textContent=answer?.error?.message||answer?.error?.code||current.failed;
  } catch {
    error.textContent=current.failed;
  }
  error.hidden=false;submit.disabled=false;
});
