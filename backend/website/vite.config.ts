import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
//import wasm from 'vite-plugin-wasm';  

export default defineConfig({
  plugins: [
    nodePolyfills(),
    //wasm(),  // Add this plugin
    {
      name: "configure-response-headers",
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          next();
        });
      },
    },
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',  // Keeps top-level await support for bb.js/acvm_js
    },
    exclude: [
      '@aztec/bb.js',      // Add if not present; prevents bundling issues
      '@noir-lang/noirc_abi',
      '@noir-lang/acvm_js',  // Keep this for raw WASM loading
    ],
  },
  resolve: {
    alias: {
      pino: "pino/browser.js",
    },
  }
});