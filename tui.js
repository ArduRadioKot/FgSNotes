#!/usr/bin/env node
// Terminal editor: the same notes, tabs and search as the window, drawn in the terminal.
const { run } = require('./tui/run');
run(process.argv.slice(2));
