import { simpleRoomCommand } from './shared';

export default simpleRoomCommand('gizle', 'Odanı sıradan üyelerden gizler', (rooms, ctx) => rooms.hide(ctx));
