import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../core/http';
import {listProfilesForReview} from '../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listProfilesForReview(db,numberParam(url,'limit',50))) as unknown as APIRoute;
