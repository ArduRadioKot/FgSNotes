// Assistants start this same binary and pass mcp-stdio.js. That process must relay over stdin, not open a window.
function relayArgs(argv) {
    const index = argv.findIndex(arg => /(?:^|[\\/])mcp-stdio\.js$/.test(String(arg)));
    if (index < 0) return null;
    const file = argv.slice(index + 1).find(arg => arg && !String(arg).startsWith('-'));
    return file ? [argv[index], file] : [argv[index]];
}

module.exports = { relayArgs };
