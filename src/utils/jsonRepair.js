// Repair truncated/malformed JSON from AI tool call arguments
// Handles: unclosed brackets/braces, trailing commas, <think> tag contamination

export function repairTruncatedJSON(raw) {
  if (!raw || typeof raw !== 'string') return {};
  let fixed = raw;
  // Strip think tags that leaked into arguments
  fixed = fixed.replace(/<think>[\s\S]*?<\/think>/g, '');
  fixed = fixed.trim();
  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');
  // Close unclosed brackets/braces
  const opens = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
  const braces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
  for (let i = 0; i < opens; i++) fixed += ']';
  for (let i = 0; i < braces; i++) fixed += '}';
  return JSON.parse(fixed);
}
