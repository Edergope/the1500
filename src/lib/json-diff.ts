/** Differences between two JSON documents, by path. Used to compare profile versions. */
export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export interface JsonChange {path:string;kind:'added'|'removed'|'changed';before?:JsonValue;after?:JsonValue;}
const isObject=(v:JsonValue|undefined):v is {[key:string]:JsonValue}=>typeof v==='object'&&v!==null&&!Array.isArray(v);
export const joinPath=(parent:string,key:string|number)=>typeof key==='number'?`${parent}[${key}]`:parent?`${parent}.${key}`:key;
export function diffJson(before:JsonValue|undefined,after:JsonValue|undefined,path=''):JsonChange[] {
  if (before===undefined&&after===undefined) return [];
  if (before===undefined) return [{path,kind:'added',after}];
  if (after===undefined) return [{path,kind:'removed',before}];
  if (Array.isArray(before)&&Array.isArray(after)) {
    const changes:JsonChange[]=[];
    for (let i=0;i<Math.max(before.length,after.length);i++) changes.push(...diffJson(before[i],after[i],joinPath(path,i)));
    return changes;
  }
  if (isObject(before)&&isObject(after)) {
    const changes:JsonChange[]=[];
    for (const key of new Set([...Object.keys(before),...Object.keys(after)])) changes.push(...diffJson(before[key],after[key],joinPath(path,key)));
    return changes;
  }
  return before===after?[]:[{path,kind:'changed',before,after}];
}
