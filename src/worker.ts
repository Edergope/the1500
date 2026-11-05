import {handle} from '@astrojs/cloudflare/handler';
import {maintenanceSweep} from './core/ops';
import {sweepPayments} from './core/payments';

/** Astro serves requests. The cron keeps time-driven state honest even with no traffic. */
export default {
  fetch(request:Request,env:Env,context:ExecutionContext) {
    // Existing assets never reach this code. A miss here is a passing version mismatch during a deploy, and must not be remembered.
    if (new URL(request.url).pathname.startsWith('/_astro/')) return new Response('Not found',{status:404,headers:{'content-type':'text/plain','cache-control':'no-store'}});
    return handle(request,env,context);
  },
  async scheduled(_controller:ScheduledController,env:Env,context:ExecutionContext) {
    const now=new Date();
    context.waitUntil((async()=>{
      await sweepPayments(env.DB,env,now);
      await maintenanceSweep(env.DB,env,now);
    })());
  },
};
