const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const PORT = 82; // 代理服务器端口

// 定义两个 WebSocket 服务端口
const SERVICE_A_PORT = 81; // bing_server.js 服务
const SERVICE_B_PORT = 80; // server.js 服务

// 初始化代理服务器
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let activeService = null; // 当前活跃的 WebSocket 服务连接
let serviceAWebSocket = null; // 用于连接 bing_server.js (端口 81)
let serviceBWebSocket = null; // 用于连接 server.js (端口 80)

// 尝试连接到指定端口的 WebSocket 服务
const connectToWebSocketService = (port) => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    ws.on('open', () => {
      console.log(`成功连接到端口 ${port}`);
      resolve(ws);
    });

    ws.on('error', (err) => {
      console.error(`连接端口 ${port} 失败:`, err);
      reject(`连接端口 ${port} 失败`);
    });

    ws.on('close', () => {
      console.log(`连接端口 ${port} 已关闭`);
    });
  });
};

// 连接并监控两个 WebSocket 服务的状态
const monitorServices = async () => {
  try {
    // 优先连接端口 81（bing_server.js）
    serviceAWebSocket = await connectToWebSocketService(SERVICE_A_PORT);
    activeService = serviceAWebSocket;
  } catch (errorA) {
    console.log(`端口 81 不可用，尝试连接端口 80`);
    try {
      // 如果端口 81 不可用，连接端口 80（server.js）
      serviceBWebSocket = await connectToWebSocketService(SERVICE_B_PORT);
      activeService = serviceBWebSocket;
    } catch (errorB) {
      console.error(`端口 80 不可用，代理无法提供服务`);
    }
  }
};

// 定期检查 WebSocket 服务的健康状态
const healthCheck = async () => {
  if (serviceAWebSocket && serviceAWebSocket.readyState !== WebSocket.OPEN) {
    console.log('端口 81 (bing_server.js) 不可用，尝试切换到端口 80 (server.js)');
    try {
      serviceBWebSocket = await connectToWebSocketService(SERVICE_B_PORT);
      activeService = serviceBWebSocket;
    } catch (err) {
      console.log('端口 80 (server.js) 也不可用');
    }
  } else if (serviceBWebSocket && serviceBWebSocket.readyState !== WebSocket.OPEN) {
    console.log('端口 80 (server.js) 不可用，尝试切换到端口 81 (bing_server.js)');
    try {
      serviceAWebSocket = await connectToWebSocketService(SERVICE_A_PORT);
      activeService = serviceAWebSocket;
    } catch (err) {
      console.log('端口 81 (bing_server.js) 也不可用');
    }
  }
};

// 每 10 秒检查一次 WebSocket 服务的状态
setInterval(healthCheck, 10000);

// WebSocket 代理服务器处理客户端连接
wss.on('connection', (ws) => {
  console.log('客户端已连接');

  // 当有消息时，代理将消息发送到当前活跃的服务
  ws.on('message', (message) => {
    if (activeService && activeService.readyState === WebSocket.OPEN) {
      // 判断消息类型，如果是二进制数据，直接转发
      if (message instanceof ArrayBuffer || Buffer.isBuffer(message)) {
        activeService.send(message);
      } else {
        activeService.send(message);
      }
    } else {
      ws.send('没有可用的服务');
    }
  });

  // 处理从服务端接收到的消息（包括二进制数据）
  const forwardMessageFromService = (message) => {
    if (message instanceof ArrayBuffer || message instanceof Buffer) {
      // 转发二进制数据
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    } else {
      // 转发文本数据
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  };

  // 处理从服务端接收到的消息
  if (activeService) {
    activeService.on('message', forwardMessageFromService);
  }

  // 当连接关闭时，清理资源
  ws.on('close', () => {
    console.log('客户端已断开连接');
    if (activeService) {
      activeService.removeListener('message', forwardMessageFromService);
    }
  });
});

// 启动代理服务器并进行初始连接
server.listen(PORT, () => {
  console.log(`WebSocket 代理服务器正在运行在 ws://localhost:${PORT}`);
  monitorServices();
});
