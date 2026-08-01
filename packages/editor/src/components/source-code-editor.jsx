import * as monaco from "monaco-editor/editor/editor.main.js";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import { useEffect, useRef } from "react";

globalThis.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "json") return new jsonWorker();
    if (["css", "scss", "less"].includes(label)) return new cssWorker();
    if (["html", "handlebars", "razor"].includes(label)) return new htmlWorker();
    if (["typescript", "javascript"].includes(label)) return new tsWorker();
    return new editorWorker();
  },
};

export default function SourceCodeEditor({ filePath, language, source, dark = false }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const model = monaco.editor.createModel(
      source,
      language,
      monaco.Uri.parse(`file:///${filePath}`),
    );
    const editor = monaco.editor.create(
      container,
      {
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
        model,
        mouseWheelZoom: true,
        padding: { top: 12, bottom: 12 },
        readOnly: true,
        renderValidationDecorations: "off",
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        stickyScroll: { enabled: false },
        tabSize: 2,
        theme: dark ? "vs-dark" : "vs",
        wordWrap: "off",
      },
    );
    const layout = () => editor.layout({
      width: container.clientWidth,
      height: container.clientHeight,
    });
    const observer = new ResizeObserver(layout);
    observer.observe(container);
    requestAnimationFrame(layout);

    return () => {
      observer.disconnect();
      editor.dispose();
      model.dispose();
    };
  }, [dark, filePath, language, source]);

  return <div ref={containerRef} className="source-monaco-host" />;
}
