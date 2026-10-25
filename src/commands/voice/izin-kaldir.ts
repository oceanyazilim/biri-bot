import { memberRoomCommand } from './shared';

export default memberRoomCommand('izin-kaldir', 'Kullanıcının özel oda erişimini kaldırır', 'İzni kaldırılacak kullanıcı', (rooms, ctx, target) =>
  rooms.disallow(ctx, target),
);
