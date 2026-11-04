// Local stand-ins for Resend, the LLM provider and Stripe. They exercise the real HTTP code paths and
// real signature checks. They are NOT the providers: passing here says nothing about a live account.
const http=require('node:http');const crypto=require('node:crypto');
function strip(text){return text.split(/(?<=[.!?])\s+/).filter(s=>!/\b(the only|the best|leading|los únicos|la única)\b/i.test(s)).join(' ');}
function createUpstreams(){
  const state={emails:[],llm:{mode:'ok',calls:0},ask:{mode:'ok'},stripe:{fail:false,sessions:new Map(),refunds:[],seen:[],refundStatus:'succeeded'},mail:{fail:false}};
  const server=http.createServer((req,res)=>{
    let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
      const send=(code,obj)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(obj));};
      const url=new URL(req.url,'http://x');
      if(url.pathname==='/emails'){
        if(state.mail.fail)return send(500,{error:'down'});
        const body=JSON.parse(raw);state.emails.push(body);return send(200,{id:'em_'+state.emails.length});
      }
      if(url.pathname==='/v1/messages'){
        state.llm.calls++;
        const body=JSON.parse(raw);const system=body.system;const user=JSON.parse(body.messages[0].content);
        state.llm.last=body;
        const reply=(obj,stop='end_turn')=>send(200,{id:'msg_1',type:'message',role:'assistant',model:body.model,stop_reason:stop,stop_sequence:null,usage:{input_tokens:1,output_tokens:1},content:[{type:'text',text:JSON.stringify(obj)}]});
        if(state.llm.mode==='fail')return send(500,{type:'error',error:{type:'api_error',message:'down'}});
        if(state.llm.mode==='refuse')return reply({}, 'refusal');
        if(system.startsWith('You structure')){
          const d=user.declaration;
          const clean=strip(d.description);
          const claims=clean===d.description?[]:[{text:'Exclusivity claim',reason:'unsupported'}];
          const out={summaryEn:clean,summaryEs:d.descriptionEs?strip(d.descriptionEs):clean,
            services:d.services.map((n,i)=>({declaredIndex:i,nameEn:n,nameEs:n})),
            audiences:d.audiences.map((n,i)=>({declaredIndex:i,nameEn:n,nameEs:n})),
            problemSolutions:d.problemSolutions.map((p,i)=>({declaredIndex:i,problemEn:p.problem,solutionEn:p.solution,problemEs:p.problem,solutionEs:p.solution})),
            unsupportedClaims:claims,warnings:[]};
          if(state.llm.mode==='hallucinate')out.summaryEn+=' The firm is ISO 27001 certified and has served 500 clients including Acme Global.';
          if(state.llm.mode==='extra_item')out.services.push({declaredIndex:out.services.length,nameEn:'Invented service',nameEs:'Servicio inventado'});
          return reply(out);
        }
        const first=user.passages[0];
        if(state.ask.mode==='insufficient')return reply({answer:'',citedSlugs:[],insufficientEvidence:true});
        if(state.ask.mode==='bad_citation')return reply({answer:'Try Ghost Corp.',citedSlugs:['ghost-corp'],insufficientEvidence:false});
        if(state.ask.mode==='invent')return reply({answer:`${first.company} is certified and has 900 customers.`,citedSlugs:[first.slug],insufficientEvidence:false});
        return reply({answer:`${first.company} declares: ${first.evidence}`,citedSlugs:[first.slug],insufficientEvidence:false});
      }
      if(url.pathname.startsWith('/v1/')){
        state.stripe.seen.push({method:req.method,path:url.pathname,idempotency:req.headers['idempotency-key'],auth:req.headers.authorization});
        if(state.stripe.fail)return send(500,{error:{message:'provider down'}});
        if(req.method==='POST'&&url.pathname==='/v1/checkout/sessions'){
          const f=new URLSearchParams(raw);const now=Math.floor(Date.now()/1000);const exp=Number(f.get('expires_at'));
          // Same limits as the real API reference: 30 minutes to 24 hours.
          if(exp-now<1800||exp-now>86400)return send(400,{error:{code:'parameter_invalid_integer',message:'expires_at must be 30m-24h ahead'}});
          const id='cs_test_'+crypto.randomUUID().replace(/-/g,'');
          const s={id,object:'checkout.session',url:'https://checkout.stripe.test/'+id,status:'open',payment_status:'unpaid',livemode:false,expires_at:exp,
            amount_total:Number(f.get('line_items[0][price_data][unit_amount]')),currency:f.get('line_items[0][price_data][currency]'),payment_intent:null,
            metadata:{attempt_id:f.get('metadata[attempt_id]'),company_id:f.get('metadata[company_id]')},customer_details:{email:f.get('customer_email')}};
          state.stripe.sessions.set(id,s);return send(200,s);
        }
        let m;
        if(req.method==='GET'&&(m=url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))){const s=state.stripe.sessions.get(m[1]);return s?send(200,s):send(404,{error:{message:'none'}});}
        if(req.method==='POST'&&(m=url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/))){const s=state.stripe.sessions.get(m[1]);if(!s)return send(404,{error:{}});if(s.status!=='open')return send(400,{error:{message:'not open'}});s.status='expired';return send(200,s);}
        if(req.method==='GET'&&url.pathname.startsWith('/v1/payment_intents/')){return state.stripe.chargeCreated?send(200,{latest_charge:{created:state.stripe.chargeCreated}}):send(404,{error:{message:'no charge'}});}
        if(req.method==='POST'&&url.pathname==='/v1/refunds'){const f=new URLSearchParams(raw);const r={id:'re_'+state.stripe.refunds.length,status:state.stripe.refundStatus,payment_intent:f.get('payment_intent')};state.stripe.refunds.push(r);return send(200,r);}
      }
      send(404,{error:{message:'unmocked '+url.pathname}});
    });
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{
    const base=`http://127.0.0.1:${server.address().port}`;
    resolve({base,state,close:()=>new Promise(r=>server.close(r)),
      pay(sessionId,overrides={}){const s=state.stripe.sessions.get(sessionId);s.status='complete';s.payment_status='paid';s.payment_intent=s.payment_intent||'pi_'+sessionId.slice(-12);Object.assign(s,overrides);return s;}});
  }));
}
const WEBHOOK_SECRET='whsec_test_local_only';
function signedEvent(type,object,{id=`evt_${crypto.randomUUID()}`,secret=WEBHOOK_SECRET,timestamp=Math.floor(Date.now()/1000)}={}){
  const body=JSON.stringify({id,type,livemode:false,data:{object}});
  const sig=crypto.createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
  return {id,body,signature:`t=${timestamp},v1=${sig}`};
}
module.exports={createUpstreams,signedEvent,WEBHOOK_SECRET};
