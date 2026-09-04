import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionError, TimeoutError } from '../shared/errors';
import { NativeClient } from './native-client';

class EventHook<Args extends unknown[]> {
  private listeners: Array<(...args: Args) => void> = [];

  addListener = vi.fn((listener: (...args: Args) => void) => {
    this.listeners.push(listener);
  });

  emit(...args: Args): void {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

function fakePort() {
  const onMessage = new EventHook<[any]>();
  const onDisconnect = new EventHook<[]>();
  const port = {
    name: 'com.fluxdownloader.coapp',
    postMessage: vi.fn(),
    disconnect: vi.fn(() => onDisconnect.emit()),
    onMessage,
    onDisconnect
  } as unknown as chrome.runtime.Port;
  return { port, onMessage, onDisconnect };
}

describe('NativeClient', () => {
  let connectNative: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    connectNative = vi.fn();
    (chrome.runtime as any).connectNative = connectNative;
    (chrome.runtime as any).lastError = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connects once and reuses a live native port', async () => {
    const transport = fakePort();
    connectNative.mockReturnValue(transport.port);
    const client = new NativeClient();

    await Promise.all([client.connect(), client.connect()]);

    expect(connectNative).toHaveBeenCalledTimes(1);
    expect(connectNative).toHaveBeenCalledWith('com.fluxdownloader.coapp');
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('can retry after connectNative throws synchronously', async () => {
    const transport = fakePort();
    connectNative
      .mockImplementationOnce(() => { throw new Error('host missing'); })
      .mockReturnValueOnce(transport.port);
    const client = new NativeClient();

    await expect(client.connect()).rejects.toMatchObject({
      name: 'CoAppError',
      code: 'CONNECTION_ERROR',
      message: 'host missing'
    });
    await expect(client.connect()).resolves.toBeUndefined();

    expect(connectNative).toHaveBeenCalledTimes(2);
    client.disconnect();
  });

  it('sends an RPC request and resolves its matching reply', async () => {
    const transport = fakePort();
    connectNative.mockReturnValue(transport.port);
    const client = new NativeClient();
    await client.connect();

    const result = client.call<{ version: string }>('info');
    const request = (transport.port.postMessage as any).mock.calls[0][0];
    expect(request).toMatchObject({
      type: 'weh#rpc',
      _request: 1,
      _method: 'info',
      _args: []
    });
    transport.onMessage.emit({ type: 'weh#rpc', _reply: 1, _result: { version: '1.1.1' } });

    await expect(result).resolves.toEqual({ version: '1.1.1' });
    client.disconnect();
  });

  it('rejects RPC error replies', async () => {
    const transport = fakePort();
    connectNative.mockReturnValue(transport.port);
    const client = new NativeClient();
    await client.connect();

    const result = client.call('ping');
    transport.onMessage.emit({ type: 'weh#rpc', _reply: 1, _error: 'native failure' });

    await expect(result).rejects.toThrow('native failure');
    client.disconnect();
  });

  it('times out ordinary RPC calls but leaves long-running conversions untimed', async () => {
    const transport = fakePort();
    connectNative.mockReturnValue(transport.port);
    const client = new NativeClient();
    await client.connect();

    const ordinary = client.call('info');
    const conversion = client.call('convert', ['-i', 'input']);
    const ordinaryAssertion = expect(ordinary).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(60_000);

    await ordinaryAssertion;
    let conversionSettled = false;
    void conversion.finally(() => { conversionSettled = true; });
    await Promise.resolve();
    expect(conversionSettled).toBe(false);
    transport.onMessage.emit({ type: 'weh#rpc', _reply: 2, _result: { exitCode: 0 } });
    await conversion;
    client.disconnect();
  });

  it('replies to calls initiated by the CoApp', async () => {
    const transport = fakePort();
    connectNative.mockReturnValue(transport.port);
    const client = new NativeClient();
    client.listen({ progress: (value: number) => value * 2 });
    await client.connect();

    transport.onMessage.emit({
      type: 'weh#rpc',
      _request: 9,
      _method: 'progress',
      _args: [21]
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.port.postMessage).toHaveBeenCalledWith({
      type: 'weh#rpc',
      _reply: 9,
      _result: 42
    });
    client.disconnect();
  });

  it('returns an RPC error for an unknown incoming method', async () => {
    const transport = fakePort();
    connectNative.mockReturnValue(transport.port);
    const client = new NativeClient();
    await client.connect();

    transport.onMessage.emit({ type: 'weh#rpc', _request: 3, _method: 'missing' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.port.postMessage).toHaveBeenCalledWith({
      type: 'weh#rpc',
      _reply: 3,
      _error: 'Method missing is not a function'
    });
    client.disconnect();
  });

  it('rejects pending calls and reconnects after an unexpected disconnect', async () => {
    const first = fakePort();
    const second = fakePort();
    connectNative.mockReturnValueOnce(first.port).mockReturnValueOnce(second.port);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const client = new NativeClient();
    await client.connect();
    const pending = client.call('info');
    const pendingAssertion = expect(pending).rejects.toBeInstanceOf(ConnectionError);

    (chrome.runtime as any).lastError = { message: 'native host exited' };
    first.onDisconnect.emit();
    await pendingAssertion;
    expect(client.connected).toBe(false);

    (chrome.runtime as any).lastError = undefined;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(connectNative).toHaveBeenCalledTimes(2);
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('does not reconnect after an intentional disconnect', async () => {
    const transport = fakePort();
    connectNative.mockReturnValue(transport.port);
    const client = new NativeClient();
    await client.connect();

    client.disconnect();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(connectNative).toHaveBeenCalledTimes(1);
    expect(client.connected).toBe(false);
  });
});
