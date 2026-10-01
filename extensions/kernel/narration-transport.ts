/** Decode a complete JSON string envelope, never rewrite literal prose or individual escapes. */
export function narrationTransport(text: string): {text: string; malformed?: true} {
  const body = text.trim();
  if (!body.startsWith('"') || !body.includes('\\')) return {text};
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === 'string' ? {text:value} : {text};
  } catch { /* A raw prose string need not be JSON. */ }
  if (body.endsWith('}')) {
    try {
      if (typeof JSON.parse(body.slice(0,-1)) === 'string') return {text, malformed:true};
    } catch { /* Not the closed, observed field-fragment shape. */ }
  }
  return {text};
}
