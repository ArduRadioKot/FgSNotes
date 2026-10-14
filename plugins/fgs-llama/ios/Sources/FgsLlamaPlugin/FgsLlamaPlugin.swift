import Foundation
import Capacitor
import UIKit
import llama

// On-device language models: llama.cpp (GGUF files) with Metal, driven from the web view.
// JS side: src/ai/web-backend.js. Files live in Application Support/models, downloaded here with resume.
@objc(FgsLlamaPlugin)
public class FgsLlamaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FgsLlamaPlugin"
    public let jsName = "FgsLlama"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unload", returnType: CAPPluginReturnPromise)
    ]

    private let engineQueue = DispatchQueue(label: "fgsnotes.llama.engine", qos: .userInitiated)
    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var loadedFile = ""
    private var loadedContext: Int32 = 0
    private var stopFlags = [String: Bool]()
    private let flagLock = NSLock()
    private var downloads = [String: ModelDownload]()
    private var backendReady = false

    // MARK: lifecycle

    override public func load() {
        let center = NotificationCenter.default
        // A model in memory is what gets an app killed: let go of it whenever the system asks or the app leaves the screen.
        center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in self?.releaseWhenIdle() }
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in self?.releaseWhenIdle() }
    }

    private func releaseWhenIdle() {
        engineQueue.async { [weak self] in self?.freeModel() }   // queued behind a running generation, so it never cuts one off
    }

    private func freeModel() {
        if let context = context { llama_free(context) }
        if let model = model { llama_model_free(model) }
        context = nil; model = nil; loadedFile = ""
    }

    // MARK: files

    private func modelsDirectory() throws -> URL {
        var url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("models", isDirectory: true)
        if !FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
        }
        return url
    }

    private func safeName(_ call: CAPPluginCall) -> String? {
        guard let name = call.getString("file"), !name.isEmpty, !name.contains("/"), !name.contains("..") else { return nil }
        return name
    }

    @objc func info(_ call: CAPPluginCall) {
        var free: Int64 = 0
        if let dir = try? modelsDirectory(), let values = try? dir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]), let capacity = values.volumeAvailableCapacityForImportantUsage { free = capacity }
        #if targetEnvironment(simulator)
        let gpu = false
        #else
        let gpu = true
        #endif
        call.resolve(["native": true, "gpu": gpu, "memory": Double(ProcessInfo.processInfo.physicalMemory), "free": Double(free)])
    }

    @objc func status(_ call: CAPPluginCall) {
        guard let name = safeName(call), let dir = try? modelsDirectory() else { return call.reject("Неверное имя файла") }
        let path = dir.appendingPathComponent(name).path
        let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)?.int64Value ?? -1
        call.resolve(["exists": size >= 0, "size": Double(max(size, 0))])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let name = safeName(call), let dir = try? modelsDirectory() else { return call.reject("Неверное имя файла") }
        engineQueue.async {
            if self.loadedFile == name { self.freeModel() }
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(name + ".part"))
            call.resolve()
        }
    }

    // MARK: download

    @objc func download(_ call: CAPPluginCall) {
        guard let name = safeName(call), let id = call.getString("id"), let urlString = call.getString("url"), let url = URL(string: urlString), (url.scheme == "https" || url.host == "localhost"), let dir = try? modelsDirectory() else {
            return call.reject("Неверные параметры загрузки")
        }
        let expected = Int64(call.getDouble("size") ?? 0)
        let target = dir.appendingPathComponent(name)
        if let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? NSNumber)?.int64Value, expected == 0 || size == expected {
            return call.resolve(["size": Double(size)])
        }
        downloads[id]?.cancel()
        let job = ModelDownload(url: url, part: dir.appendingPathComponent(name + ".part"), target: target, expected: expected)
        downloads[id] = job
        job.onProgress = { [weak self] loaded, total in self?.notifyListeners("progress", data: ["id": id, "loaded": Double(loaded), "total": Double(total)]) }
        job.start { [weak self] result in
            self?.downloads[id] = nil
            switch result {
            case .success(let size): call.resolve(["size": Double(size)])
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        if let id = call.getString("id") { downloads[id]?.cancel() }
        call.resolve()
    }

    // MARK: generation

    private func ensureLoaded(file: String, contextSize: Int32) throws {
        if model != nil && context != nil && loadedFile == file && loadedContext == contextSize { return }
        freeModel()
        if !backendReady { llama_backend_init(); backendReady = true }
        let path = try modelsDirectory().appendingPathComponent(file).path
        var params = llama_model_default_params()
        #if targetEnvironment(simulator)
        params.n_gpu_layers = 0
        #else
        params.n_gpu_layers = 99
        #endif
        guard let loaded = llama_model_load_from_file(path, params) else {
            throw NSError(domain: "FgsLlama", code: 1, userInfo: [NSLocalizedDescriptionKey: "Не удалось загрузить модель. Файл повреждён или модель не поддерживается; удалите её и скачайте заново."])
        }
        var contextParams = llama_context_default_params()
        contextParams.n_ctx = UInt32(contextSize)
        contextParams.n_batch = 512
        let threads = Int32(max(2, min(6, ProcessInfo.processInfo.activeProcessorCount - 2)))
        contextParams.n_threads = threads
        contextParams.n_threads_batch = threads
        guard let made = llama_init_from_model(loaded, contextParams) else {
            llama_model_free(loaded)
            throw NSError(domain: "FgsLlama", code: 2, userInfo: [NSLocalizedDescriptionKey: "Не хватило памяти, чтобы запустить модель. Закройте другие приложения или выберите модель поменьше."])
        }
        model = loaded; context = made; loadedFile = file; loadedContext = contextSize
    }

    private func isStopped(_ id: String) -> Bool {
        flagLock.lock(); defer { flagLock.unlock() }
        return stopFlags[id] ?? false
    }

    @objc func stop(_ call: CAPPluginCall) {
        if let id = call.getString("id") { flagLock.lock(); stopFlags[id] = true; flagLock.unlock() }
        call.resolve()
    }

    @objc func unload(_ call: CAPPluginCall) {
        engineQueue.async { self.freeModel(); call.resolve() }
    }

    private func prompt(for messages: [[String: String]], think: Bool, vocabModel: OpaquePointer) -> String {
        var cStrings: [UnsafeMutablePointer<CChar>] = []
        defer { cStrings.forEach { free($0) } }
        var chat: [llama_chat_message] = []
        for message in messages {
            let role = strdup(message["role"] ?? "user")!, content = strdup(message["content"] ?? "")!
            cStrings.append(role); cStrings.append(content)
            chat.append(llama_chat_message(role: UnsafePointer(role), content: UnsafePointer(content)))
        }
        let template = llama_model_chat_template(vocabModel, nil)
        let size = messages.reduce(0) { $0 + ($1["content"]?.utf8.count ?? 0) + 64 } * 2 + 1024
        var buffer = [CChar](repeating: 0, count: size)
        func apply(_ name: UnsafePointer<CChar>?) -> Int32 {
            var length = llama_chat_apply_template(name, chat, chat.count, true, &buffer, Int32(buffer.count))
            if length > Int32(buffer.count) {
                buffer = [CChar](repeating: 0, count: Int(length) + 1)
                length = llama_chat_apply_template(name, chat, chat.count, true, &buffer, Int32(buffer.count))
            }
            return length
        }
        let written: Int32 = template != nil ? apply(template) : "chatml".withCString { apply($0) }
        var text: String
        if written > 0 {
            text = String(decoding: buffer[0..<Int(written)].map { UInt8(bitPattern: $0) }, as: UTF8.self)
        } else {
            // The model's template is one the built-in formatter does not know: ChatML covers most small chat models.
            text = messages.map { "<|im_start|>\($0["role"] ?? "user")\n\($0["content"] ?? "")<|im_end|>\n" }.joined() + "<|im_start|>assistant\n"
        }
        // Reasoning models (Qwen3.x) think first unless the answer is started with an empty thinking block.
        if !think && text.contains("<|im_start|>") && (llama_model_desc_contains(vocabModel, "qwen3")) { text += "<think>\n\n</think>\n\n" }
        return text
    }

    private func llama_model_desc_contains(_ model: OpaquePointer, _ needle: String) -> Bool {
        var buffer = [CChar](repeating: 0, count: 256)
        llama_model_desc(model, &buffer, buffer.count)
        return String(cString: buffer).lowercased().contains(needle)
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let file = safeName(call), let raw = call.getArray("messages") as? [[String: Any]] else { return call.reject("Неверные параметры") }
        let messages: [[String: String]] = raw.map { ["role": ($0["role"] as? String) ?? "user", "content": ($0["content"] as? String) ?? ""] }
        let think = call.getBool("think") ?? false
        let wanted = Int32(call.getInt("maxTokens") ?? 2048)
        let contextSize = Int32(call.getInt("context") ?? 4096)
        let temperature = Float(call.getDouble("temperature") ?? 0.7)
        flagLock.lock(); stopFlags[id] = false; flagLock.unlock()

        engineQueue.async {
            defer { self.flagLock.lock(); self.stopFlags[id] = nil; self.flagLock.unlock() }
            do {
                try self.ensureLoaded(file: file, contextSize: contextSize)
                guard let model = self.model, let context = self.context, let vocab = llama_model_get_vocab(model) else { throw NSError(domain: "FgsLlama", code: 3, userInfo: [NSLocalizedDescriptionKey: "Модель не загружена"]) }

                let text = self.prompt(for: messages, think: think, vocabModel: model)
                var tokens = [llama_token](repeating: 0, count: text.utf8.count + 16)
                var count = llama_tokenize(vocab, text, Int32(text.utf8.count), &tokens, Int32(tokens.count), true, true)
                if count < 0 {
                    tokens = [llama_token](repeating: 0, count: Int(-count))
                    count = llama_tokenize(vocab, text, Int32(text.utf8.count), &tokens, Int32(tokens.count), true, true)
                }
                guard count > 0 else { throw NSError(domain: "FgsLlama", code: 4, userInfo: [NSLocalizedDescriptionKey: "Не удалось разобрать запрос"]) }
                tokens = Array(tokens[0..<Int(count)])
                if Int32(tokens.count) >= contextSize - 32 {
                    throw NSError(domain: "FgsLlama", code: 5, userInfo: [NSLocalizedDescriptionKey: "Запрос слишком длинный для модели на телефоне. Сократите текст или начните новый чат."])
                }
                let limit = min(wanted, contextSize - Int32(tokens.count) - 1)

                llama_memory_clear(llama_get_memory(context), true)

                let chain = llama_sampler_chain_init(llama_sampler_chain_default_params())
                defer { llama_sampler_free(chain) }
                llama_sampler_chain_add(chain, llama_sampler_init_penalties(64, 1.1, 0, 0))
                llama_sampler_chain_add(chain, llama_sampler_init_top_k(40))
                llama_sampler_chain_add(chain, llama_sampler_init_top_p(0.9, 1))
                llama_sampler_chain_add(chain, llama_sampler_init_temp(temperature))
                llama_sampler_chain_add(chain, llama_sampler_init_dist(UInt32.random(in: 0...UInt32.max)))

                // The prompt goes in pieces of n_batch tokens.
                var offset = 0
                while offset < tokens.count {
                    if self.isStopped(id) { call.resolve(["ok": true, "stopped": true]); return }
                    let n = min(512, tokens.count - offset)
                    let result = tokens[offset..<(offset + n)].withUnsafeBufferPointer { pointer -> Int32 in
                        llama_decode(context, llama_batch_get_one(UnsafeMutablePointer(mutating: pointer.baseAddress), Int32(n)))
                    }
                    if result != 0 { throw NSError(domain: "FgsLlama", code: 6, userInfo: [NSLocalizedDescriptionKey: "Модель не смогла обработать запрос (код \(result))"]) }
                    offset += n
                }

                var pending = [UInt8]()
                var produced: Int32 = 0
                let flush = { (force: Bool) in
                    guard !pending.isEmpty else { return }
                    if let piece = String(bytes: pending, encoding: .utf8) {
                        self.notifyListeners("token", data: ["id": id, "text": piece]); pending.removeAll()
                    } else if force || pending.count > 8 {
                        self.notifyListeners("token", data: ["id": id, "text": String(decoding: pending, as: UTF8.self)]); pending.removeAll()
                    }
                }
                while produced < limit {
                    if self.isStopped(id) { break }
                    var next = llama_sampler_sample(chain, context, -1)
                    if llama_vocab_is_eog(vocab, next) { break }
                    var buffer = [CChar](repeating: 0, count: 256)
                    var n = llama_token_to_piece(vocab, next, &buffer, Int32(buffer.count), 0, false)
                    if n < 0 {
                        buffer = [CChar](repeating: 0, count: Int(-n))
                        n = llama_token_to_piece(vocab, next, &buffer, Int32(buffer.count), 0, false)
                    }
                    if n > 0 { pending.append(contentsOf: buffer[0..<Int(n)].map { UInt8(bitPattern: $0) }) }
                    flush(false)
                    let result = llama_decode(context, llama_batch_get_one(&next, 1))
                    if result != 0 { throw NSError(domain: "FgsLlama", code: 7, userInfo: [NSLocalizedDescriptionKey: "Генерация прервана (код \(result))"]) }
                    produced += 1
                }
                flush(true)
                call.resolve(["ok": true, "stopped": self.isStopped(id), "tokens": Int(produced)])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}

// Streams one file to disk (never holds it in memory) and continues from the .part file after an interruption.
final class ModelDownload: NSObject, URLSessionDataDelegate {
    private let url: URL, part: URL, target: URL, expected: Int64
    private var session: URLSession?
    private var handle: FileHandle?
    private var written: Int64 = 0
    private var total: Int64 = 0
    private var completion: ((Result<Int64, Error>) -> Void)?
    private var lastReport = Date.distantPast
    var onProgress: ((Int64, Int64) -> Void)?

    init(url: URL, part: URL, target: URL, expected: Int64) {
        self.url = url; self.part = part; self.target = target; self.expected = expected
    }

    func start(_ done: @escaping (Result<Int64, Error>) -> Void) {
        completion = done
        let existing = (try? FileManager.default.attributesOfItem(atPath: part.path)[.size] as? NSNumber)?.int64Value ?? 0
        var request = URLRequest(url: url)
        request.timeoutInterval = 60
        if existing > 0 { request.setValue("bytes=\(existing)-", forHTTPHeaderField: "Range") }
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForResource = 6 * 3600
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        written = existing
        session?.dataTask(with: request).resume()
    }

    func cancel() {
        session?.invalidateAndCancel()
        finish(.failure(NSError(domain: "FgsLlama", code: 10, userInfo: [NSLocalizedDescriptionKey: "Загрузка отменена"])))
    }

    private func finish(_ result: Result<Int64, Error>) {
        try? handle?.close(); handle = nil
        session?.finishTasksAndInvalidate(); session = nil
        let done = completion; completion = nil
        done?(result)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 || http.statusCode == 206 else {
            finish(.failure(NSError(domain: "FgsLlama", code: 11, userInfo: [NSLocalizedDescriptionKey: "Сервер ответил кодом \((response as? HTTPURLResponse)?.statusCode ?? 0)"])))
            return completionHandler(.cancel)
        }
        if http.statusCode == 200 { written = 0; try? FileManager.default.removeItem(at: part) }     // the server ignored the range: start over
        if !FileManager.default.fileExists(atPath: part.path) { FileManager.default.createFile(atPath: part.path, contents: nil) }
        do { handle = try FileHandle(forWritingTo: part); try handle?.seekToEnd() } catch { finish(.failure(error)); return completionHandler(.cancel) }
        total = expected > 0 ? expected : written + max(response.expectedContentLength, 0)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        do { try handle?.write(contentsOf: data) } catch { dataTask.cancel(); return finish(.failure(error)) }
        written += Int64(data.count)
        if Date().timeIntervalSince(lastReport) > 0.25 { lastReport = Date(); onProgress?(written, total) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard completion != nil else { return }
        if let error = error { return finish(.failure(error)) }
        try? handle?.close(); handle = nil
        if expected > 0 && written != expected {
            return finish(.failure(NSError(domain: "FgsLlama", code: 12, userInfo: [NSLocalizedDescriptionKey: "Файл скачан не полностью (\(written) из \(expected) байт). Повторите: загрузка продолжится."])))
        }
        do {
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.moveItem(at: part, to: target)
            onProgress?(written, written)
            finish(.success(written))
        } catch { finish(.failure(error)) }
    }
}
