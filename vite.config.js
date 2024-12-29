import { defineConfig } from 'vite';
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [
    wasm(),
  ],
worker: {
    plugins: () => [
      wasm(),
    ]
  },
  build: {
    target: "esnext"
  }
});