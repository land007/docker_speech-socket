const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const request = require('request');

// 常量定义
const PORT = 81;
const ttSBaseUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const secMsGecUrl = 'https://edge-sec.myaitool.top/?key=edge'; // 替换为实际的 GEC 信息 API
const trustedClientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'; // TTS 服务器 Token
const existVoice = 2;

// 动态生成 ConnectionId
const uuidv4 = () => {
    let uuid = ([1e7] + 1e3 + 4e3 + 8e3 + 1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
    return existVoice === 3 ? uuid.toUpperCase() : uuid;
};

/**
 * 获取 Sec-MS-GEC 信息
 * @param {string} secMsGecUrl 请求 Sec-MS-GEC 信息的 URL 地址
 * @returns {Promise<{sec_ms_gec_id: string, sec_ms_gec_version: string}>}
 */
const fetchSecMsGecInfo = (secMsGecUrl) => {
    return new Promise((resolve, reject) => {
        request(secMsGecUrl, { json: true }, (error, response, body) => {
            if (error) {
                console.error('Error fetching Sec-MS-GEC info:', error);
                return reject(new Error('Failed to fetch Sec-MS-GEC data'));
            }
            if (response.statusCode !== 200) {
                console.error('Non-200 response:', response.statusCode);
                return reject(new Error(`Failed to fetch Sec-MS-GEC data: ${response.statusCode}`));
            }
            if (body['Sec-MS-GEC'] && body['Sec-MS-GEC-Version']) {
                resolve({
                    sec_ms_gec_id: body['Sec-MS-GEC'],
                    sec_ms_gec_version: body['Sec-MS-GEC-Version'],
                });
            } else {
                reject(new Error('Invalid Sec-MS-GEC response format'));
            }
        });
    });
};

// 创建动态的 WebSocket URL
const createWebSocketUrl = async () => {
    try {
        const { sec_ms_gec_id, sec_ms_gec_version } = await fetchSecMsGecInfo(secMsGecUrl);
        const connectionId = uuidv4();
        return `${ttSBaseUrl}?TrustedClientToken=${trustedClientToken}&Sec-MS-GEC=${sec_ms_gec_id}&Sec-MS-GEC-Version=${sec_ms_gec_version}&ConnectionId=${connectionId}`;
    } catch (error) {
        console.error('Failed to create WebSocket URL:', error);
        throw error;
    }
};

// 创建 Express 应用
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// 创建 HTTP 服务器
const server = http.createServer(app);

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server });

let bingWebSocket;

// 初始化目标 WebSocket 连接
const connectToTargetWebSocket = async () => {
    try {
        const wsUrl = await createWebSocketUrl();
        console.log('wsUrl', wsUrl);
        bingWebSocket = new WebSocket(wsUrl);
        bingWebSocket.binaryType = 'arraybuffer';

        bingWebSocket.onopen = () => console.log('Bing WebSocket 连接已打开');
        bingWebSocket.onclose = () => {
            console.log('Bing WebSocket 连接已关闭');
            reconnectTargetWebSocket();
        };
        bingWebSocket.onerror = (error) => {
            console.error('Bing WebSocket 连接发生错误:');//, error
            reconnectTargetWebSocket();
        };
    } catch (error) {
        console.error('连接 Bing WebSocket 失败:', error);
    }
};

// 重新连接目标 WebSocket
const reconnectTargetWebSocket = () => {
    setTimeout(() => {
        connectToTargetWebSocket().catch((error) => {
            console.error('重新连接 Bing WebSocket 失败:', error);
        });
    }, 5000); // 5秒后重新连接
};

// 转发消息
const forwardMessageToTarget = (client, message) => {
    if (bingWebSocket.readyState === WebSocket.OPEN) {
        console.log('向 Bing WebSocket 发送消息:', message.toString());
        bingWebSocket.send(message.toString());

        bingWebSocket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(event.data); // 转发二进制数据
                }
            } else {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(event.data); // 转发文本数据
                }
            }
        };
    } else {
        console.error('Bing WebSocket 未打开，无法发送消息');
    }
};

// 处理新的 WebSocket 连接
wss.on('connection', (ws) => {
    console.log('客户端已连接');

    ws.on('message', (message) => {
        if (!bingWebSocket || bingWebSocket.readyState !== WebSocket.OPEN) {
            connectToTargetWebSocket().then(() => {
                forwardMessageToTarget(ws, message);
            }).catch((error) => {
                console.error('连接 Bing WebSocket 失败:', error);
            });
        } else {
            forwardMessageToTarget(ws, message);
        }
    });

    ws.on('close', () => console.log('客户端已断开连接'));
});

// 启动服务器
server.listen(PORT, () => {
    console.log(`服务器正在运行在 http://127.0.0.1:${PORT}`);
});

// 初始连接到目标 WebSocket
connectToTargetWebSocket().catch((error) => {
    console.error('启动时连接 Bing WebSocket 失败:', error);
});
