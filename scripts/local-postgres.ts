import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const dir=resolve('.local/postgres');mkdirSync(dir,{recursive:true});
const postgres=new EmbeddedPostgres({initdbFlags:['--encoding=UTF8','--locale=C'],databaseDir:dir,user:'postgres',password:'devcollab-local',port:55432,persistent:true,onLog:()=>{},onError:()=>{}});
if(!existsSync(resolve(dir,'PG_VERSION')))await postgres.initialise();
await postgres.start();
const client=postgres.getPgClient();await client.connect();
if(!(await client.query("SELECT 1 FROM pg_database WHERE datname='devcollab'")).rowCount)await postgres.createDatabase('devcollab');
await client.end();
console.log('Local PostgreSQL ready on 127.0.0.1:55432. Data stays in .local/postgres.');
async function stop(){await postgres.stop();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
setInterval(()=>{},60000);
