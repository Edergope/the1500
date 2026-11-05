/** One confirmation for every sensitive action. The server still checks everything; this only collects what it requires. */
const dialog=document.querySelector<HTMLDialogElement>('#ad-action-dialog');
const form=document.querySelector<HTMLFormElement>('#ad-action-form');
const what=document.querySelector<HTMLElement>('#ad-action-what');
const error=document.querySelector<HTMLElement>('#ad-action-error');
const submit=document.querySelector<HTMLButtonElement>('#ad-action-confirm');
let current:{endpoint:string;payload:Record<string,unknown>;failed:string}|null=null;
document.querySelectorAll<HTMLButtonElement>('[data-admin-action]').forEach(button=>{
  button.addEventListener('click',()=>{
    if (!dialog||!form||!what||!error) return;
    current={endpoint:button.dataset.endpoint!,payload:JSON.parse(button.dataset.payload!),failed:button.dataset.failed!};
    what.textContent=button.dataset.summary!;
    form.reset();error.hidden=true;
    dialog.showModal();
  });
});
document.querySelector('#ad-action-cancel')?.addEventListener('click',()=>dialog?.close());
form?.addEventListener('submit',async event=>{
  event.preventDefault();
  if (!current||!error||!submit) return;
  const data=new FormData(form);
  submit.disabled=true;error.hidden=true;
  try {
    const response=await fetch(current.endpoint,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...current.payload,reasonCode:data.get('reasonCode'),evidenceReference:data.get('evidenceReference')})});
    if (response.ok) {location.reload();return;}
    const body=await response.json().catch(()=>null) as {error?:{message?:string;code?:string}}|null;
    error.textContent=body?.error?.message||body?.error?.code||current.failed;
  } catch {
    error.textContent=current.failed;
  }
  error.hidden=false;submit.disabled=false;
});
