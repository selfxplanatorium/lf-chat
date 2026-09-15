import { mergeResources } from './resources';
import { account } from './locales/account';
import { app } from './locales/app';
import { chat } from './locales/chat';

export const appResources = mergeResources(account, app, chat);
