import { userPage } from '../_lib/userpage.js';
export const onRequestGet = ctx => userPage(ctx, 'ru', ctx.params.handle);
