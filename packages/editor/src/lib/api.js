const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function api(path, opts = {}) {
  const hasBody = opts.body !== undefined;
  const method = opts.method || (hasBody ? "POST" : "GET");
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(path, {
        method,
        headers: hasBody ? { "Content-Type": "application/json" } : undefined,
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
        credentials: "same-origin",
      });
    } catch (error) {
      if (method !== "GET" || attempt === 2 || opts.signal?.aborted) throw error;
      await wait(250 * (attempt + 1));
      continue;
    }
    if (method !== "GET" || !RETRYABLE_STATUS.has(response.status) || attempt === 2) break;
    await response.body?.cancel();
    await wait(250 * (attempt + 1));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function apiStream(path, body, onProgress) {
  const response = await fetch(`${path}${path.includes("?") ? "&" : "?"}stream=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
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
