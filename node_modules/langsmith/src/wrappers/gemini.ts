// Entrypoint shim: `langsmith/<name>` -> hand-written code in src/lib (kept from langsmith-sdk).
export * from '../lib/wrappers/gemini';
export { default } from '../lib/wrappers/gemini';
