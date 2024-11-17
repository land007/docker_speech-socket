const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const request = require('request');
const config = require('./config'); // 引入配置文件

// 常量定义
const PORT = 80;
const AZURE_TOKEN_URL = `https://${config.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
const AZURE_WEBSOCKET_URL = `wss://${config.region}.tts.speech.microsoft.com/cognitiveservices/websocket/v1?Authorization=bearer%20`;
const HEARTBEAT_INTERVAL = 30 * 1000; // 30秒
const TOKEN_REFRESH_INTERVAL = 5 * 60 * 1000; // 5分钟

// 创建 Express 应用
const app = express();

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 创建 HTTP 服务器，并将 Express 应用作为中间件
const server = http.createServer(app);

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server });

const subscriptionKey = config.subscriptionKey;
const region = config.region;

let azureWebSocket;
let trustedClientToken = ''; // 用于存储获取的令牌

// 更新 Azure 令牌的函数
const updateAuthorizationToken = async () => {
    try {
        const token = await getAuthorizationToken(subscriptionKey, region);
        trustedClientToken = token;
        console.log('令牌已更新:', token);
    } catch (error) {
        console.error('获取令牌错误:', error);
    }
};

// 获取 Azure 令牌的函数
const getAuthorizationToken = (subscriptionKey, region) => {
    return new Promise((resolve, reject) => {
        const options = {
            url: AZURE_TOKEN_URL,
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': subscriptionKey,
                'Content-Length': '0'
            }
        };

        request(options, (error, response, body) => {
            if (error) {
                return reject(error);
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to fetch token: ${response.statusCode}`));
            }
            resolve(body);
        });
    });
};

// 初始化 Azure WebSocket 连接
const connectToAzureWebSocket = () => {
    return new Promise((resolve, reject) => {
        if (!azureWebSocket || azureWebSocket.readyState > 1) {
            azureWebSocket = new WebSocket(`${AZURE_WEBSOCKET_URL}${trustedClientToken}`);
            azureWebSocket.binaryType = "arraybuffer";

            // 连接成功时的处理
            azureWebSocket.onopen = (event) => {
                console.log('Azure WebSocket连接已打开');
                resolve();
            };

            // 连接关闭时的处理
            azureWebSocket.onclose = (event) => {
                console.log('Azure WebSocket连接已关闭');
                reconnectAzureWebSocket();
            };

            // 连接发生错误时的处理
            azureWebSocket.onerror = (error) => {
                console.error('Azure WebSocket连接发生错误:', error);
                reject(error);
                reconnectAzureWebSocket();
            };
        } else {
            resolve();
        }
    });
};

// 重新连接 Azure WebSocket
const reconnectAzureWebSocket = () => {
    setTimeout(() => {
        connectToAzureWebSocket().catch((error) => {
            console.error('重新连接 Azure WebSocket 失败:', error);
        });
    }, 5000); // 5秒后重新连接
};

// 修改 sendTextToSpeechRequest 函数
const sendTextToSpeechRequest = (client, message) => {
    if (azureWebSocket.readyState === WebSocket.OPEN) {
        console.log('向Azure发送消息:', message.toString());
        azureWebSocket.send(message.toString());

        // 处理 Azure WebSocket 的消息
        azureWebSocket.onmessage = (event) => {
            //console.log('收到Azure消息:', event.data);

            if (event.data instanceof ArrayBuffer) {
                // 直接转发二进制数据
                if (client.readyState === WebSocket.OPEN) {
                    //console.log('转发二进制数据给客户端');
                    client.send(event.data);
                }
            } else {
                // 直接转发文本数据
                if (client.readyState === WebSocket.OPEN) {
                    console.log('转发文本数据给客户端:', event.data);
                    client.send(event.data);
                }
            }
        };

    } else {
        console.error('Azure WebSocket is not open. Unable to send text to speech request.', azureWebSocket.readyState);
    }
};

// 处理新的 WebSocket 连接
wss.on('connection', (ws) => {
    console.log('客户端已连接');

    ws.on('message', (message) => {
        console.log('收到客户端消息:', message);

        if (!azureWebSocket || azureWebSocket.readyState !== WebSocket.OPEN) {
            connectToAzureWebSocket().then(() => {
                sendTextToSpeechRequest(ws, message); // 传递客户端的WebSocket实例
            }).catch((error) => {
                console.error('连接 Azure WebSocket 失败:', error);
            });
        } else {
            sendTextToSpeechRequest(ws, message); // 传递客户端的WebSocket实例
        }
    });

    ws.on('close', () => {
        console.log('客户端已断开连接');
    });
});

// 启动服务器并初次获取 Azure 令牌
const startServer = async () => {
    try {
        await updateAuthorizationToken(); // 获取初始令牌
        await connectToAzureWebSocket();  // 初始化 WebSocket 连接

        server.listen(PORT, () => {
            console.log(`服务器正在运行在 http://127.0.0.1:${PORT}`);
        });

        // 每隔5分钟更新一次令牌
        setInterval(updateAuthorizationToken, TOKEN_REFRESH_INTERVAL);
    } catch (error) {
        console.error('启动服务器错误:', error);
    }
};

// 定期发送心跳消息以保持 WebSocket 连接
const sendHeartbeat = () => {
    if (azureWebSocket && azureWebSocket.readyState === WebSocket.OPEN) {
        azureWebSocket.send('ping');
    }
};

// 每 30 秒发送一次心跳消息
setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

// 启动服务器
startServer();