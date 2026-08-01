import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

globalThis.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "json") return new jsonWorker();
    if (["css", "scss", "less"].includes(label)) return new cssWorker();
    if (["html", "handlebars", "razor"].includes(label)) return new htmlWorker();
    if (["typescript", "javascript"].includes(label)) return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

export default function SourceCodeEditor({ filePath, language, source, dark = false }) {
  return (
    <Editor
      height="100%"
      path={filePath}
      language={language}
      value={source}
      theme={dark ? "vs-dark" : "vs"}
      options={{
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        contextmenu: true,
        domReadOnly: true,
        dragAndDrop: false,
        folding: true,
        fontFamily: '"SFMono-Regular", "Cascadia Code", ui-monospace, monospace',
        fontSize: 13,
        formatOnPaste: false,
        formatOnType: false,
        glyphMargin: false,
        guides: { bracketPairs: true, indentation: true },
        lineHeight: 21,
        links: true,
        minimap: { enabled: true, maxColumn: 90, renderCharacters: false },
        mouseWheelZoom: true,
        padding: { top: 12, bottom: 12 },
        readOnly: true,
        renderValidationDecorations: "off",
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        stickyScroll: { enabled: false },
        tabSize: 2,
        wordWrap: "off",
      }}
    />
  );
}
