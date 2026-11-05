import {apiError,authenticatedPrincipal,json,readJsonObject,requireSameOrigin,type Principal} from './identity';
import {requirePlatformAdmin} from './admin';
import {requireRecentReauth} from './integrations';
export type Handler<T>=(context:{db:D1Database;user:Principal;request:Request;url:URL;body:T})=>Promise<Record<string,unknown>>;
/** Admin routes share one guard, so no endpoint can forget it. */
export function adminGet(db:()=>D1Database,handler:Handler<null>) {
  return async ({request}:{request:Request})=>{
    try {
      const database=db();const user=await authenticatedPrincipal(database,request);await requirePlatformAdmin(database,user.id);
      return json(200,await handler({db:database,user,request,url:new URL(request.url),body:null}));
    } catch(e){return apiError(e);}
  };
}
export function adminPost(db:()=>D1Database,handler:Handler<Record<string,unknown>>,status=200) {
  return async ({request}:{request:Request})=>{
    try {
      requireSameOrigin(request);const database=db();const user=await authenticatedPrincipal(database,request);await requirePlatformAdmin(database,user.id);
      const body=await readJsonObject(request,8000);
      return json(status,await handler({db:database,user,request,url:new URL(request.url),body}));
    } catch(e){return apiError(e);}
  };
}
export const numberParam=(url:URL,name:string,fallback:number)=>Number(url.searchParams.get(name)??fallback);
/** ADMIN-002: a change to providers or credentials also needs this session re-authenticated in the last 15 minutes. */
export function criticalAdminPost(db:()=>D1Database,handler:Handler<Record<string,unknown>>) {
  return adminPost(db,async context=>{await requireRecentReauth(context.db,context.request);return handler(context);});
}
