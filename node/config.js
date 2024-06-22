// config.js
module.exports = {
    subscriptionKey: process.env.AZURE_SUBSCRIPTION_KEY, // 从环境变量中获取Azure订阅密钥
    region: process.env.AZURE_REGION // 从环境变量中获取Azure区域
};