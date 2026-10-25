import { simpleRoomCommand } from './shared';

export default simpleRoomCommand('ac', 'Odanın kilidini açar', (rooms, ctx) => rooms.unlock(ctx));
