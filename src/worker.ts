import {handle} from '@astrojs/cloudflare/handler';
import {maintenanceSweep} from './core/ops';
import {sweepPayments} from './core/payments';

/** Astro serves requests. The cron keeps time-driven state honest even with no traffic. */
export default {
  fetch(request:Request,env:Env,context:ExecutionContext) {return handle(request,env,context);},
  async scheduled(_controller:ScheduledController,env:Env,context:ExecutionContext) {
    const now=new Date();
    context.waitUntil((async()=>{
      await sweepPayments(env.DB,env,now);
      await maintenanceSweep(env.DB,env,now);
    })());
  },
};
