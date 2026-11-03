import Anthropic from '@anthropic-ai/sdk';

/**
 * Provider-neutral contract. The rest of the core only sees this interface, so swapping vendors
 * means adding one adapter here. Calls happen on the server only and the key never leaves it.
 */
export interface LlmJsonRequest {system:string;user:string;schema:Record<string,unknown>;maxTokens:number;}
export interface LlmJsonResult {json:unknown;provider:string;model:string;}
export interface LlmProvider {name:string;model:string;completeJson(request:LlmJsonRequest):Promise<LlmJsonResult>;}
export class LlmError extends Error {constructor(public reason:'refused'|'truncated'|'invalid_json'|'provider_failure',message?:string){super(message||reason);this.name='LlmError';}}
export interface LlmEnv {AI_PROVIDER?:string;AI_API_KEY?:string;AI_MODEL?:string;AI_BASE_URL?:string;}
const DEFAULT_ANTHROPIC_MODEL='claude-opus-5-5';

function anthropicProvider(env:LlmEnv):LlmProvider {
  const client=new Anthropic({apiKey:env.AI_API_KEY,timeout:45_000,maxRetries:1,...(env.AI_BASE_URL?{baseURL:env.AI_BASE_URL}:{})});
  const model=env.AI_MODEL||DEFAULT_ANTHROPIC_MODEL;
  return {name:'anthropic',model,async completeJson(request) {
    let response;
    try {
      response=await client.beta.messages.create({
        model,max_tokens:request.maxTokens,system:request.system,
        messages:[{role:'user',content:request.user}],
        betas:['server-side-fallback-2026-07-01'],
        fallbacks:'default',
        output_config:{effort:'medium',format:{type:'json_schema',schema:request.schema}},
      } as unknown as Parameters<typeof client.beta.messages.create>[0],{}) as Anthropic.Beta.BetaMessage;
    } catch (error) {
      throw new LlmError('provider_failure',error instanceof Error?error.message:undefined);
    }
    if (response.stop_reason==='refusal') throw new LlmError('refused');
    if (response.stop_reason==='max_tokens') throw new LlmError('truncated');
    const text=response.content.flatMap(block=>block.type==='text'?[block.text]:[]).join('');
    try {return {json:JSON.parse(text),provider:'anthropic',model:response.model||model};}
    catch {throw new LlmError('invalid_json');}
  }};
}
/** null means AI is off: callers must say so instead of pretending a model produced the output. */
export function getLlmProvider(env:LlmEnv):LlmProvider|null {
  if (!env.AI_API_KEY) return null;
  if (env.AI_PROVIDER==='anthropic') return anthropicProvider(env);
  return null;
}
