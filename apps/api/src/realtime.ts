import {Server} from 'socket.io';
import type {Server as HttpServer} from 'node:http';
import {Redis} from 'ioredis';
import {createAdapter} from '@socket.io/redis-streams-adapter';
import {config} from './config';
import {auth} from './auth';
import {db} from '../../../packages/db';
import {conversationScope} from './chat';
export function realtime(server:HttpServer){
 const io=new Server(server,{transports:['websocket'],cors:{origin:config.APP_ORIGIN,credentials:true},allowRequest:(req,callback)=>callback(null,req.headers.origin===config.APP_ORIGIN)});
 let redis:Redis|undefined;
 if(process.env.SOCKET_REDIS==='true'){
  redis=new Redis(config.REDIS_URL,{maxRetriesPerRequest:null});redis.on('error',()=>console.error('Socket Redis adapter unavailable.'));
  io.adapter(createAdapter(redis));
 }
 io.use(async(socket,next)=>{
  try{const headers=new Headers();if(socket.handshake.headers.cookie)headers.set('cookie',socket.handshake.headers.cookie);
   const session=await auth.api.getSession({headers});if(!session?.user.emailVerified)return next(new Error('Sign in required.'));
   socket.data.actor=session.user;socket.data.headers=headers;next();
  }catch{next(new Error('Sign in required.'));}
 });
 io.on('connection',socket=>{
  socket.on('subscribe',async(id:unknown,ack:(result:unknown)=>void)=>{
   if(typeof ack!=='function')return;
   try{if(typeof id!=='string'||id.length>128)throw new Error();await conversationScope(db,id,socket.data.actor);for(const room of socket.rooms)if(room.startsWith('conversation:'))await socket.leave(room);await socket.join('conversation:'+id);ack({ok:true});}
   catch{ack({ok:false});}
  });
 });
 let running=false;let lastEvent=new Date(0);let lastEventId='';
 const timer=setInterval(async()=>{
  if(running)return;running=true;
  try{
   for(const socket of io.sockets.sockets.values()){
    const session=await auth.api.getSession({headers:socket.data.headers});if(!session?.user.emailVerified){socket.disconnect(true);continue;}
    for(const room of socket.rooms)if(room.startsWith('conversation:'))try{await conversationScope(db,room.slice(13),socket.data.actor);}catch{socket.disconnect(true);}
   }
   // Each node reads durable outbox hints. Reconnect fetches REST history.
   const events=await db.outboxEvent.findMany({where:{type:'message.created',OR:[{createdAt:{gt:lastEvent}},{createdAt:lastEvent,id:{gt:lastEventId}}]},orderBy:[{createdAt:'asc'},{id:'asc'}],take:200});
   for(const event of events){
    const message=await db.message.findUnique({where:{id:event.entityId}});if(!message)continue;
    for(const socket of io.sockets.sockets.values()){
     if(socket.rooms.has('conversation:'+message.conversationId)){
      try{await conversationScope(db,message.conversationId,socket.data.actor);socket.emit('message.created',{id:event.id,conversationId:message.conversationId,sequence:message.sequence});}catch{socket.disconnect(true);}
     }
    }
   }
   if(events.length){lastEvent=events.at(-1)!.createdAt;lastEventId=events.at(-1)!.id;}
  }catch{console.error('Realtime reconciliation failed.');}finally{running=false;}
 },1000);
 return async()=>{clearInterval(timer);await io.close();if(redis)await redis.quit();};
}
