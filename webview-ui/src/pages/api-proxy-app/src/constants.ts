import type { ApiProxyServerState } from '@pages/api-proxy-app/src/type';

export const DEFAULT_SERVER: ApiProxyServerState = {
  running: false,
  port: 0,
  origin: '',
  listenHost: '127.0.0.1',
  listenHosts: ['127.0.0.1', '0.0.0.0'],
  listenPort: 57197,
  devServerOrigin: 'http://localhost:8081',
};
