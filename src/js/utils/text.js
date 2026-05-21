// Textarea manipulation helpers used by the lyrics editor.

// GI.Setlist stores lyrics as HTML (`<p>line</p>`, `<p><br></p>` for blank
// lines). LivePads works with plain text + `\n`, so we flatten the markup on
// import. Plain-text lyrics (no tags) are returned untouched.
export function htmlToPlainLyrics(html) {
  if (!html || typeof html !== 'string') return html || '';
  if (!/<\/?[a-z][\s\S]*>/i.test(html)) return html;

  let text = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')          // <br> → newline
    .replace(/<\s*\/\s*(p|div|li)\s*>/gi, '\n')   // block close → newline
    .replace(/<\s*(p|div|li)[^>]*>/gi, '')        // block open → strip
    .replace(/<[^>]+>/g, '');                      // any remaining tags

  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'");

  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function wrapTextareaSelection(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);

  let replacement;
  if (before === '[' && after === ']') {
    // Intelligent chord wrapping: wrap each word individually, preserving
    // spacing, treating unified slash chords (e.g. F#/E) as a single chord.
    replacement = selected.replace(/[^\s\[\]]+/g, match => '[' + match + ']');
  } else {
    replacement = before + selected + after;
  }

  const savedScrollTop = textarea.scrollTop;
  const savedScrollLeft = textarea.scrollLeft;

  textarea.value = text.substring(0, start) + replacement + text.substring(end);

  textarea.focus();
  if (before === '[' && after === ']') {
    textarea.selectionStart = start;
    textarea.selectionEnd = start + replacement.length;
  } else {
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = start + before.length + selected.length;
  }

  textarea.scrollTop = savedScrollTop;
  textarea.scrollLeft = savedScrollLeft;

  textarea.dispatchEvent(new Event('input'));
}

export function insertTextAtCursor(textarea, textToInsert) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;

  let prefix = '';
  if (start > 0 && text[start - 1] !== '\n') {
    prefix = '\n';
  }

  const replacement = prefix + textToInsert + '\n';

  const savedScrollTop = textarea.scrollTop;
  const savedScrollLeft = textarea.scrollLeft;

  textarea.value = text.substring(0, start) + replacement + text.substring(end);

  textarea.focus();
  const newCursorPos = start + replacement.length;
  textarea.selectionStart = newCursorPos;
  textarea.selectionEnd = newCursorPos;

  textarea.scrollTop = savedScrollTop;
  textarea.scrollLeft = savedScrollLeft;

  textarea.dispatchEvent(new Event('input'));
}
