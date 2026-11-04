import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet} from '../../../../core/http';
import {integrationStatus} from '../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async()=>integrationStatus(env)) as unknown as APIRoute;
