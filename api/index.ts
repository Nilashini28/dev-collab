import {createServer} from 'node:http';
import {app} from '../apps/api/src/app';
import {realtime} from '../apps/api/src/realtime';
// Vercel's Node HTTP server entrypoint also handles WebSocket upgrades.
const server=createServer(app);
realtime(server);
export default server;
