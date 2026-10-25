import { simpleRoomCommand } from './shared';

export default simpleRoomCommand('limitsiz', 'Odanın kullanıcı limitini kaldırır', (rooms, ctx) => rooms.setLimit(ctx, 0));
