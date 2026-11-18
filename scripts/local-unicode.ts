import 'dotenv/config';
import {Client} from 'pg';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
// Local-only, additive repair: source database remains intact for rollback.
const connection=new URL(process.env.DATABASE_URL!);
if(!['localhost','127.0.0.1','[::1]'].includes(connection.hostname)||process.env.NODE_ENV==='production')throw Error('This repair is restricted to a local development database.');
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
const source=new Client({connectionString:connection.href});await source.connect();
let target:Client|undefined;
try{
 const encoding=(await source.query('SHOW server_encoding')).rows[0].server_encoding;
 if(encoding==='UTF8'){console.log('Local database is already UTF-8. No changes needed.');}
 else{
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables=(await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename as string);
  const records:Record<string,unknown[]>={};
  for(const table of tables)records[table]=(await source.query('SELECT row_to_json(t) AS row FROM '+quote(table)+' t')).rows.map(r=>r.row);
  await source.query('COMMIT');
  await mkdir('.local',{recursive:true});const stamp=randomUUID(),backup='.local/database-before-utf8-'+stamp+'.json';
  await writeFile(backup,JSON.stringify({encoding,tables:records}),{encoding:'utf8',flag:'wx'});
  const targetName='devcollab_utf8_'+stamp.replaceAll('-','');
  await source.query('CREATE DATABASE '+quote(targetName)+" WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'");
  const targetUrl=new URL(connection);targetUrl.pathname='/'+targetName;target=new Client({connectionString:targetUrl.href});await target.connect();
  await target.query('BEGIN');
  try{
   for(const migration of (await readdir('packages/db/migrations')).filter(n=>n.startsWith('2026')).sort())await target.query(await readFile('packages/db/migrations/'+migration+'/migration.sql','utf8'));
   if(records._prisma_migrations)await target.query('CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,finished_at timestamptz,migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0)');
   await target.query("SET LOCAL session_replication_role = 'replica'");
   for(const table of tables){
    if(records[table].length)await target.query('INSERT INTO '+quote(table)+' SELECT * FROM json_populate_recordset(NULL::'+quote(table)+',$1::json)',[JSON.stringify(records[table])]);
    const count=Number((await target.query('SELECT count(*) AS n FROM '+quote(table))).rows[0].n);if(count!==records[table].length)throw Error('Copy count verification failed. Original database and environment are preserved.');
   }
   const sequences=(await target.query("SELECT table_name,column_name,pg_get_serial_sequence(quote_ident(table_schema)||'.'||quote_ident(table_name),column_name) AS seq FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%'")).rows;
   for(const row of sequences)await target.query('SELECT setval($1,COALESCE(MAX('+quote(row.column_name)+'),1),MAX('+quote(row.column_name)+') IS NOT NULL) FROM '+quote(row.table_name),[row.seq]);
   await target.query('COMMIT');
  }catch(e){await target.query('ROLLBACK');throw e;}
  const original=await readFile('.env','utf8');if(!/^DATABASE_URL=.*$/m.test(original))throw Error('DATABASE_URL must be present in .env. Original database is preserved.');
  await writeFile('.local/environment-before-utf8-'+stamp+'.env',original,{flag:'wx'});
  await writeFile('.env',original.replace(/^DATABASE_URL=.*$/m,'DATABASE_URL='+targetUrl.href),'utf8');
  console.log('Copied '+tables.length+' tables to a verified UTF-8 local database. Original database retained. Backup: '+backup+'. Restart API and worker to use it.');
 }
}finally{await target?.end();await source.end();}
