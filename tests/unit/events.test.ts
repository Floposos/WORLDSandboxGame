import { describe, expect, it, vi } from 'vitest';
import { createGameEvents } from '../../src/core/events';

describe('EventBus', () => {
  it('stellt typisierte Events zu und meldet ab', () => {
    const bus = createGameEvents();
    const handler = vi.fn();
    const off = bus.on('toolSelected', handler);
    bus.emit('toolSelected', { toolId: 'grenade' });
    off();
    bus.emit('toolSelected', { toolId: 'meteor' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ toolId: 'grenade' });
    expect(bus.listenerCount('toolSelected')).toBe(0);
  });

  it('once feuert genau einmal', () => {
    const bus = createGameEvents();
    const handler = vi.fn();
    bus.once('providerChanged', handler);
    bus.emit('providerChanged', { providerId: 'open-data', reason: 'test' });
    bus.emit('providerChanged', { providerId: 'google', reason: 'test' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ein werfender Listener blockiert die anderen nicht', () => {
    const bus = createGameEvents();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    bus.on('impact', () => {
      throw new Error('boom');
    });
    bus.on('impact', second);
    bus.emit('impact', { posLocal: { x: 0, y: 0, z: 0 }, energyJ: 1, source: 'test' });
    expect(second).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
