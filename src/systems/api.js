// AI API System — Anthropic + OpenAI compatible tool-use protocol
// Extracted from App.jsx: API status, auth helpers, AI callers, system prompt, AI loop

import { useState, useEffect } from "react";
import { dlog } from "./debug.js";
import { toast } from "./toast.js";
import { bgNewAbort, bgStream, bgSet, bgLog, getBgState } from "./background.js";
import { TOOLS, TOOLS_OPENAI, getProviderQuirks } from "../constants/tools.js";
import { repairTruncatedJSON } from "../utils/jsonRepair.js";
import { deriveStartTime as deriveStartTimeFromAvailability } from "../utils/availabilityCalc.js";

// ── Constants ────────────────────────────────────────────────────────
export const APP_VERSION = "7.3.0";

// Strip API keys from error messages to prevent accidental leakage
function sanitizeErrorText(text) {
  if (!text) return '';
  return text
    .replace(/sk-ant-[a-zA-Z0-9_-]{20,}/g, 'sk-ant-***')
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***')
    .replace(/gsk_[a-zA-Z0-9_-]{20,}/g, 'gsk_***')
    .replace(/xai-[a-zA-Z0-9_-]{20,}/g, 'xai-***')
    .replace(/Bearer\s+[a-zA-Z0-9_-]{20,}/gi, 'Bearer ***')
    .slice(0, 200);
}

const STATUS_L = { not_started: "Not Started", in_progress: "In Progress", completed: "Completed" };

// ── Local utilities (will move to ../utils/helpers.js later) ─────────
function safeArr(v) { return Array.isArray(v) ? v : []; }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function fmtDateLong(dateStr) {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  } catch (_e) { return dateStr; }
}

// ── API Status ──────────────────────────────────────────────────────
let _apiStatus = { ok: null, code: 0, ts: 0, error: '' };
let _apiStatusSubs = [];

export function setApiStatus(ok, code, error) {
  _apiStatus = { ok, code: code || 0, ts: Date.now(), error: error || '' };
  _apiStatusSubs.forEach(fn => fn({ ..._apiStatus }));
}

export function useApiStatus() {
  const [s, set] = useState({ ..._apiStatus });
  useEffect(() => { _apiStatusSubs.push(set); return () => { _apiStatusSubs = _apiStatusSubs.filter(f => f !== set); }; }, []);
  return s;
}

// ── Auth Helpers ────────────────────────────────────────────────────
export function getAuthHeaders(profile) {
  const h = { "Content-Type": "application/json" };
  const url = profile.baseUrl || "";
  if (profile.provider === "anthropic" || url.includes("anthropic.com")) {
    h["x-api-key"] = profile.apiKey;
    h["anthropic-version"] = "2023-06-01";
    h["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    h["Authorization"] = "Bearer " + profile.apiKey;
  }
  return h;
}

export function isAnthProvider(p) {
  return p.provider === "anthropic" || (p.baseUrl || "").includes("anthropic.com");
}

export function guessModelsUrl(baseUrl) {
  if (!baseUrl) return "";
  try {
    const u = new URL(baseUrl);
    const parts = u.pathname.replace(/\/+$/, "").split("/");
    const ci = parts.indexOf("chat");
    if (ci > 0) return u.origin + parts.slice(0, ci).join("/") + "/models";
    return u.origin + parts.slice(0, -1).join("/") + "/models";
  } catch (_e) { return ""; }
}

// ----------------------------------------------------------------------
// AI CALLER with tool-use protocol
// ----------------------------------------------------------------------
export async function callAIWithTools(profile, systemPrompt, messages, imageData = null, toolOverride = null) {
  const isAnth = isAnthProvider(profile);
  dlog('api','api',`Calling: ${profile.name} (${profile.model})`, {provider:isAnth?"anthropic":"openai",msgs:messages.length,hasImg:!!imageData});
  const headers = getAuthHeaders(profile);

  const toolSet = toolOverride || TOOLS;
  const toolSetOAI = toolOverride
    ? toolOverride.map(t => ({type:"function", function:{name:t.name, description:t.description, parameters:t.input_schema}}))
    : TOOLS_OPENAI;

  // Build the last user message content (may include image)
  let processedMessages = [...messages];
  if (imageData && processedMessages.length > 0) {
    const last = processedMessages[processedMessages.length - 1];
    if (last.role === "user") {
      processedMessages = [...processedMessages.slice(0, -1), {
        role: "user",
        content: isAnth
          ? [{ type: "image", source: { type: "base64", media_type: imageData.type, data: imageData.data } }, { type: "text", text: last.content }]
          : [{ type: "image_url", image_url: { url: `data:${imageData.type};base64,${imageData.data}` } }, { type: "text", text: last.content }],
      }];
    }
  }

  const quirks = getProviderQuirks(profile);

  let body;
  if (quirks.noToolSupport) {
    // Provider does not support tool calling — omit tools entirely
    body = isAnth
      ? { model: profile.model, max_tokens: 16384, system: systemPrompt, messages: processedMessages }
      : { model: profile.model, max_tokens: 16384, messages: [{ role: "system", content: systemPrompt }, ...processedMessages] };
  } else if (isAnth) {
    body = { model: profile.model, max_tokens: 16384, system: systemPrompt, messages: processedMessages, tools: toolSet };
  } else {
    body = { model: profile.model, max_tokens: 16384, messages: [{ role: "system", content: systemPrompt }, ...processedMessages], tools: toolSetOAI };
    if (quirks.requireToolChoice) body.tool_choice = "auto";
  }

  let res;
  try { res = await fetch(profile.baseUrl, { method: "POST", headers, body: JSON.stringify(body) });
    dlog('api','api',`Response: HTTP ${res.status}`);
    setApiStatus(res.ok, res.status);
  } catch(e) {
    setApiStatus(false, 0, e.message);
    dlog('error','api',`Network error: ${e.message}`,{url:profile.baseUrl}); throw new Error(`Network error: ${e.message}`);
  }

  // If image was attached and we got a 400, retry without the image
  if (!res.ok && imageData && (res.status === 400 || res.status === 422)) {
    dlog('warn','api',`Got ${res.status} with image attached — retrying without image (model may not support vision)`);
    const plainMsgs = messages; // original messages without image
    let retryBody;
    if (quirks.noToolSupport) {
      retryBody = isAnth
        ? { model: profile.model, max_tokens: 16384, system: systemPrompt + "\n\nNOTE: An image was provided but your model doesn't support vision. Ask the user to describe what's in the image instead.", messages: plainMsgs }
        : { model: profile.model, max_tokens: 16384, messages: [{ role: "system", content: systemPrompt + "\n\nNOTE: An image was provided but your model doesn't support vision. Ask the user to describe what's in the image instead." }, ...plainMsgs] };
    } else {
      retryBody = isAnth
        ? { model: profile.model, max_tokens: 16384, system: systemPrompt + "\n\nNOTE: An image was provided but your model doesn't support vision. Ask the user to describe what's in the image instead.", messages: plainMsgs, tools: toolSet }
        : { model: profile.model, max_tokens: 16384, messages: [{ role: "system", content: systemPrompt + "\n\nNOTE: An image was provided but your model doesn't support vision. Ask the user to describe what's in the image instead." }, ...plainMsgs], tools: toolSetOAI };
    }
    try {
      res = await fetch(profile.baseUrl, { method: "POST", headers, body: JSON.stringify(retryBody) });
      dlog('api','api',`Retry response: HTTP ${res.status}`); setApiStatus(res.ok, res.status);
    } catch(e) { setApiStatus(false, 0, e.message); throw new Error(`Retry failed: ${e.message}`); }
  }

  if (!res.ok) { const t = await res.text(); dlog('error','api',`API error ${res.status}`,t.slice(0,500)); throw new Error(`API ${res.status}: ${sanitizeErrorText(t)}`); }

  // Read as text first to handle truncated/empty responses
  let rawText;
  try { rawText = await res.text(); } catch(e) { dlog('error','api','Failed to read response body',e.message); throw new Error(`Failed to read response: ${e.message}`); }
  dlog('debug','api',`Response body: ${rawText.length} chars`);
  if (!rawText || rawText.trim().length === 0) { dlog('error','api','Empty response body'); throw new Error('API returned an empty response. The model may have timed out or returned nothing.'); }

  let data;
  try { data = JSON.parse(rawText); }
  catch(e) {
    dlog('error','api',`JSON parse failed (${rawText.length} chars)`, rawText.slice(0, 500));
    throw new Error(`Invalid JSON from API (${rawText.length} chars). Response may have been truncated. First 200 chars: ${sanitizeErrorText(rawText)}`);
  }

  // Parse response — handle thinking models (Qwen, DeepSeek) that wrap content in <think> tags
  if (isAnth) {
    const text = safeArr(data.content).filter(b => b.type === "text").map(b => b.text).join("");
    const toolCalls = safeArr(data.content).filter(b => b.type === "tool_use").map(b => ({ id: b.id, name: b.name, input: b.input }));
    return { text, toolCalls, stopReason: data.stop_reason };
  } else {
    const msg = data.choices?.[0]?.message;
    if (!msg) {
      dlog('warn','api','No message in response', JSON.stringify(data).slice(0,500));
      // Some models return content differently — try to extract text
      const fallbackText = data.output?.text || data.result || "";
      return { text: fallbackText || "(Model returned no message)", toolCalls: [], stopReason: "stop" };
    }
    let text = msg.content || "";
    // Strip <think>...</think> blocks from thinking models
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      dlog('warn','api','Response was TRUNCATED (finish_reason=length). Increase max_tokens or simplify the request.');
      text += "\n\n⚠️ Response was truncated — the model ran out of output tokens. Some data may be incomplete.";
    }
    const toolCalls = safeArr(msg.tool_calls).map(tc => {
      try {
        const rawArgs = tc.function?.arguments || "{}";
        const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
        return { id: tc.id, name: tc.function.name, input: args };
      } catch(e) {
        // Try to repair truncated JSON from thinking models
        dlog('warn','api',`Truncated tool args for ${tc.function?.name}, attempting repair...`, tc.function?.arguments?.slice?.(0,500));
        const raw = tc.function?.arguments || "";
        let repaired = null;
        try {
          repaired = repairTruncatedJSON(raw);
          dlog('info','api',`Repaired truncated JSON for ${tc.function?.name}`);
        } catch(e2) {
          dlog('error','api',`Could not repair JSON for ${tc.function?.name}`, raw.slice(0,300));
        }
        return { id: tc.id, name: tc.function?.name || 'unknown', input: repaired || {} };
      }
    });
    return { text, toolCalls, stopReason: finishReason };
  }
}

// ----------------------------------------------------------------------
// STREAMING API CALLER (SSE) — shows live text as it arrives
// ----------------------------------------------------------------------
export async function callAIStream(profile, systemPrompt, messages, imageData = null, onChunk = null, toolOverride = null) {
  const quirks = getProviderQuirks(profile);
  if (quirks.disableStreamingWithTools) {
    return callAIWithTools(profile, systemPrompt, messages, imageData, toolOverride);
  }

  const isAnth = isAnthProvider(profile);
  dlog('api','api',`Streaming call: ${profile.name} (${profile.model})`);
  const headers = getAuthHeaders(profile);
  const signal = getBgState().abortCtrl?.signal;

  const toolSet = toolOverride || TOOLS;
  const toolSetOAI = toolOverride
    ? toolOverride.map(t => ({type:"function", function:{name:t.name, description:t.description, parameters:t.input_schema}}))
    : TOOLS_OPENAI;

  let processedMessages = [...messages];
  if (imageData && processedMessages.length > 0) {
    const last = processedMessages[processedMessages.length - 1];
    if (last.role === "user") {
      processedMessages = [...processedMessages.slice(0, -1), {
        role: "user",
        content: isAnth
          ? [{ type:"image", source:{ type:"base64", media_type:imageData.type, data:imageData.data } }, { type:"text", text:last.content }]
          : [{ type:"image_url", image_url:{ url:`data:${imageData.type};base64,${imageData.data}` } }, { type:"text", text:last.content }],
      }];
    }
  }

  let body;
  if (quirks.noToolSupport) {
    // Provider does not support tool calling — omit tools entirely
    body = isAnth
      ? { model:profile.model, max_tokens:16384, stream:true, system:systemPrompt, messages:processedMessages }
      : { model:profile.model, max_tokens:16384, stream:true, messages:[{role:"system",content:systemPrompt}, ...processedMessages] };
  } else if (isAnth) {
    body = { model:profile.model, max_tokens:16384, stream:true, system:systemPrompt, messages:processedMessages, tools:toolSet };
  } else {
    body = { model:profile.model, max_tokens:16384, stream:true, messages:[{role:"system",content:systemPrompt}, ...processedMessages], tools:toolSetOAI };
    if (quirks.requireToolChoice) body.tool_choice = "auto";
  }

  let res;
  try {
    res = await fetch(profile.baseUrl, { method:"POST", headers, body:JSON.stringify(body), signal });
    dlog('api','api',`Stream response: HTTP ${res.status}`); setApiStatus(res.ok, res.status);
  } catch(e) {
    if (e.name === 'AbortError') { dlog('info','api','Stream aborted by user'); throw new Error('Cancelled'); }
    setApiStatus(false, 0, e.message);
    dlog('error','api',`Stream fetch failed: ${e.message}`);
    throw new Error(`Network error: ${e.message}`);
  }

  if (!res.ok) {
    // If streaming fails (some endpoints don't support it), fall back to non-streaming
    dlog('warn','api',`Stream not supported (HTTP ${res.status}), falling back`);
    return callAIWithTools(profile, systemPrompt, messages, imageData, toolOverride);
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let thinkBuf = "";
  let inThink = false;
  // OpenAI tool call accumulation
  const toolCallMap = {}; // index -> {id, name, arguments}
  let stopReason = "stop";
  const STREAM_READ_TIMEOUT_MS = 90000; // 90s — if no data arrives for this long, assume stalled

  try {
    while (true) {
      // Race reader.read() against a timeout to prevent indefinite hangs
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Stream read timeout — no data received for 90s. The provider may not support streaming tool calls.')), STREAM_READ_TIMEOUT_MS)
      );
      const { done, value } = await Promise.race([reader.read(), timeoutPromise]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]" || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data: ")) continue;

        let chunk;
        try { chunk = JSON.parse(trimmed.slice(6)); } catch(_e) { continue; }

        if (isAnth) {
          if (chunk.type === "content_block_delta") {
            if (chunk.delta?.type === "text_delta") {
              const t = chunk.delta.text || "";
              fullText += t;
              if (onChunk) onChunk(fullText.replace(/<think>[\s\S]*?(<\/think>|$)/g,'').trim());
            } else if (chunk.delta?.type === "input_json_delta") {
              const idx = chunk.index || 0;
              if (toolCallMap[idx]) {
                toolCallMap[idx].arguments += (chunk.delta.partial_json || "");
                const totalArgs = Object.values(toolCallMap).reduce((s,t) => s + t.arguments.length, 0);
                const names = Object.values(toolCallMap).filter(t=>t.name).map(t=>t.name).join(", ");
                if (onChunk) onChunk(`🔧 Calling: ${names}\n📦 Receiving data... (${totalArgs} chars)`);
              }
            }
          } else if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
            const idx = chunk.index || 0;
            toolCallMap[idx] = { id: chunk.content_block.id, name: chunk.content_block.name, arguments: "" };
            dlog('debug','api',`Stream tool start: ${chunk.content_block.name}`);
          } else if (chunk.type === "message_delta") {
            stopReason = chunk.delta?.stop_reason || stopReason;
          }
        } else {
          // OpenAI streaming format
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            const cleaned = fullText.replace(/<think>[\s\S]*?(<\/think>|$)/g,'').trim();
            if (onChunk) onChunk(cleaned);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap[idx]) toolCallMap[idx] = { id: tc.id || "", name: "", arguments: "" };
              if (tc.id) toolCallMap[idx].id = tc.id;
              if (tc.function?.name) {
                toolCallMap[idx].name = tc.function.name;
                dlog('debug','api',`Stream tool start: ${tc.function.name}`);
              }
              if (tc.function?.arguments) {
                toolCallMap[idx].arguments += tc.function.arguments;
                // Show tool arg accumulation in UI
                const totalArgs = Object.values(toolCallMap).reduce((s,t) => s + t.arguments.length, 0);
                const names = Object.values(toolCallMap).filter(t=>t.name).map(t=>t.name).join(", ");
                if (onChunk) onChunk(`🔧 Calling: ${names}\n📦 Receiving data... (${totalArgs} chars)`);
              }
            }
          }
          stopReason = chunk.choices?.[0]?.finish_reason || stopReason;
        }
      }
    }
  } catch (e) {
    dlog('error','api',`Stream read error: ${e.message}`);
    try { reader.cancel(); } catch(_) {}
    // If we timed out with very little data, fall back to non-streaming
    const totalAccum = Object.values(toolCallMap).reduce((s,t) => s + t.arguments.length, 0);
    if (e.message.includes('Stream read timeout') && totalAccum < 100 && fullText.length < 100) {
      dlog('warn','api',`Stream timed out with minimal data (${totalAccum} tool chars, ${fullText.length} text chars) — falling back to non-streaming`);
      return callAIWithTools(profile, systemPrompt, messages, imageData, toolOverride);
    }
  }

  // Parse accumulated tool calls
  const text = fullText.replace(/<think>[\s\S]*?<\/think>/g,'').trim();
  dlog('debug','api',`Stream raw tool data: ${JSON.stringify(Object.fromEntries(Object.entries(toolCallMap).map(([k,v])=>[k,{name:v.name,id:v.id,argsLen:v.arguments.length,argsPreview:v.arguments.slice(0,200)}])))}`);
  const toolCalls = Object.values(toolCallMap).map(tc => {
    let input = {};
    try {
      if (tc.arguments) input = repairTruncatedJSON(tc.arguments);
    } catch(e) { dlog('warn','api',`Stream tool parse failed for ${tc.name}`,tc.arguments?.slice(0,300)); }
    return { id: tc.id, name: tc.name, input };
  }).filter(tc => tc.name);

  dlog('api','api',`Stream complete: ${text.length} chars, ${toolCalls.length} tools, stop=${stopReason}`);
  if (stopReason === "length") dlog('warn','api','Stream was TRUNCATED (stop=length)');

  return { text, toolCalls, stopReason };
}

// Continue conversation after tool execution (send tool results back)
export async function continueAfterTools(profile, systemPrompt, messages, toolCalls, toolResults) {
  const isAnth = isAnthProvider(profile);
  const headers = getAuthHeaders(profile);

  let extendedMessages;
  if (isAnth) {
    extendedMessages = [
      ...messages,
      { role: "assistant", content: toolCalls.map(tc => ({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input })) },
      { role: "user", content: toolResults.map(tr => ({ type: "tool_result", tool_use_id: tr.id, content: tr.result })) },
    ];
  } else {
    // OpenAI: assistant message with tool_calls, then tool role messages
    extendedMessages = [
      ...messages,
      { role: "assistant", tool_calls: toolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.input) } })) },
      ...toolResults.map(tr => ({ role: "tool", tool_call_id: tr.id, content: tr.result })),
    ];
  }

  const body = isAnth
    ? { model: profile.model, max_tokens: 16384, system: systemPrompt, messages: extendedMessages, tools: TOOLS }
    : { model: profile.model, max_tokens: 16384, messages: [{ role: "system", content: systemPrompt }, ...extendedMessages], tools: TOOLS_OPENAI };

  dlog('api','api','Continuing after tool results');
  const res = await fetch(profile.baseUrl, { method: "POST", headers, body: JSON.stringify(body) });
  dlog('api','api',`Continue response: HTTP ${res.status}`); setApiStatus(res.ok, res.status);
  if (!res.ok) { const t = await res.text(); dlog('error','api',`Continue error ${res.status}`,t.slice(0,500)); throw new Error(`API ${res.status}: ${sanitizeErrorText(t)}`); }

  let rawText;
  try { rawText = await res.text(); } catch(e) { throw new Error(`Failed to read continue response: ${e.message}`); }
  dlog('debug','api',`Continue body: ${rawText.length} chars`);
  if (!rawText || rawText.trim().length === 0) throw new Error('Empty continue response');

  let data;
  try { data = JSON.parse(rawText); }
  catch(e) { dlog('error','api',`Continue JSON parse failed (${rawText.length} chars)`,rawText.slice(0,500)); throw new Error(`Invalid JSON in continue (${rawText.length} chars): ${sanitizeErrorText(rawText)}`); }

  if (isAnth) {
    const text = safeArr(data.content).filter(b=>b.type==="text").map(b=>b.text).join("");
    const moreCalls = safeArr(data.content).filter(b=>b.type==="tool_use").map(b=>({id:b.id,name:b.name,input:b.input}));
    return { text, toolCalls:moreCalls, stopReason:data.stop_reason };
  } else {
    const msg = data.choices?.[0]?.message;
    if (!msg) return { text:"(no response)", toolCalls:[], stopReason:"stop" };
    let text = (msg.content||"").replace(/<think>[\s\S]*?<\/think>/g,'').trim();
    const moreCalls = safeArr(msg.tool_calls).map(tc => {
      try { return { id:tc.id, name:tc.function.name, input: typeof tc.function?.arguments==='string'?JSON.parse(tc.function.arguments):(tc.function?.arguments||{}) }; }
      catch(e) { return { id:tc.id, name:tc.function?.name||'unknown', input:{} }; }
    });
    return { text, toolCalls:moreCalls, stopReason:data.choices?.[0]?.finish_reason };
  }
}

// ----------------------------------------------------------------------
// SYSTEM PROMPT (deep context)
// ----------------------------------------------------------------------
export function fmtCtx(c, idx, creditLabel = 'credits') {
  let s = `${idx+1}. ${c.name} (${c.credits||0} ${creditLabel}, ${STATUS_L[c.status]||c.status}, diff ${c.difficulty||3}/5)`;
  if (c.assessmentType) s += ` [${c.assessmentType}]`;
  if (c.certAligned) s += ` → ${c.certAligned}`;
  if (safeArr(c.competencies).length>0) s += `\n     Competencies: ${safeArr(c.competencies).map(x=>`${x.code||''} ${x.title} (${x.weight||'?'})`).join('; ')}`;
  if (safeArr(c.topicBreakdown).length>0) s += `\n     Topics: ${safeArr(c.topicBreakdown).map(t=>`${t.topic} [${t.weight}]`).join('; ')}`;
  if (safeArr(c.knownFocusAreas).length>0) s += `\n     Focus: ${safeArr(c.knownFocusAreas).join('; ')}`;
  if (safeArr(c.examTips).length>0) s += `\n     Tips: ${safeArr(c.examTips).slice(0,3).join('; ')}`;
  if (c.averageStudyHours) s += `\n     ~${c.averageStudyHours}h avg`;
  if (c.passRate) s += ` | ${c.passRate}`;
  if (c.preAssessmentScore != null) s += `\n     Pre-assessment: ${c.preAssessmentScore}%`;
  if (safeArr(c.preAssessmentWeakAreas).length>0) s += `\n     Weak areas: ${safeArr(c.preAssessmentWeakAreas).join('; ')}`;
  if (c.studyStrategy) s += `\n     Strategy: ${c.studyStrategy}`;
  if (safeArr(c.quickWins).length>0) s += `\n     Quick wins: ${safeArr(c.quickWins).join('; ')}`;
  if (safeArr(c.hardestConcepts).length>0) s += `\n     Hardest: ${safeArr(c.hardestConcepts).join('; ')}`;
  if (safeArr(c.studyOrder).length>0) s += `\n     Study order: ${safeArr(c.studyOrder).join(' → ')}`;
  if (c.topics) s += `\n     Topics: ${c.topics}`;
  if (c.notes) s += `\n     Notes: ${c.notes}`;
  return s;
}

export function universityContextBlock(profile) {
  if (!profile || !profile.name) return '';
  const p = profile;
  let block = `\n${p.shortName || p.name} CONTEXT:\n`;

  // Education model
  if (p.educationModel === 'competency-based') {
    block += '- Uses competency-based education. Students demonstrate mastery, not accumulate seat time.\n';
    block += '- Courses can be completed as fast as the student can demonstrate competency.\n';
  } else if (p.educationModel === 'credit-hour') {
    block += '- Uses traditional credit-hour system with structured course schedules.\n';
  } else if (p.educationModel === 'quarter') {
    block += '- Uses quarter system (~10-week terms).\n';
  }

  // Grading
  if (p.gradingSystem === 'pass-fail') {
    block += '- Grading is pass/fail. "Passing" means meeting all competency thresholds.\n';
  } else if (p.gradingSystem === 'letter-grade') {
    block += '- Uses letter grades (A-F). GPA matters for academic standing.\n';
  } else if (p.gradingSystem === 'percentage') {
    block += '- Uses percentage-based grading.\n';
  }

  // Assessment model
  if (p.assessmentModel === 'oa-pa') {
    block += '- Assessments are OA (Objective Assessment — proctored exam) and PA (Performance Assessment — written project/paper).\n';
    block += '- OA question pools and competency codes are regularly updated.\n';
  } else if (p.assessmentModel === 'midterm-final') {
    block += '- Courses typically have midterm and final exams, plus possible quizzes and homework.\n';
  } else if (p.assessmentModel === 'continuous') {
    block += '- Uses continuous assessment (regular assignments, quizzes, participation).\n';
  } else if (p.assessmentModel === 'mixed') {
    block += '- Uses mixed assessment: exams, projects, papers, participation, and possibly presentations.\n';
  }

  // Credit units
  if (p.creditUnit && p.creditUnitLabel) {
    block += `- Credit system: ${p.creditUnitLabel} (${p.creditUnit}).\n`;
  }

  // Term structure
  if (p.termStructure === '6-month-term') {
    block += '- Term length: 6 months. Students can take as many courses as they can complete per term.\n';
  } else if (p.termStructure === 'semester') {
    block += '- Semester system: ~16-week terms, typically Fall and Spring.\n';
  } else if (p.termStructure === 'quarter') {
    block += '- Quarter system: ~10-week terms.\n';
  } else if (p.termStructure === 'self-paced') {
    block += '- Self-paced learning — no fixed term dates.\n';
  }

  // LMS
  if (p.lms && p.lms !== 'custom') {
    const lmsNames = { canvas: 'Canvas', blackboard: 'Blackboard', d2l: 'D2L Brightspace', moodle: 'Moodle' };
    block += `- LMS: ${lmsNames[p.lms] || p.lms}.\n`;
  }

  // Resources
  if (p.communityResources && p.communityResources.length > 0) {
    block += `- Community resources: ${p.communityResources.join(', ')}.\n`;
    block += `- For resources, prefer: official course materials > instructor tips > ${p.communityResources[0]} > YouTube study guides > Quizlet.\n`;
  }

  // Competency-based specific additions
  if (p.educationModel === 'competency-based') {
    block += '- Competency codes (e.g. C188.1.1) map to specific exam sections. Include these when enriching courses.\n';
    block += '- 1 CU ≈ 15-25 study hours typically, but varies widely by course.\n';
  }

  // Custom context from user
  if (p.customContext) {
    block += `- Additional context: ${p.customContext}\n`;
  }

  return block;
}

export function buildSystemPrompt(data, ctx = "") {
  const courses = data.courses || [];
  const active = courses.filter(c => c.status !== "completed");
  const done = courses.filter(c => c.status === "completed");
  const totalCU = courses.reduce((s,c)=>s+(c.credits||0),0);
  const doneCU = done.reduce((s,c)=>s+(c.credits||0),0);
  const remainCU = totalCU - doneCU;

  const uniObj = data.universityProfile; // structured object or legacy string or null
  const uniLabel = uniObj?.shortName || uniObj?.name || (typeof uniObj === 'string' && uniObj ? uniObj : 'their university');
  const creditLabel = uniObj?.creditUnitLabel || uniObj?.creditUnit || 'credits';

  const activeStr = active.length > 0 ? active.map((c,i) => fmtCtx(c,i,creditLabel)).join("\n\n") : "No remaining courses.";
  const doneStr = done.length > 0 ? done.map(c => `  ✅ ${c.name} (${c.credits} ${creditLabel})`).join("\n") : "None completed yet.";

  const exDates = safeArr(data.exceptionDates);
  const hrsPerDay = data.studyHoursPerDay || 4;
  const startDate = data.studyStartDate || todayStr();
  const earlyFinishDate = data.targetCompletionDate || "";

  // Derive start time from weekly availability (or fall back to legacy field)
  const derivedStartTime = data.plannerConfig
    ? deriveStartTimeFromAvailability(data.plannerConfig)
    : (data.studyStartTime || '08:00');

  // Calculate estimates for context
  const totalEstHours = active.reduce((s, c) => s + (c.averageStudyHours > 0 ? c.averageStudyHours : ([0,20,35,50,70,100][c.difficulty||3]||50)), 0);
  const rawDays = Math.ceil(totalEstHours / hrsPerDay);

  return `You are Vorra v${APP_VERSION}, an AI study & life planner and tutor for a student${uniObj ? ` at ${uniLabel}` : ""}.
Today: ${fmtDateLong(todayStr())}.

TOOLS AVAILABLE (always use tools for actions, never raw JSON):
- add_tasks: Schedule time-blocked tasks on specific dates
- add_courses: Add courses with deep context (deduplicates automatically)
- update_courses: Update course status/details by name match
- enrich_course_context: Generate comprehensive assessment intelligence for courses
- generate_study_plan: Create multi-day calendar with concrete study tasks

COURSE STUDY ORDER (user-prioritized, #1 = do first):
${activeStr}

COMPLETED:
${doneStr}

DEGREE STATS:
- Total: ${totalCU} ${creditLabel} | Completed: ${doneCU} ${creditLabel} | Remaining: ${remainCU} ${creditLabel} (${active.length} courses)
- Est. total study hours remaining: ~${totalEstHours}h (at current pace: ~${rawDays} study days)
- Study hours/day: ${hrsPerDay}h
- Study start: ${startDate} at ${derivedStartTime} | Target completion: ${earlyFinishDate || "Not set"} | Term end: ${data.targetDate || "Not set"}
- Exception dates (no studying): ${(() => {
    if (exDates.length === 0) return "None";
    if (exDates.length <= 10) return exDates.join(", ");
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const dayCounts = [0,0,0,0,0,0,0];
    exDates.forEach(dt => dayCounts[new Date(dt+"T12:00:00").getDay()]++);
    const recurringDays = dayCounts.map((c,i) => c >= 3 ? dayNames[i] : null).filter(Boolean);
    const nonRecurring = exDates.filter(dt => !recurringDays.includes(dayNames[new Date(dt+"T12:00:00").getDay()]));
    let desc = "";
    if (recurringDays.length > 0) desc += `Every ${recurringDays.join(" & ")} (${exDates.length - nonRecurring.length} dates)`;
    if (nonRecurring.length > 0) desc += (desc ? " + " : "") + nonRecurring.join(", ");
    return desc + ` — ${exDates.length} total`;
  })()}

IMPORTANT RULES:
- The course list ORDER reflects the user's chosen priority. Course #1 should be studied first. COMPLETE one course fully before starting the next. Do NOT mix courses on the same day (except transition days).
- When generating tasks with generate_study_plan, skip exception dates. Start from the study start date at ${derivedStartTime}.
- CATEGORY TAGS: "study" (new material), "review" (revision), "exam-prep" (practice tests), "exam-day" (actual assessment day), "project" (project/paper writing), "class" (live sessions), "break" (rest). Always schedule an "exam-day" task when a course ends.
- When enriching courses, include ALL fields: assessment type/details, competencies with weights, topic breakdown with weights, key terms, common mistakes, official+community resources, assessment tips, known focus areas, avg study hours, cert alignment, prerequisites. ALSO include study strategy fields: studyStrategy (recommended approach), quickWins (easy topics first), hardestConcepts (need extra focus), mnemonics (memory aids as {concept,mnemonic}), weeklyMilestones ({week,goals}), studyOrder (topic sequence), timeAllocation ({topic,percentage}), practiceTestNotes, instructorTips, communityInsights.
- When the user asks "what do I need to know to pass", use enrich_course_context with comprehensive data.
- add_courses deduplicates: if a course already exists, it merges instead of creating duplicates.
- The student can complete tasks early. If they do, remaining tasks shift forward. Keep tasks realistically sized (1-3 hour blocks with breaks).

RECENCY & ACCURACY:
- ALWAYS prioritize information from the last 3 months. Course content changes frequently — competencies, exam formats, question pools, and resources are regularly updated.
- When providing course context, resources, or tips, base them on the CURRENT version of the course. If you know the course was updated recently, mention this.
- For resources, prefer: official course materials > instructor tips > university community forums/subreddits (recent posts) > YouTube study guides (recent) > Quizlet sets.
- For assessment tips, prioritize what current students report: question types, time limits, passing scores, which topics are weighted heaviest, and common traps.
- DEEP DIVE: When enriching a course, be as comprehensive and granular as possible. Don't give vague summaries — provide specific competency/objective codes, exact topic names, concrete study hour estimates per topic, and actionable mnemonics. The student depends on this data to plan their study calendar.
- When generating study plans, account for topic difficulty and weight — harder/heavier topics get more hours. Front-load quick wins for momentum.

ACCURACY & SELF-VERIFICATION:
- Before providing specific facts (passing scores, question counts, time limits, competency codes), mentally verify: "Am I confident this is current? Could this have changed?" If uncertain, explicitly flag it: "This was accurate as of [date], but verify with your instructor or the course page."
- NEVER present uncertain information as definitive fact. If you're unsure about a specific detail, say so clearly — the student will verify. Wrong data is worse than no data because they'll study the wrong things.
- Cross-reference internally: if a topic weight says "high" but the competency description seems niche, re-examine. If study hours seem too low for the difficulty, adjust.
- When listing resources, only include ones you're confident still exist. Dead links and renamed resources waste the student's time.
- Distinguish between "what the university officially states" vs "what students commonly report" — both are valuable, but they should be labeled differently.
${universityContextBlock(uniObj)}${data.userContext ? `\nUSER PREFERENCES:\n${data.userContext}` : ""}
${ctx ? `\nCONTEXT:\n${ctx}` : ""}`;
}

// ----------------------------------------------------------------------
// AI LOOP HELPER
// ----------------------------------------------------------------------
export async function runAILoop(profile, sys, msgs, data, setData, executeTools, img = null, useStream = true) {
  if (typeof executeTools !== 'function') {
    dlog('error','api','runAILoop called without executeTools function — tool calls will not be processed');
  }
  dlog('info','api',`AI loop start (stream=${useStream})`);
  bgNewAbort(); // Create new AbortController for this operation
  const logs = [];
  let resp;
  const onChunk = useStream ? (text) => bgStream(text) : null;
  try {
    resp = useStream
      ? await callAIStream(profile, sys, msgs, img, onChunk)
      : await callAIWithTools(profile, sys, msgs, img);
  }
  catch (e) {
    if (e.message === 'Cancelled') return {logs:[{type:"error",content:"⛔ Cancelled"}],finalText:""};
    dlog('error','api','Initial call failed',e.message);
    return {logs:[{type:"error",content:e.message}],finalText:""};
  }
  const quirks = getProviderQuirks(profile);
  let loops = quirks.maxToolLoops || 5, finalText = "";
  while (loops-- > 0) {
    if (getBgState().abortCtrl?.signal?.aborted) { logs.push({type:"error",content:"⛔ Cancelled"}); break; }
    if (resp.text) { logs.push({type:"text",content:resp.text}); finalText += (finalText?" ":"") + resp.text; bgStream(""); }
    if (resp.toolCalls.length > 0) {
      for (const tc of resp.toolCalls) logs.push({type:"tool_call",content:`🔧 ${tc.name}(${JSON.stringify(tc.input).slice(0,300)})`});
      if (typeof executeTools !== 'function') {
        logs.push({type:"error",content:"Bug: executeTools not provided to runAILoop — tool calls cannot be processed. This is a coding error."});
        break;
      }
      const results = executeTools(resp.toolCalls, data, setData);
      for (const r of results) logs.push({type:"tool_result",content:`✅ ${r.result}`});
      try { resp = await continueAfterTools(profile, sys, msgs, resp.toolCalls, results); }
      catch (e) {
        if (e.message === 'Cancelled') { logs.push({type:"error",content:"⛔ Cancelled"}); break; }
        logs.push({type:"error",content:e.message}); break;
      }
    } else { break; }
  }
  if (resp.text && !finalText.includes(resp.text)) { logs.push({type:"text",content:resp.text}); finalText += " " + resp.text; }
  bgStream(""); bgSet({abortCtrl:null});
  return { logs, finalText };
}
