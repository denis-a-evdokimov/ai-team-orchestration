function normalizedLines(markdown) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n');
}

function withoutBlankBoundaryLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') {
    start += 1;
  }
  while (end > start && lines[end - 1].trim() === '') {
    end -= 1;
  }
  return lines.slice(start, end).join('\n');
}

function fenceMarker(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) {
    return null;
  }
  if (match[1][0] === '`' && match[2].includes('`')) {
    return null;
  }
  return {
    character: match[1][0],
    info: match[2].trim(),
    length: match[1].length,
  };
}

function headingInfo(line) {
  const match = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
  return match ? { level: match[1].length, title: match[2] } : null;
}

function startsWithSpaces(line, count) {
  if (!Number.isSafeInteger(count) || count < 0 || count > line.length) {
    return false;
  }
  for (let index = 0; index < count; index += 1) {
    if (line[index] !== ' ') {
      return false;
    }
  }
  return true;
}

function isClosingFence(line, character, minimumLength) {
  let index = 0;
  while (index < 3 && line[index] === ' ') {
    index += 1;
  }
  let markerLength = 0;
  while (line[index] === character) {
    markerLength += 1;
    index += 1;
  }
  if (markerLength < minimumLength) {
    return false;
  }
  for (; index < line.length; index += 1) {
    if (line[index] !== ' ' && line[index] !== '\t') {
      return false;
    }
  }
  return true;
}

function containsClosingTag(line, tag) {
  return line.toLowerCase().includes(`</${tag.toLowerCase()}>`);
}

function containerView(line, continuationIndent = 0) {
  let content = line;
  let contained = false;

  while (true) {
    const blockquote = /^ {0,3}>[ \t]?/.exec(content);
    if (!blockquote) {
      break;
    }
    contained = true;
    content = content.slice(blockquote[0].length);
  }

  if (continuationIndent > 0 && startsWithSpaces(content, continuationIndent)) {
    contained = true;
    content = content.slice(continuationIndent);
  }

  let listIndent = 0;
  while (true) {
    const listItem = /^ {0,3}(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(content);
    if (!listItem) {
      break;
    }
    contained = true;
    const markerLength = listItem[0].length - listItem[1].length;
    const paddingLength = listItem[1].length <= 4 ? listItem[1].length : 1;
    const consumedLength = markerLength + paddingLength;
    listIndent += consumedLength;
    content = content.slice(consumedLength);
  }

  return { contained, content, listIndent };
}

function continuationView(line, state) {
  return state.contained
    ? containerView(line, state.continuationIndent)
    : { contained: false, content: line, listIndent: 0 };
}

function structuralLines(markdown) {
  const lines = normalizedLines(markdown);
  const result = [];
  let fence = null;
  let htmlComment = null;
  let rawHtmlTag = null;
  let rawHtmlUntilBlank = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (fence !== null) {
      const view = continuationView(lines[index], fence);
      const closing = isClosingFence(view.content, fence.character, fence.length);
      result.push({
        kind: fence.contained ? 'hidden' : 'code-fence',
        fenced: true,
        index,
        line: lines[index],
      });
      if (closing) {
        fence = null;
      }
      continue;
    }
    if (htmlComment !== null) {
      const view = continuationView(lines[index], htmlComment);
      result.push({ kind: 'hidden', fenced: true, index, line: lines[index] });
      if (view.content.includes('-->')) {
        htmlComment = null;
      }
      continue;
    }
    if (rawHtmlTag !== null) {
      const view = continuationView(lines[index], rawHtmlTag);
      result.push({ kind: 'hidden', fenced: true, index, line: lines[index] });
      if (containsClosingTag(view.content, rawHtmlTag.tag)) {
        rawHtmlTag = null;
      }
      continue;
    }
    if (rawHtmlUntilBlank !== null) {
      const view = continuationView(lines[index], rawHtmlUntilBlank);
      result.push({ kind: 'hidden', fenced: true, index, line: lines[index] });
      if (view.content.trim() === '') {
        rawHtmlUntilBlank = null;
      }
      continue;
    }
    const view = containerView(lines[index]);
    if (view.content.includes('<!--')) {
      result.push({ kind: 'hidden', fenced: true, index, line: lines[index] });
      if (!view.content.includes('-->', view.content.indexOf('<!--') + 4)) {
        htmlComment = {
          contained: view.contained,
          continuationIndent: view.listIndent,
        };
      }
      continue;
    }
    const rawHtml = /^ {0,3}<(script|style|pre|textarea|template)(?:\s|>)/i.exec(view.content);
    if (rawHtml) {
      result.push({ kind: 'hidden', fenced: true, index, line: lines[index] });
      if (!containsClosingTag(view.content, rawHtml[1])) {
        rawHtmlTag = {
          contained: view.contained,
          continuationIndent: view.listIndent,
          tag: rawHtml[1],
        };
      }
      continue;
    }
    if (/^ {0,3}<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>)/i.test(view.content)
      || /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^>]*)?>\s*$/.test(view.content)
      || /^ {0,3}<\?/.test(view.content)
      || /^ {0,3}<![A-Z]/.test(view.content)
      || /^ {0,3}<!\[CDATA\[/.test(view.content)) {
      result.push({ kind: 'hidden', fenced: true, index, line: lines[index] });
      rawHtmlUntilBlank = {
        contained: view.contained,
        continuationIndent: view.listIndent,
      };
      continue;
    }
    const marker = fenceMarker(view.content);
    if (marker) {
      fence = {
        ...marker,
        contained: view.contained,
        continuationIndent: view.listIndent,
      };
      result.push({
        kind: view.contained ? 'hidden' : 'code-fence',
        fenced: true,
        index,
        line: lines[index],
      });
      continue;
    }
    const indented = /^(?: {4}|\t)/.test(view.content);
    result.push({
      kind: indented ? 'indented-code' : 'visible',
      fenced: indented,
      index,
      line: lines[index],
    });
  }

  if (fence !== null) {
    throw new Error('Unterminated fenced block.');
  }
  if (htmlComment !== null) {
    throw new Error('Unterminated HTML comment.');
  }
  if (rawHtmlTag !== null) {
    throw new Error(`Unterminated raw HTML block <${rawHtmlTag.tag}>.`);
  }

  return { lines, structural: result };
}

export function extractUniqueSection(markdown, heading, level = 2) {
  const { lines, structural } = structuralLines(markdown);
  const matches = structural.filter((entry) => {
    if (entry.fenced) {
      return false;
    }
    const info = headingInfo(entry.line);
    return info?.level === level && info.title === heading;
  });

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one level-${level} section "${heading}"; found ${matches.length}.`);
  }

  const start = matches[0].index + 1;
  let end = lines.length;
  for (const entry of structural) {
    if (entry.index < start || entry.fenced) {
      continue;
    }
    const info = headingInfo(entry.line);
    if (info && info.level <= level) {
      end = entry.index;
      break;
    }
  }
  return withoutBlankBoundaryLines(lines.slice(start, end));
}

export function fencedBlocks(markdown, language = null) {
  const { structural } = structuralLines(markdown);
  const blocks = [];
  let current = null;

  for (const entry of structural) {
    const line = entry.line;
    const opening = entry.kind === 'code-fence' && /^[`~]/.test(line)
      ? fenceMarker(line)
      : null;
    if (current === null) {
      if (opening) {
        current = {
          length: opening.length,
          marker: opening.character,
          language: opening.info.split(/\s+/, 1)[0],
          lines: [],
        };
      }
      continue;
    }

    if (entry.kind !== 'code-fence') {
      throw new Error('Fenced block structure changed unexpectedly.');
    }
    const closing = isClosingFence(line, current.marker, current.length);
    if (closing) {
      blocks.push(current);
      current = null;
    } else {
      current.lines.push(line);
    }
  }

  if (current !== null) {
    throw new Error('Unterminated fenced block.');
  }

  return language === null
    ? blocks
    : blocks.filter((block) => block.language === language);
}

export function extractUniqueFence(markdown, language = null) {
  const matches = fencedBlocks(markdown, language);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${language ?? 'matching'} fenced block; found ${matches.length}.`);
  }
  return withoutBlankBoundaryLines(matches[0].lines);
}

export function documentPreamble(markdown) {
  const { structural } = structuralLines(markdown);
  const firstH2 = structural.find((entry) => {
    if (entry.fenced) {
      return false;
    }
    return headingInfo(entry.line)?.level === 2;
  });
  return withoutBlankBoundaryLines(structural
    .filter((entry) => !entry.fenced && entry.index < (firstH2?.index ?? Number.POSITIVE_INFINITY))
    .map((entry) => entry.line));
}

export function parseOrderedBlockquoteFields(markdown, expectedFields, expectedTitle) {
  const { structural } = structuralLines(markdown);
  const visible = structural.filter((entry) => !entry.fenced);
  let index = 0;
  while (index < visible.length && visible[index].line.trim() === '') {
    index += 1;
  }
  if (visible[index]?.line.trim() !== expectedTitle) {
    throw new Error(`Primary template must start with "${expectedTitle}".`);
  }
  index += 1;
  while (index < visible.length && visible[index].line.trim() === '') {
    index += 1;
  }

  const values = new Map();
  for (const expectedField of expectedFields) {
    const match = /^>\s+([^:]+):\s*(.+?)\s*$/.exec(visible[index]?.line ?? '');
    if (!match || match[1].trim() !== expectedField) {
      throw new Error(`Expected contiguous primary field "${expectedField}".`);
    }
    values.set(expectedField, match[2].trim());
    index += 1;
  }

  const allFieldCounts = new Map(expectedFields.map((field) => [field, 0]));
  for (const entry of visible) {
    const match = /^>\s+([^:]+):\s*(.+?)\s*$/.exec(entry.line);
    const field = match?.[1].trim();
    if (allFieldCounts.has(field)) {
      allFieldCounts.set(field, allFieldCounts.get(field) + 1);
    }
  }
  for (const [field, count] of allFieldCounts) {
    if (count !== 1) {
      throw new Error(`Primary field "${field}" must occur exactly once; found ${count}.`);
    }
  }
  return values;
}

function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

export function parseFirstTable(section) {
  const { structural } = structuralLines(section);
  const lines = structural.map((entry) => (entry.fenced ? '' : entry.line));
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = splitTableRow(lines[index]);
    const delimiter = splitTableRow(lines[index + 1]);
    if (!header || !delimiter
      || delimiter.length !== header.length
      || delimiter.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
      continue;
    }

    const rows = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const cells = splitTableRow(lines[rowIndex]);
      if (!cells || cells.length !== header.length) {
        break;
      }
      rows.push(cells);
    }
    return { header, rows };
  }
  throw new Error('Expected a Markdown table.');
}

export function uniqueRowsByFirstCell(table) {
  const rows = new Map();
  for (const row of table.rows) {
    const key = row[0];
    if (rows.has(key)) {
      throw new Error(`Duplicate table row "${key}".`);
    }
    rows.set(key, row);
  }
  return rows;
}

export function sectionHeadings(markdown, level = 2) {
  const { structural } = structuralLines(markdown);
  return structural
    .filter((entry) => !entry.fenced)
    .map((entry) => headingInfo(entry.line))
    .filter((info) => info?.level === level)
    .map((info) => info.title);
}

export function unfencedLines(markdown) {
  return structuralLines(markdown).structural
    .filter((entry) => !entry.fenced)
    .map((entry) => entry.line);
}

export function indentedCodeLines(markdown) {
  return normalizedLines(markdown)
    .filter((line) => /^(?: {4}|\t)/.test(line))
    .map((line) => line.replace(/^(?: {4}|\t)/, ''));
}
