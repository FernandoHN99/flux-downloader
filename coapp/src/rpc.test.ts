import { describe, expect, it, vi } from 'vitest';
import { RpcProtocol } from './rpc';

describe('RpcProtocol', () => {
  it('rejects an outbound call before a transport is connected', async () => {
    const rpc = new RpcProtocol();

    await expect(rpc.call('info')).rejects.toThrow('RPC not connected');
  });

  it('posts an outbound request and resolves its matching reply', async () => {
    const rpc = new RpcProtocol();
    const post = vi.fn();
    rpc.setPost(post);

    const result = rpc.call('sum', 2, 3);

    expect(post).toHaveBeenCalledWith({
      type: 'weh#rpc',
      _request: 1,
      _method: 'sum',
      _args: [2, 3]
    });

    rpc.receive({ type: 'weh#rpc', _reply: 1, _result: 5 });
    await expect(result).resolves.toBe(5);
  });

  it('rejects an outbound call when its reply contains an error', async () => {
    const rpc = new RpcProtocol();
    rpc.setPost(() => {});

    const result = rpc.call('explode');
    rpc.receive({ type: 'weh#rpc', _reply: 1, _error: 'boom' });

    await expect(result).rejects.toThrow('boom');
  });

  it('runs an inbound handler and posts its result', async () => {
    const rpc = new RpcProtocol();
    const post = vi.fn();
    rpc.setPost(post);
    rpc.listen({ sum: (left: number, right: number) => left + right });

    rpc.receive({
      type: 'weh#rpc',
      _request: 9,
      _method: 'sum',
      _args: [4, 7]
    });

    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({
      type: 'weh#rpc',
      _reply: 9,
      _result: 11
    }));
  });

  it('turns an inbound handler failure into an RPC error reply', async () => {
    const rpc = new RpcProtocol();
    const post = vi.fn();
    rpc.setPost(post);
    rpc.listen({ explode: () => { throw new Error('handler failed'); } });

    rpc.receive({ type: 'weh#rpc', _request: 3, _method: 'explode' });

    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({
      type: 'weh#rpc',
      _reply: 3,
      _error: 'handler failed'
    }));
  });

  it('returns a protocol error for an unknown inbound method', async () => {
    const rpc = new RpcProtocol();
    const post = vi.fn();
    rpc.setPost(post);

    rpc.receive({ type: 'weh#rpc', _request: 4, _method: 'missing' });

    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({
      type: 'weh#rpc',
      _reply: 4,
      _error: 'Method missing is not a function'
    }));
  });

  it('does not retain a pending reply when the transport throws', async () => {
    const rpc = new RpcProtocol();
    rpc.setPost(() => { throw new Error('pipe closed'); });

    await expect(rpc.call('info')).rejects.toThrow('pipe closed');
    expect((rpc as any).replies.size).toBe(0);
  });
});
