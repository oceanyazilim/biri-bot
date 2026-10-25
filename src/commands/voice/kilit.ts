import { simpleRoomCommand } from './shared';

export default simpleRoomCommand('kilit', 'Odanı kilitler; yeni kullanıcılar katılamaz', (rooms, ctx) => rooms.lock(ctx));
