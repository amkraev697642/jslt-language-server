# jslt-language-server

A [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) server for [JSLT](https://github.com/schibsted/jslt), the JSON query and transformation language, powered by [jslt-js](https://www.npmjs.com/package/jslt-js).

- **Diagnostics** as you type: syntax errors, unknown functions and broken imports, with line and column
- **Completion** for the built-in functions, your own `let` / `def` names, and functions of imported files (`alias:`); triggers on `$` and `:`
- **Hover docs** for built-in functions
- **Formatting** (re-indents bracketed lines)

`import "lib.jslt" as lib` resolves next to the file. All open files are re-checked whenever one of them changes.

## Run it

```sh
npm install -g jslt-language-server
jslt-language-server --stdio
```

It speaks LSP over stdio (or Node IPC), so any editor with a generic LSP client can use it: point the client at the command above for `.jslt` files, language id `jslt`.

For Visual Studio Code and forks, use the [vscode-jslt](https://github.com/amkraev697642/vscode-jslt) extension, which bundles this server.

## Development

```sh
npm install
npm test
```

## License

Apache-2.0
