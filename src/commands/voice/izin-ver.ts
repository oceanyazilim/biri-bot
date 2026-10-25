import { memberRoomCommand } from './shared';

export default memberRoomCommand(
  'izin-ver',
  'Kilitli veya gizli odana bir kullanıcının katılmasına izin verir',
  'İzin verilecek kullanıcı',
  (rooms, ctx, target) => rooms.allow(ctx, target),
);
