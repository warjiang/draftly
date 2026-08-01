export async function api(path, opts = {}) {
  const hasBody = opts.body !== undefined;
  const response = await fetch(path, {
    method: opts.method || (hasBody ? "POST" : "GET"),
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status}`);
  return data;
}

export async function apiStream(path, body, onProgress) {
  const response = await fetch(`${path}${path.includes("?") ? "&" : "?"}stream=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `${response.status}`);
  }
  if (!response.body) throw new Error("浏览器不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;

  const consume = (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.type === "progress") onProgress(message.event);
    if (message.type === "result") result = message.data;
    if (message.type === "error") throw new Error(message.error || "Pi 任务失败");
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) consume(line);
    if (done) break;
  }

  consume(buffer);
  if (!result) throw new Error("Pi 任务未返回结果");
  return result;
}
