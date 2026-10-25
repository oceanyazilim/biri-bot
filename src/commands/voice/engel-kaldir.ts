import { memberRoomCommand } from './shared';

export default memberRoomCommand('engel-kaldir', 'Kullanıcının oda engelini kaldırır', 'Engeli kaldırılacak kullanıcı', (rooms, ctx, target) =>
  rooms.unblock(ctx, target),
);
