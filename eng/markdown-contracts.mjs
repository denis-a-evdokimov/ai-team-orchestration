function normalizedLines(markdown) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n');
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

function structuralLines(markdown) {
  const lines = normalizedLines(markdown);
  const result = [];
  let fence = null;
  let htmlComment = false;
  let rawHtmlTag = null;
  let rawHtmlUntilBlank = false;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = fenceMarker(lines[index]);
    if (marker && fence === null) {
      fence = marker;
      result.push({ fenced: true, index, line: lines[index] });
      continue;
    }
    if (fence !== null) {
      const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`).exec(lines[index]);
      result.push({ fenced: true, index, line: lines[index] });
      if (closing) {
        fence = null;
      }
      continue;
    }
    if (htmlComment) {
      result.push({ fenced: true, index, line: lines[index] });
      if (lines[index].includes('-->')) {
        htmlComment = false;
      }
      continue;
    }
    if (rawHtmlTag !== null) {
      result.push({ fenced: true, index, line: lines[index] });
      if (new RegExp(`</${rawHtmlTag}>`, 'i').test(lines[index])) {
        rawHtmlTag = null;
      }
      continue;
    }
    if (rawHtmlUntilBlank) {
      result.push({ fenced: true, index, line: lines[index] });
      if (lines[index].trim() === '') {
        rawHtmlUntilBlank = false;
      }
      continue;
    }
    if (lines[index].includes('<!--')) {
      result.push({ fenced: true, index, line: lines[index] });
      if (!lines[index].includes('-->', lines[index].indexOf('<!--') + 4)) {
        htmlComment = true;
      }
      continue;
    }
    const rawHtml = /^ {0,3}<(script|style|pre|textarea|template)(?:\s|>)/i.exec(lines[index]);
    if (rawHtml) {
      result.push({ fenced: true, index, line: lines[index] });
      if (!new RegExp(`</${rawHtml[1]}>`, 'i').test(lines[index])) {
        rawHtmlTag = rawHtml[1];
      }
      continue;
    }
    if (/^ {0,3}<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>)/i.test(lines[index])
      || /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^>]*)?>\s*$/.test(lines[index])
      || /^ {0,3}<\?/.test(lines[index])
      || /^ {0,3}<![A-Z]/.test(lines[index])
      || /^ {0,3}<!\[CDATA\[/.test(lines[index])) {
      result.push({ fenced: true, index, line: lines[index] });
      rawHtmlUntilBlank = true;
      continue;
    }
    result.push({
      fenced: /^(?: {4}|\t)/.test(lines[index]),
      index,
      line: lines[index],
    });
  }

  if (fence !== null) {
    throw new Error('Unterminated fenced block.');
  }
  if (htmlComment) {
    throw new Error('Unterminated HTML comment.');
  }
  if (rawHtmlTag !== null) {
    throw new Error(`Unterminated raw HTML block <${rawHtmlTag}>.`);
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
  return lines.slice(start, end).join('\n').trim();
}

export function fencedBlocks(markdown, language = null) {
  const { structural } = structuralLines(markdown);
  const blocks = [];
  let current = null;

  for (const entry of structural) {
    const line = entry.line;
    const opening = entry.fenced ? fenceMarker(line) : null;
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

    const closing = new RegExp(`^ {0,3}${current.marker}{${current.length},}[ \\t]*$`).exec(line);
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
  return matches[0].lines.join('\n').trim();
}

export function documentPreamble(markdown) {
  const { lines, structural } = structuralLines(markdown);
  const firstH2 = structural.find((entry) => {
    if (entry.fenced) {
      return false;
    }
    return headingInfo(entry.line)?.level === 2;
  });
  return lines.slice(0, firstH2?.index ?? lines.length).join('\n').trim();
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
