// On-device language models for the phone app: Hugging Face transformers.js (ONNX Runtime Web) running inside the web view.
// WebGPU when the device has it, WebAssembly (CPU) otherwise. Weights are downloaded once and kept in the browser cache.
// Bundled by scripts/build-device.js into src/ai/device-engine.js; it is loaded only when someone picks the on-device provider.
import { env, AutoTokenizer, AutoModelForCausalLM, Qwen3_5ForConditionalGeneration, Mistral3ForConditionalGeneration as MinistralLoader, TextStreamer, InterruptableStoppingCriteria } from '@huggingface/transformers';

// Models that ship as image+text (the vision part is never used here, but the loader of that family has to be used).
const FAMILIES = { causal: AutoModelForCausalLM, qwen3_5: Qwen3_5ForConditionalGeneration, ministral: MinistralLoader };

env.allowLocalModels = false;
env.useBrowserCache = true;
// The ONNX Runtime files ship inside the app (vendor/ort), so the engine starts without the network once a model is cached.
const gpu = typeof navigator !== 'undefined' && !!navigator.gpu;
const flavour = gpu ? '.asyncify' : '';
env.backends.onnx.wasm.wasmPaths = { mjs: `vendor/ort/ort-wasm-simd-threaded${flavour}.mjs`, wasm: `vendor/ort/ort-wasm-simd-threaded${flavour}.wasm` };

let current = null;                                   // { key, tokenizer, model }

async function adapter() {
    if (!gpu) return null;
    try { return await navigator.gpu.requestAdapter(); } catch { return null; }
}
// What this device can do: the backend and the weight format that suits it.
async function capabilities() {
    const found = await adapter();
    const f16 = !!(found && found.features && found.features.has('shader-f16'));
    return found ? { backend: 'webgpu', dtype: f16 ? 'q4f16' : 'q4' } : { backend: 'wasm', dtype: 'q8' };
}

// repo: Hugging Face repository; returns when the weights are downloaded and the model is ready to answer.
async function load({ repo, dtype, backend, family = 'causal' }, onProgress) {
    const key = `${repo}|${dtype}|${backend}`;
    if (current && current.key === key) return current;
    await unload();
    const files = new Map();
    const progress = info => {
        if (info.status === 'progress' && info.file) { files.set(info.file, { loaded: info.loaded || 0, total: info.total || 0 }); }
        if (onProgress) {
            let loaded = 0, total = 0;
            files.forEach(entry => { loaded += entry.loaded; total += entry.total; });
            onProgress({ status: info.status, file: info.file || '', loaded, total });
        }
    };
    const tokenizer = await AutoTokenizer.from_pretrained(repo, { progress_callback: progress });
    const model = await FAMILIES[family].from_pretrained(repo, { dtype, device: backend, progress_callback: progress });
    current = { key, tokenizer, model };
    return current;
}
async function unload() {
    if (!current) return;
    const old = current;
    current = null;
    try { await old.model.dispose(); } catch { /* already gone */ }
}

// Streams an answer. messages: [{ role, content }]. onDelta(text) per piece; onThinking is unused: reasoning models write <think> tags inline.
async function generate({ repo, dtype, backend, family, messages, think, maxTokens = 8192, sampling = true }, onDelta, signal) {
    const { tokenizer, model } = await load({ repo, dtype, backend, family });
    const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, enable_thinking: !!think });
    const stopper = new InterruptableStoppingCriteria();
    if (signal) { if (signal.aborted) stopper.interrupt(); else signal.addEventListener('abort', () => stopper.interrupt(), { once: true }); }
    const streamer = new TextStreamer(tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: text => { if (text) onDelta(text); } });
    await model.generate({ ...inputs, max_new_tokens: maxTokens, ...(sampling ? { do_sample: true, temperature: 0.7, top_p: 0.9, repetition_penalty: 1.1 } : { do_sample: false }), streamer, stopping_criteria: stopper });
}

// Removes a model's files from the cache.
async function purge(repo) {
    if (current && current.key.startsWith(repo + '|')) await unload();
    if (typeof caches === 'undefined') return;
    const cache = await caches.open('transformers-cache');
    for (const request of await cache.keys()) if (request.url.includes('/' + repo + '/')) await cache.delete(request);
}

window.FgsDeviceEngine = { capabilities, load, unload, generate, purge };
