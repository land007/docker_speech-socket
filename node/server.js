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
const EXIST_VOICE = 3; // 假设 existVoice 为 3
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
let clients = [];

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
                console.log('Azure WebSocket连接已打开', event);
                resolve();
            };

            // 接收到消息时的处理
            azureWebSocket.onmessage = (event) => {
                console.log('收到Azure消息:', event.data);

                if (event.data instanceof ArrayBuffer) {
                    const base64Data = arrayBufferToBase64(event.data);
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ dataType: 'base64', data: base64Data }));
                        }
                    });
                } else {
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ dataType: 'string', data: event.data }));
                        }
                    });
                }
            };

            // 连接关闭时的处理
            azureWebSocket.onclose = (event) => {
                console.log('Azure WebSocket连接已关闭', event);
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

// 定义 getWSAudio 函数
const getWSAudio = (date, requestId) => {
    return EXIST_VOICE === 3
        ? `Path: synthesis.context\r\nX-RequestId: ${requestId}\r\nX-Timestamp: ${date}\r\nContent-Type: application/json\r\n\r\n{"synthesis":{"audio":{"metadataOptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}`
        : `X-Timestamp:${date}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
};

// 定义 getWSText 函数
const getWSText = (date, requestId, lang, voice, volume, rate, pitch, style, role, msg) => {
    let fmtVolume = volume === 1 ? "+0%" : volume * 100 - 100 + "%";
    let fmtRate = (rate >= 1 ? "+" : "") + (rate * 100 - 100) + "%";
    let fmtPitch = (pitch >= 1 ? "+" : "") + (pitch - 1) + "Hz";

    if (EXIST_VOICE === 3) {
        let fmtStyle = style ? ` style="${style}"` : "";
        let fmtRole = role ? ` role="${role}"` : "";
        let fmtExpress = fmtStyle + fmtRole;
        return `Path: ssml\r\nX-RequestId: ${requestId}\r\nX-Timestamp: ${date}\r\nContent-Type: application/ssml+xml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='${lang}'><voice name='${voice}'><mstts:express-as${fmtExpress}><prosody pitch='${fmtPitch}' rate='${fmtRate}' volume='${fmtVolume}'>${msg}</prosody></mstts:express-as></voice></speak>`;
    } else {
        return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='${fmtPitch}' rate='${fmtRate}' volume='${fmtVolume}'>${msg}</prosody></voice></speak>`;
    }
};

// 修改 sendTextToSpeechRequest 函数
const sendTextToSpeechRequest = (client, text, lang, voice, volume, rate) => {
    if (azureWebSocket.readyState === WebSocket.OPEN) {
        const requestId = uuidv4();
        const timestamp = getTime();
        const selectedStyle = null;
        const audioRequest = getWSAudio(timestamp, requestId);
        const ssmlRequest = getWSText(timestamp, requestId, lang, `Microsoft Server Speech Text to Speech Voice (${lang}, ${voice})`, volume, rate, 1, selectedStyle, null, text);

        azureWebSocket.send(audioRequest);
        azureWebSocket.send(ssmlRequest);

        // 处理 Azure WebSocket 的消息
        azureWebSocket.onmessage = (event) => {
            console.log('收到Azure消息:', event.data);

            if (event.data instanceof ArrayBuffer) {
                const base64Data = arrayBufferToBase64(event.data);
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ dataType: 'base64', data: base64Data }));
                }
            } else {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ dataType: 'string', data: event.data }));
                }
            }
        };

    } else {
        console.error('Azure WebSocket is not open. Unable to send text to speech request.');
    }
};

// 处理新的 WebSocket 连接
wss.on('connection', (ws) => {
    console.log('客户端已连接');
    clients.push(ws);

    ws.on('message', (message) => {
        console.log('收到客户端消息:', message);
        const { text, lang, voice, volume, rate } = JSON.parse(message);

        if (!azureWebSocket || azureWebSocket.readyState !== WebSocket.OPEN) {
            connectToAzureWebSocket().then(() => {
                sendTextToSpeechRequest(ws, text, lang, voice, volume, rate); // 传递客户端的WebSocket实例
            }).catch((error) => {
                console.error('连接 Azure WebSocket 失败:', error);
            });
        } else {
            sendTextToSpeechRequest(ws, text, lang, voice, volume, rate); // 传递客户端的WebSocket实例
        }
    });

    ws.on('close', () => {
        console.log('客户端已断开连接');
        clients = clients.filter(client => client !== ws);
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

// 辅助函数：生成 UUID
const uuidv4 = () => {
    let uuid = ([1e7] + 1e3 + 4e3 + 8e3 + 1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
    return EXIST_VOICE === 3 ? uuid.toUpperCase() : uuid;
};

// 辅助函数：获取当前时间
const getTime = () => {
    return EXIST_VOICE === 3 ? new Date().toISOString() : new Date().toString();
};

// 辅助函数：将 ArrayBuffer 转换为 Base64 字符串
const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    let bytes = new Uint8Array(buffer);
    let len = bytes.byteLength;

    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return Buffer.from(binary, 'binary').toString('base64');
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
