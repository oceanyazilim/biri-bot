import { memberRoomCommand } from './shared';

export default memberRoomCommand('devret', 'Oda sahipliğini odadaki başka bir kullanıcıya devreder', 'Yeni oda sahibi', (rooms, ctx, target) =>
  rooms.transfer(ctx, target),
);
