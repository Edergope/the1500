export type AdminLang='en'|'es';
const dictionary={
  en:{
    control:'Control center',overview:'Overview',identityConfirmed:'Identity confirmed until',confirmIdentity:'Confirm identity',confirmIdentityText:'Irreversible actions need a link sent to your inbox. Open it in this browser; it lasts 15 minutes.',confirmIdentitySent:'Link sent. Open it from your inbox in this browser.',integrationsNav:'Integrations',companies:'Companies',profiles:'Profiles & JSON',audit:'Audit',account:'My account',publicSite:'Public site',language:'Español',
    environment:'Environment',local:'Local',staging:'Staging',noCharges:'No real charges',signedInAs:'Signed in as',
    business:'The register',positions:'Positions',assigned:'Assigned',held:'Reserved',available:'Open',retired:'Retired',capacity:'of 1,500',
    salesState:'Sales state',phase:'Tier',price:'Current price',checkout:'Checkout',open:'Open',closed:'Closed',none:'None',
    registered:'Registered',pendingReview:'Awaiting identity review',published:'Published',blocked:'Publication blocked',realData:'Real',demoData:'Demo',
    demoNotice:'Demo companies are counted separately. An owner address ending in .example identifies them.',
    profilesGenerated:'Versions generated',withProfile:'Companies with a profile',reviewPending:'Awaiting administrator review',ownerPending:'Awaiting owner approval',
    payments:'Payments',attempts:'Purchase attempts',confirmed:'Confirmed',refunded:'Refunded',inPaymentReview:'In review',attention:'Needs attention',incidents:'Open incidents',requests:'Open requests',founders:'Active founders',
    integrations:'Integrations',manageIntegrations:'Manage integrations',mail:'Email',stripe:'Stripe',ai:'AI',configured:'Configured',notConfigured:'Not configured',enabled:'Enabled',disabled:'Disabled',testKey:'Test key',liveKey:'Live key',
    provider:'Provider',model:'Model',noData:'No data could be read. Nothing here is estimated.',
    search:'Search',name:'Name or website',email:'Owner email',country:'Country',sector:'Sector',identity:'Identity',publication:'Publication',position:'Position',any:'Any',apply:'Apply',clear:'Clear',
    company:'Company',owner:'Owner',state:'State',created:'Registered',results:'results',noResults:'No companies match these filters.',previous:'Previous',next:'Next',demoBadge:'Demo',
    back:'Back to companies',facts:'Company',website:'Website',slug:'Public address',summary:'Public summary',members:'Owner and permissions',role:'Role',status:'Status',since:'Since',
    process:'Process',positionFacts:'Position',kind:'Kind',assignedAt:'Assigned',firstPublished:'First published',guarantee:'Publication guarantee until',correction:'Corrections until',onboarding:'Onboarding',
    versions:'Profile versions',version:'Version',generatedWith:'Generated with',stage:'Stage',review:'Review',open_:'Open',noVersions:'No profile has been generated.',
    requestsTitle:'Requests',incidentsTitle:'Incidents',attemptsTitle:'Purchase attempts',noneOpen:'None.',history:'History',when:'When',action:'Action',actor:'Who',reason:'Reason',evidence:'Evidence',detail:'Detail',noHistory:'No events yet.',
    actions:'Actions',approveIdentity:'Approve identity',rejectIdentity:'Reject identity',blockPublication:'Block publication',clearBlock:'Remove block',grantRectification:'Reopen corrections for 7 days',
    positionNote:'Positions cannot be assigned or changed from here. They come only from a verified payment or a founder or Premium decision.',
    clearReview:'Clear for publication',rejectReview:'Reject version',
    profilesIntro:'Every version of every profile, with the documents behind it.',allStages:'All stages',allReviews:'All reviews',noProfiles:'No profiles match these filters.',
    documents:'Documents',original:'Original',generated:'Generated',approved:'Approved',publicDoc:'Published',declaration:'Owner declaration',companyData:'Company data received',canonical:'Canonical JSON',jsonldEn:'JSON-LD, English',jsonldEs:'JSON-LD, Spanish',generator:'Generation record',
    live:'This version is the public one',notLive:'Not public',integrity:'Integrity',generation:'Generation',deterministic:'Without AI',promptVersion:'Prompt',reasonNoAi:'Why not AI',approval:'Owner approval',notApproved:'Not approved',notPublished:'Not published',digest:'Content digest',
    warnings:'Warnings',unsupported:'Claims without support',noWarnings:'No warnings.',noUnsupported:'No unsupported claims.',provenance:'Where each field came from',field:'Field',source:'Source',reviewHistory:'Review decisions',
    backProfiles:'Back to profiles',
    actionTitle:'Confirm this action',reasonCode:'Reason code',reasonHint:'3 to 64 letters, numbers, - or _.',evidenceLabel:'Evidence reference',evidenceHint:'A ticket, email or document that supports this. Up to 400 characters.',understand:'I understand this is recorded with my account, the date and the time.',cancel:'Cancel',confirm:'Confirm',failed:'The action was not applied.',
    auditIntro:'Every administrative action, as recorded. Entries cannot be edited or deleted.',subject:'Subject',allActions:'All actions',noEvents:'No events match these filters.',
    checks:{canonical_structure:'Canonical JSON has the expected structure',jsonld_en_structure:'English JSON-LD has the expected structure',jsonld_es_structure:'Spanish JSON-LD has the expected structure',approval_matches_content:'Content is what the owner approved',published_after_approval:'Published after owner approval',snapshot_matches_jsonld:'Public JSON-LD matches the publication record'} as Record<string,string>,
  },
  es:{
    control:'Centro de control',overview:'Resumen',identityConfirmed:'Identidad confirmada hasta',confirmIdentity:'Confirmar identidad',confirmIdentityText:'Las acciones irreversibles necesitan un enlace enviado a tu correo. Ábrelo en este navegador; dura 15 minutos.',confirmIdentitySent:'Enlace enviado. Ábrelo desde tu correo en este navegador.',integrationsNav:'Integraciones',companies:'Empresas',profiles:'Perfiles y JSON',audit:'Auditoría',account:'Mi cuenta',publicSite:'Sitio público',language:'English',
    environment:'Entorno',local:'Local',staging:'Staging',noCharges:'Sin cobros reales',signedInAs:'Sesión de',
    business:'El registro',positions:'Posiciones',assigned:'Asignadas',held:'Reservadas',available:'Abiertas',retired:'Retiradas',capacity:'de 1.500',
    salesState:'Estado de venta',phase:'Tramo',price:'Precio vigente',checkout:'Compra',open:'Abierta',closed:'Cerrada',none:'Ninguno',
    registered:'Registradas',pendingReview:'Pendientes de revisión de identidad',published:'Publicadas',blocked:'Publicación bloqueada',realData:'Reales',demoData:'Demo',
    demoNotice:'Las empresas de demostración se cuentan aparte. Las identifica el correo del titular terminado en .example.',
    profilesGenerated:'Versiones generadas',withProfile:'Empresas con perfil',reviewPending:'Pendientes de revisión administrativa',ownerPending:'Pendientes de aprobación del titular',
    payments:'Pagos',attempts:'Intentos de compra',confirmed:'Confirmados',refunded:'Reembolsados',inPaymentReview:'En revisión',attention:'Requiere atención',incidents:'Incidencias abiertas',requests:'Solicitudes abiertas',founders:'Fundadores activos',
    integrations:'Integraciones',manageIntegrations:'Gestionar integraciones',mail:'Correo',stripe:'Stripe',ai:'IA',configured:'Configurado',notConfigured:'Sin configurar',enabled:'Habilitado',disabled:'Deshabilitado',testKey:'Clave de prueba',liveKey:'Clave real',
    provider:'Proveedor',model:'Modelo',noData:'No se pudieron leer los datos. Aquí nada es estimado.',
    search:'Buscar',name:'Nombre o sitio web',email:'Correo del titular',country:'País',sector:'Sector',identity:'Identidad',publication:'Publicación',position:'Posición',any:'Cualquiera',apply:'Aplicar',clear:'Limpiar',
    company:'Empresa',owner:'Titular',state:'Estado',created:'Registro',results:'resultados',noResults:'Ninguna empresa coincide con estos filtros.',previous:'Anterior',next:'Siguiente',demoBadge:'Demo',
    back:'Volver a empresas',facts:'Empresa',website:'Sitio web',slug:'Dirección pública',summary:'Resumen público',members:'Titular y permisos',role:'Rol',status:'Estado',since:'Desde',
    process:'Proceso',positionFacts:'Posición',kind:'Tipo',assignedAt:'Asignada',firstPublished:'Primera publicación',guarantee:'Garantía de publicación hasta',correction:'Correcciones hasta',onboarding:'Incorporación',
    versions:'Versiones del perfil',version:'Versión',generatedWith:'Generado con',stage:'Etapa',review:'Revisión',open_:'Abrir',noVersions:'No se ha generado ningún perfil.',
    requestsTitle:'Solicitudes',incidentsTitle:'Incidencias',attemptsTitle:'Intentos de compra',noneOpen:'Ninguna.',history:'Historial',when:'Cuándo',action:'Acción',actor:'Quién',reason:'Motivo',evidence:'Evidencia',detail:'Detalle',noHistory:'Aún no hay eventos.',
    actions:'Acciones',approveIdentity:'Aprobar identidad',rejectIdentity:'Rechazar identidad',blockPublication:'Bloquear publicación',clearBlock:'Quitar bloqueo',grantRectification:'Reabrir correcciones 7 días',
    positionNote:'Las posiciones no se pueden asignar ni cambiar desde aquí. Solo resultan de un pago verificado o de una decisión de fundador o Premium.',
    clearReview:'Autorizar para publicación',rejectReview:'Rechazar versión',
    profilesIntro:'Todas las versiones de cada perfil, con los documentos que las sustentan.',allStages:'Todas las etapas',allReviews:'Todas las revisiones',noProfiles:'Ningún perfil coincide con estos filtros.',
    documents:'Documentos',original:'Original',generated:'Generado',approved:'Aprobado',publicDoc:'Publicado',declaration:'Declaración del titular',companyData:'Datos de empresa recibidos',canonical:'JSON canónico',jsonldEn:'JSON-LD, inglés',jsonldEs:'JSON-LD, español',generator:'Registro de generación',
    live:'Esta es la versión pública',notLive:'No es pública',integrity:'Integridad',generation:'Generación',deterministic:'Sin IA',promptVersion:'Prompt',reasonNoAi:'Por qué sin IA',approval:'Aprobación del titular',notApproved:'Sin aprobar',notPublished:'Sin publicar',digest:'Huella del contenido',
    warnings:'Advertencias',unsupported:'Afirmaciones sin respaldo',noWarnings:'Sin advertencias.',noUnsupported:'Sin afirmaciones sin respaldo.',provenance:'De dónde viene cada campo',field:'Campo',source:'Origen',reviewHistory:'Decisiones de revisión',
    backProfiles:'Volver a perfiles',
    actionTitle:'Confirma esta acción',reasonCode:'Código de motivo',reasonHint:'De 3 a 64 letras, números, - o _.',evidenceLabel:'Referencia de evidencia',evidenceHint:'Un ticket, correo o documento que la respalde. Hasta 400 caracteres.',understand:'Entiendo que queda registrada con mi cuenta, la fecha y la hora.',cancel:'Cancelar',confirm:'Confirmar',failed:'La acción no se aplicó.',
    auditIntro:'Cada acción administrativa, tal como se registró. Las entradas no se pueden editar ni eliminar.',subject:'Asunto',allActions:'Todas las acciones',noEvents:'Ningún evento coincide con estos filtros.',
    checks:{canonical_structure:'El JSON canónico tiene la estructura esperada',jsonld_en_structure:'El JSON-LD en inglés tiene la estructura esperada',jsonld_es_structure:'El JSON-LD en español tiene la estructura esperada',approval_matches_content:'El contenido es el que aprobó el titular',published_after_approval:'Publicado tras la aprobación del titular',snapshot_matches_jsonld:'El JSON-LD público coincide con el registro de publicación'} as Record<string,string>,
  },
} as const;
export const copy=(lang:AdminLang)=>dictionary[lang];

const STATES:Record<AdminLang,Record<string,string>>={
  en:{self_declared:'Self-declared',pending_review:'Pending review',admin_verified:'Verified',rejected:'Rejected',draft:'Draft',generated:'Generated',owner_approved:'Owner approved',published:'Published',withdrawn:'Withdrawn',
    assigned:'Assigned',retired:'Retired',held:'Reserved',available:'Open',paid:'Paid',founder:'Founder',premium:'Premium',owner:'Owner',editor:'Editor',active:'Active',blocked:'Blocked',
    not_required:'Not required',pending:'Pending',cleared:'Cleared',approved:'Approved',requested:'Requested',completed:'Completed',open:'Open',resolved:'Resolved',info:'Info',warning:'Warning',critical:'Critical',
    extended:'Extended',suspended:'Suspended',reactivation_requested:'Reactivation requested',reactivation_approved:'Reactivation approved',reactivated:'Reactivated',admin_review:'Administrator review',cancelled:'Cancelled',
    creating:'Creating',failed:'Failed',expired:'Expired',late_review:'Late payment',amount_review:'Amount review',refund_pending:'Refund pending',refunded:'Refunded',disputed:'Disputed',chargeback_lost:'Chargeback lost',withdrawal:'Withdrawal',cancellation:'Cancellation',
    selling:'On sale',awaiting_founder_allocation:'Awaiting founder allocation',premium_admission:'Premium by request',closed_archive:'Register complete',
    registered:'Registered',identity:'Identity',position:'Position',declaration:'Declaration',llm:'AI',deterministic:'Without AI'},
  es:{self_declared:'Autodeclarada',pending_review:'En revisión',admin_verified:'Verificada',rejected:'Rechazada',draft:'Borrador',generated:'Generado',owner_approved:'Aprobado por titular',published:'Publicado',withdrawn:'Retirado',
    assigned:'Asignada',retired:'Retirada',held:'Reservada',available:'Abierta',paid:'Pagada',founder:'Fundador',premium:'Premium',owner:'Titular',editor:'Editor',active:'Activo',blocked:'Bloqueado',
    not_required:'No requerida',pending:'Pendiente',cleared:'Autorizada',approved:'Aprobado',requested:'Solicitada',completed:'Completada',open:'Abierta',resolved:'Resuelta',info:'Informativa',warning:'Advertencia',critical:'Crítica',
    extended:'Prorrogada',suspended:'Suspendida',reactivation_requested:'Reactivación solicitada',reactivation_approved:'Reactivación aprobada',reactivated:'Reactivada',admin_review:'Revisión administrativa',cancelled:'Cancelada',
    creating:'Creándose',failed:'Fallido',expired:'Vencido',late_review:'Pago tardío',amount_review:'Revisión de importe',refund_pending:'Reembolso pendiente',refunded:'Reembolsado',disputed:'En disputa',chargeback_lost:'Contracargo perdido',withdrawal:'Retiro',cancellation:'Cancelación',
    selling:'En venta',awaiting_founder_allocation:'Esperando adjudicación de fundadores',premium_admission:'Premium por solicitud',closed_archive:'Registro completo',
    registered:'Registro',identity:'Identidad',position:'Posición',declaration:'Declaración',llm:'IA',deterministic:'Sin IA'},
};
export const stateLabel=(lang:AdminLang,value:string|null|undefined)=>value?(STATES[lang][value]??value):'—';
const GOOD=new Set(['admin_verified','self_declared','published','cleared','not_required','paid','active','resolved','completed','approved','owner_approved','selling']);
const BAD=new Set(['rejected','blocked','failed','critical','disputed','chargeback_lost','suspended','withdrawn','retired','cancelled']);
const WAITING=new Set(['pending_review','pending','requested','open','warning','late_review','amount_review','refund_pending','reactivation_requested','admin_review','generated','held','awaiting_founder_allocation']);
export const stateTone=(value:string|null|undefined)=>!value?'plain':GOOD.has(value)?'good':BAD.has(value)?'bad':WAITING.has(value)?'wait':'plain';
/** Fixed and unambiguous: an operator compares these against logs and provider dashboards. */
export const formatDate=(_lang:AdminLang,value:string|null|undefined)=>{
  if (!value) return '—';
  const date=new Date(value.includes('T')?value:`${value.replace(' ','T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0,16).replace('T',' ')} UTC`;
};
export const formatNumber=(lang:AdminLang,value:number)=>new Intl.NumberFormat(lang==='es'?'es-CO':'en-US').format(value);
export const formatUsd=(lang:AdminLang,cents:number|null|undefined)=>cents==null?'—':new Intl.NumberFormat(lang==='es'?'es-CO':'en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
export const formatPosition=(value:number|null|undefined)=>value==null?'—':`#${String(value).padStart(4,'0')}`;
/** Same page in the other language. */
export const otherLanguagePath=(lang:AdminLang,path:string,search:string)=>(lang==='es'?path.replace(/^\/es/,''):`/es${path}`)+search;
