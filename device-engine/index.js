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

// transformers.js downloads a file into memory (chunks, the joined buffer, then a copy for the cache): three times its size.
// On a phone that kills the web view, and one cache entry of several hundred megabytes is not reliable either.
// So big weight files are streamed into the cache in pieces of CHUNK bytes (key?part=0, key?part=1, … plus key?part=manifest; a #fragment would be ignored by the cache) and
// the loader reads them back through a custom cache that joins the pieces again.
const BIG_FILE = 40e6;
const CHUNK = 32 * 1024 * 1024;
const CACHE_NAME = 'transformers-cache';
const SUFFIX = { fp32: '', q8: '_quantized', q4: '_q4', q4f16: '_q4f16', fp16: '_fp16' };

async function readManifest(cache, url) {
    const found = await cache.match(url + '?part=manifest');
    if (!found) return null;
    try { return await found.json(); } catch { return null; }
}
async function dropPieces(cache, url) {
    for (const request of await cache.keys()) if (request.url.startsWith(url + '?part=')) await cache.delete(request);
}
async function storeChunked(cache, url, response, size, onBytes) {
    const reader = response.body.getReader();
    let parts = [], length = 0, pieces = 0, loaded = 0;
    const flush = async () => {
        if (!length) return;
        await cache.put(`${url}?part=${pieces++}`, new Response(new Blob(parts), { headers: { 'content-type': 'application/octet-stream' } }));
        parts = []; length = 0;
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); length += value.length; loaded += value.length; onBytes(loaded);
        if (length >= CHUNK) await flush();
    }
    await flush();
    if (loaded !== size) throw new Error(`получено ${loaded} из ${size} байт`);
    await cache.put(url + '?part=manifest', new Response(JSON.stringify({ size, pieces })));
}
// What transformers.js sees as its cache: ordinary entries as they are, chunked files joined from their pieces.
function chunkedCache(cache) {
    return {
        async match(request) {
            const url = typeof request === 'string' ? request : request.url;
            const manifest = await readManifest(cache, url);
            if (!manifest) return cache.match(request);
            let next = 0;
            const body = new ReadableStream({
                async pull(controller) {
                    if (next >= manifest.pieces) { controller.close(); return; }
                    const piece = await cache.match(`${url}?part=${next++}`);
                    if (!piece) { controller.error(new Error('В кэше не хватает части файла модели')); return; }
                    controller.enqueue(new Uint8Array(await piece.arrayBuffer()));
                }
            });
            return new Response(body, { headers: { 'content-length': String(manifest.size) } });
        },
        put: (request, response) => cache.put(request, response),
        delete: request => cache.delete(request)
    };
}
env.cacheKey = CACHE_NAME;

async function useCache() {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(CACHE_NAME);
    env.useCustomCache = true;
    env.customCache = chunkedCache(cache);
    return cache;
}
async function prefetch({ repo, dtype }, onProgress) {
    const cache = await useCache();
    if (!cache) return;
    const base = `https://huggingface.co/${repo}/resolve/main/`;
    const listing = await fetch(`https://huggingface.co/api/models/${repo}/tree/main/onnx`);
    if (!listing.ok) return;                                   // the regular loader will still try on its own
    const suffix = SUFFIX[dtype] ?? '';
    const wanted = (await listing.json()).filter(item => item.type === 'file' && item.size >= BIG_FILE
        && !/^onnx\/(vision|audio)/.test(item.path) && new RegExp(`${suffix}\\.onnx(_data(_\\d+)?)?$`).test(item.path));
    const total = wanted.reduce((sum, item) => sum + item.size, 0);
    let done = 0;
    for (const item of wanted) {
        const url = base + item.path;
        const have = await readManifest(cache, url);
        if (have && have.size === item.size) { done += item.size; onProgress({ loaded: done, total }); continue; }
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await dropPieces(cache, url);
                const response = await fetch(url);
                if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
                await storeChunked(cache, url, response, item.size, loaded => onProgress({ loaded: done + loaded, total }));
                lastError = null;
                break;
            } catch (error) { lastError = error; await dropPieces(cache, url).catch(() => {}); }
        }
        if (lastError) throw new Error(`Не удалось скачать ${item.path}: ${lastError.message}`);
        done += item.size;
    }
}

// repo: Hugging Face repository; returns when the weights are downloaded and the model is ready to answer.
async function load({ repo, dtype, backend, family = 'causal' }, onProgress) {
    const key = `${repo}|${dtype}|${backend}`;
    if (current && current.key === key) return current;
    await unload();
    await useCache();
    if (onProgress) await prefetch({ repo, dtype }, ({ loaded, total }) => onProgress({ status: 'progress', file: '', loaded, total }));
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
