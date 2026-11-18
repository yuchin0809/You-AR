// 開発用ビルドは、別のアプリ(名前「You AR 開発」・別の Bundle ID)として入れる。
// こうすると、TestFlight で入れた本番のアプリと、同じ iPhone に両方入れられる。
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'You AR 開発' : config.name,
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV ? 'com.yuchin0809.youar.dev' : config.ios.bundleIdentifier,
  },
});
