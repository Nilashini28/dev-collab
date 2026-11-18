import { app } from './app';
import { config } from './config';
import { db } from '../../../packages/db';
import {realtime} from './realtime';
const server=app.listen(config.PORT,config.HOST,()=>console.log('DevCollab API listening on '+config.PORT));
const closeRealtime=realtime(server);
async function shutdown(){await closeRealtime();server.close();await db.$disconnect();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
