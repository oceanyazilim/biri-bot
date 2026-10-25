import { memberRoomCommand } from './shared';

export default memberRoomCommand(
  'engelle',
  'Bir kullanıcının odana katılmasını engeller (yalnızca bu oda)',
  'Engellenecek kullanıcı',
  (rooms, ctx, target) => rooms.block(ctx, target),
);
