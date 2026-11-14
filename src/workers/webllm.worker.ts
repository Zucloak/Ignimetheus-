import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};

self.onerror = () => {
  // Handled by host worker.onerror recovery listener
};

self.onunhandledrejection = () => {
  // Handled by host recovery listener
};
