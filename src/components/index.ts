import type { ComponentHandler } from '../types/command';
import { guardModeHandler } from './guardMode';
import { guardRestoreHandler } from './guardRestore';
import { roomPanelHandler } from './roomPanel';

export const ALL_COMPONENTS: ComponentHandler[] = [roomPanelHandler, guardRestoreHandler, guardModeHandler];

export function buildComponentMap(handlers: ComponentHandler[] = ALL_COMPONENTS): Map<string, ComponentHandler> {
  return new Map(handlers.map((handler) => [handler.prefix, handler]));
}
