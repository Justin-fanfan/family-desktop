import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 生产构建时注入与旧版一致的安全 CSP（开发模式不注入，便于 HMR）
const PRODUCTION_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'";

function injectCspOnBuild() {
  return {
    name: 'inject-csp-on-build',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}">`);
      }
    }
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), injectCspOnBuild()],
  resolve: {
    alias: {
      '@semi-css': path.resolve(process.cwd(), 'node_modules/@douyinfe/semi-ui/dist/css/semi.min.css')
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1'
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome120'
  }
});
