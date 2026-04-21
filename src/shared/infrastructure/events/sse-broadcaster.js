'use strict';

const HEARTBEAT_INTERVAL_MS = 30_000;

function createSseBroadcaster() {
  const clients = new Set();
  const heartbeatTimer = setInterval(() => {
    for (const res of clients) {
      res.write(':heartbeat\n\n');
    }
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }

  function handleConnect(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write('event: connected\ndata: {}\n\n');

    clients.add(res);
    console.log(`[SSE] 클라이언트 연결 (총 ${clients.size}개)`);

    req.on('close', () => {
      clients.delete(res);
      console.log(`[SSE] 클라이언트 연결 해제 (총 ${clients.size}개)`);
    });
  }

  function broadcast(eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      res.write(payload);
    }
  }

  function shutdown() {
    clearInterval(heartbeatTimer);
  }

  return {
    clients,
    handleConnect,
    broadcast,
    shutdown,
  };
}

module.exports = {
  createSseBroadcaster,
};
