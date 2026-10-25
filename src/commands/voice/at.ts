import { memberRoomCommand } from './shared';

/** Disconnects a member from the caller's voice room only — never kicks from the server. */
export default memberRoomCommand(
  'at',
  'Bir kullanıcıyı ses odandan çıkarır (sunucudan atmaz)',
  'Odadan çıkarılacak kullanıcı',
  (rooms, ctx, target) => rooms.disconnect(ctx, target),
);
