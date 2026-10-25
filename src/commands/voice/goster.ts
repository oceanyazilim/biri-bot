import { simpleRoomCommand } from './shared';

export default simpleRoomCommand('goster', 'Odanı tekrar görünür yapar', (rooms, ctx) => rooms.show(ctx));
