interface D1Result<T=unknown> {meta:{changes:number};results:T[]}
interface D1PreparedStatement {
 bind(...args:unknown[]):D1PreparedStatement;
 first<T=unknown>():Promise<T|null>;
 run<T=unknown>():Promise<D1Result<T>>;
 all<T=unknown>():Promise<D1Result<T>>;
}
interface D1Database {
 prepare(sql:string):D1PreparedStatement;
 batch<T=unknown>(stmts:D1PreparedStatement[]):Promise<D1Result<T>[]>;
}
interface Env {
 DB:D1Database;
 RESEND_API_KEY?:string;
 MAIL_FROM?:string;
 PUBLIC_BASE_URL?:string;
 PAYMENTS_ENABLED?:string;
}
declare module 'astro' {
 export type APIRoute = (ctx:{request:Request;params:Record<string,string|undefined>})=>Response|Promise<Response>;
}
declare module 'cloudflare:workers' {export const env:Env;}
