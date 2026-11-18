// 3Dモデル(.glb)をアプリに同梱できるようにする
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb');
module.exports = config;
