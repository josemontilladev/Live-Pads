// Textarea manipulation helpers used by the lyrics editor.

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
