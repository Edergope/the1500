import {useCallback,useMemo,useState} from 'react';
import {diffJson,joinPath,type JsonChange,type JsonValue} from '../../lib/json-diff';

type DocId='declaration'|'companyData'|'canonical'|'jsonldEn'|'jsonldEs'|'generator';
const ORDER:DocId[]=['declaration','companyData','canonical','jsonldEn','jsonldEs','generator'];
interface Props {
  lang:'en'|'es';companyId:string;version:number;slug:string;versions:number[];stage:'generated'|'approved'|'published';
  labels:Record<DocId,string>;stages:Record<'original'|'generated'|'approved'|'published',string>;current:Record<DocId,unknown>;
}
const WORDS={
  en:{expand:'Expand all',collapse:'Collapse all',copy:'Copy JSON',copied:'Copied',copyFailed:'Could not copy',export:'Export JSON',compare:'Compare with',noCompare:'No comparison',loading:'Reading that version',loadFailed:'That version could not be read.',same:'No differences with this version.',added:'added',removed:'removed',changed:'changed',empty:'This document does not exist for this version.',items:'items',keys:'fields',path:'Path',before:'Before',after:'After',docs:'Documents'},
  es:{expand:'Expandir todo',collapse:'Contraer todo',copy:'Copiar JSON',copied:'Copiado',copyFailed:'No se pudo copiar',export:'Exportar JSON',compare:'Comparar con',noCompare:'Sin comparación',loading:'Leyendo esa versión',loadFailed:'No se pudo leer esa versión.',same:'Sin diferencias con esta versión.',added:'añadido',removed:'eliminado',changed:'modificado',empty:'Este documento no existe para esta versión.',items:'elementos',keys:'campos',path:'Ruta',before:'Antes',after:'Después',docs:'Documentos'},
};
const short=(v:JsonValue|undefined)=>{const s=JSON.stringify(v);return s&&s.length>160?`${s.slice(0,160)}…`:s??'';};
function Leaf({value}:{value:JsonValue}) {
  if (value===null) return <span className="jv-null">null</span>;
  if (typeof value==='string') return <span className="jv-string">"{value}"</span>;
  return <span className={typeof value==='number'?'jv-number':'jv-bool'}>{String(value)}</span>;
}
function Node({name,value,path,depth,open,toggle,marks,onSelect,words}:{name:string|number|null;value:JsonValue;path:string;depth:number;open:Set<string>;toggle:(p:string)=>void;marks:Map<string,JsonChange['kind']>;onSelect:(p:string)=>void;words:typeof WORDS['en']}) {
  const branch=typeof value==='object'&&value!==null;
  const mark=marks.get(path);
  const label=name===null?null:<button type="button" className="jv-key" title={path} onClick={()=>onSelect(path)}>{typeof name==='number'?name:name}</button>;
  if (!branch) return <div className={`jv-row${mark?` jv-${mark}`:''}`} style={{paddingLeft:depth*16+18}}>{label}{label&&<span className="jv-colon">: </span>}<Leaf value={value}/></div>;
  const entries:[string|number,JsonValue][]=Array.isArray(value)?value.map((v,i)=>[i,v]):Object.entries(value);
  const isOpen=open.has(path);
  return <>
    <div className={`jv-row${mark?` jv-${mark}`:''}`} style={{paddingLeft:depth*16}}>
      <button type="button" className="jv-toggle" aria-expanded={isOpen} aria-label={path||'root'} onClick={()=>toggle(path)}>{isOpen?'▾':'▸'}</button>
      {label}{label&&<span className="jv-colon">: </span>}
      <span className="jv-count">{Array.isArray(value)?`[${entries.length} ${words.items}]`:`{${entries.length} ${words.keys}}`}</span>
    </div>
    {isOpen&&entries.map(([k,v])=>{const p=joinPath(path,k);return <Node key={p} name={k} value={v} path={p} depth={depth+1} open={open} toggle={toggle} marks={marks} onSelect={onSelect} words={words}/>;})}
  </>;
}
function allPaths(value:JsonValue,path='',out:string[]=[],maxDepth=Infinity,depth=0):string[] {
  if (typeof value!=='object'||value===null||depth>=maxDepth) return out;
  out.push(path);
  const entries:[string|number,JsonValue][]=Array.isArray(value)?value.map((v,i)=>[i,v]):Object.entries(value);
  for (const [k,v] of entries) allPaths(v,joinPath(path,k),out,maxDepth,depth+1);
  return out;
}
export default function JsonWorkbench({lang,companyId,version,slug,versions,stage,labels,stages,current}:Props) {
  const words=WORDS[lang];
  const [doc,setDoc]=useState<DocId>('canonical');
  const value=(current[doc]??null) as JsonValue;
  const [open,setOpen]=useState<Set<string>>(()=>new Set(allPaths(value,'',[],2)));
  const [selected,setSelected]=useState('');
  const [note,setNote]=useState('');
  const [other,setOther]=useState<{version:number;docs:Record<DocId,unknown>}|null>(null);
  const [loading,setLoading]=useState(false);
  const [loadError,setLoadError]=useState(false);
  const stageOf:Record<DocId,string>={declaration:stages.original,companyData:stages.original,canonical:stages[stage],jsonldEn:stages[stage],jsonldEs:stages[stage],generator:stages.generated};
  const pick=(id:DocId)=>{setDoc(id);setOpen(new Set(allPaths((current[id]??null) as JsonValue,'',[],2)));setSelected('');setNote('');};
  const toggle=useCallback((p:string)=>setOpen(s=>{const n=new Set(s);if (n.has(p)) n.delete(p);else n.add(p);return n;}),[]);
  const changes=useMemo(()=>other?diffJson((other.docs[doc]??undefined) as JsonValue|undefined,(current[doc]??undefined) as JsonValue|undefined):[],[other,doc,current]);
  const marks=useMemo(()=>{
    const map=new Map<string,JsonChange['kind']>();
    for (const c of changes) map.set(c.path,c.kind);
    return map;
  },[changes]);
  // Read only when asked for: this page never refreshes or asks on its own.
  const compareWith=async(target:string)=>{
    setLoadError(false);
    if (!target) {setOther(null);return;}
    setLoading(true);
    try {
      const response=await fetch(`/api/v1/admin/profiles/detail?companyId=${encodeURIComponent(companyId)}&version=${Number(target)}`);
      if (!response.ok) throw new Error('unavailable');
      const d=await response.json() as {documents:{declaration:unknown;canonical:unknown;jsonld:unknown;jsonldEs:unknown};company:{displayName:string;slug:string;country:string;industry:string|null;website:string|null};generator:unknown};
      setOther({version:Number(target),docs:{declaration:d.documents.declaration,companyData:{displayName:d.company.displayName,slug:d.company.slug,country:d.company.country,industry:d.company.industry,website:d.company.website},
        canonical:d.documents.canonical,jsonldEn:d.documents.jsonld,jsonldEs:d.documents.jsonldEs,generator:d.generator}});
    } catch {setOther(null);setLoadError(true);}
    setLoading(false);
  };
  const text=JSON.stringify(value,null,2);
  const copy=async()=>{try {await navigator.clipboard.writeText(text);setNote(words.copied);} catch {setNote(words.copyFailed);}};
  const download=()=>{
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`${slug}-v${version}-${doc}.json`;a.click();URL.revokeObjectURL(url);
  };
  return <section className="ad-panel ad-panel-wide jv" aria-label={words.docs}>
    <div className="jv-tabs" role="tablist" aria-label={words.docs}>
      {ORDER.map(id=><button key={id} type="button" role="tab" aria-selected={doc===id} onClick={()=>pick(id)}>{labels[id]}</button>)}
    </div>
    <div className="jv-bar">
      <span className="jv-stage">{stageOf[doc]}</span>
      <button type="button" className="ad-btn" onClick={()=>setOpen(new Set(allPaths(value)))}>{words.expand}</button>
      <button type="button" className="ad-btn" onClick={()=>setOpen(new Set(['']))}>{words.collapse}</button>
      <button type="button" className="ad-btn" onClick={copy}>{words.copy}</button>
      <button type="button" className="ad-btn" onClick={download}>{words.export}</button>
      <label className="jv-compare">{words.compare}
        <select value={other?.version??''} onChange={e=>compareWith(e.target.value)} disabled={versions.length<2||loading}>
          <option value="">{words.noCompare}</option>
          {versions.filter(v=>v!==version).map(v=><option key={v} value={v}>v{v}</option>)}
        </select>
      </label>
      <span className="jv-note" role="status">{loading?words.loading:loadError?words.loadFailed:note}</span>
    </div>
    <p className="jv-path"><span>{words.path}</span> <code>{selected||'$'}</code></p>
    <div className={other?'jv-split':''}>
      <div className="jv-tree" tabIndex={0}>
        {value===null?<p className="ad-note">{words.empty}</p>:<Node name={null} value={value} path="" depth={0} open={open} toggle={toggle} marks={marks} onSelect={setSelected} words={words}/>}
      </div>
      {other&&<div className="jv-diff">
        <h3>v{other.version} → v{version}</h3>
        {changes.length===0?<p className="ad-note">{words.same}</p>:<ul>
          {changes.map(c=><li key={c.path} className={`jv-${c.kind}`}>
            <button type="button" className="jv-key" onClick={()=>setSelected(c.path)}>{c.path||'$'}</button> <em>{words[c.kind]}</em>
            {c.kind!=='added'&&<div><small>{words.before}</small> <code>{short(c.before)}</code></div>}
            {c.kind!=='removed'&&<div><small>{words.after}</small> <code>{short(c.after)}</code></div>}
          </li>)}
        </ul>}
      </div>}
    </div>
  </section>;
}
