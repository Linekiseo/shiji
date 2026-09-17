import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'io.github.linekiseo.shiji', appName: '拾迹', webDir: 'dist',
  android: { backgroundColor: '#eef6fc', allowMixedContent: false },
  plugins: { SystemBars: { style: 'LIGHT', insetsHandling: 'native', initialViewportFitValueHint: 'contain' } },
};
export default config;
