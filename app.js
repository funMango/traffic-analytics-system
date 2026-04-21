'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');

const intersectionsRouter = require('./routes/intersections');
const trafficRouter = require('./routes/traffic');
const homeRouter = require('./routes/home');

const app = express();

app.use(express.json());
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// API 라우터
app.use('/api/intersections', intersectionsRouter);
app.use('/api/traffic', trafficRouter);
app.use('/api/home', homeRouter);

// SSE 클라이언트 관리
const sseClients = new Set();

// Heartbeat: 30초마다 연결 유지
setInterval(() => {
  for (const res of sseClients) {
    res.write(':heartbeat\n\n');
  }
}, 30_000);

// SSE 엔드포인트
app.get('/api/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 연결 확인 이벤트
  res.write('event: connected\ndata: {}\n\n');

  sseClients.add(res);
  console.log(`[SSE] 클라이언트 연결 (총 ${sseClients.size}개)`);

  req.on('close', () => {
    sseClients.delete(res);
    console.log(`[SSE] 클라이언트 연결 해제 (총 ${sseClients.size}개)`);
  });
});

// SSE 브로드캐스트 함수 (poller에서 사용)
function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

app.broadcast = broadcast;
app.sseClients = sseClients;

module.exports = app;
