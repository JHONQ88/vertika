import type { ReactNode } from 'react';

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key} style={{ fontWeight: 700 }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="mono"
          style={{
            background: 'rgba(15, 23, 42, 0.06)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: '1px 5px',
            fontSize: '0.9em',
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function parseAlignments(separatorLine: string): Array<'left' | 'center' | 'right'> {
  return splitTableRow(separatorLine).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function isNumericCell(text: string): boolean {
  const plain = text.replace(/\*\*/g, '').replace(/`/g, '').trim();
  return /^[-+]?\$?\s?[\d.,]+(\s?%|\s?\([DC]\))?$/.test(plain);
}

export function EveMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(
        <hr
          key={`hr-${i}`}
          style={{
            border: 'none',
            borderTop: '1px solid var(--line)',
            margin: '8px 0',
          }}
        />,
      );
      i += 1;
      continue;
    }

    // Heading (# .. ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const fontSize = level <= 2 ? 14.5 : level === 3 ? 13.5 : 13;
      blocks.push(
        <div
          key={`h-${i}`}
          style={{
            fontWeight: 700,
            fontSize,
            color: 'var(--ink-1)',
            marginTop: blocks.length === 0 ? 2 : 10,
            marginBottom: 4,
          }}
        >
          {renderInline(headingMatch[2], `h-${i}`)}
        </div>,
      );
      i += 1;
      continue;
    }

    // GFM Pipe Table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headerCells = splitTableRow(trimmed);
      const alignments = parseAlignments(lines[i + 1]);
      const rows: string[][] = [];
      const startIdx = i;
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }

      blocks.push(
        <div
          key={`tbl-${startIdx}`}
          style={{
            overflowX: 'auto',
            margin: '8px 0',
            border: '1px solid var(--line)',
            borderRadius: 8,
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12.2,
              lineHeight: 1.4,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--surface-2, #f1f5f9)' }}>
                {headerCells.map((cell, cIdx) => (
                  <th
                    key={cIdx}
                    style={{
                      textAlign: alignments[cIdx] ?? 'left',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--line)',
                      fontWeight: 700,
                      color: 'var(--ink-1)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {renderInline(cell, `th-${startIdx}-${cIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  style={{
                    borderTop: rIdx === 0 ? 'none' : '1px solid var(--line)',
                    background:
                      rIdx % 2 === 1 ? 'rgba(15, 23, 42, 0.018)' : 'transparent',
                  }}
                >
                  {headerCells.map((_, cIdx) => {
                    const cellText = row[cIdx] ?? '';
                    const align =
                      alignments[cIdx] && alignments[cIdx] !== 'left'
                        ? alignments[cIdx]
                        : isNumericCell(cellText)
                          ? 'right'
                          : 'left';
                    return (
                      <td
                        key={cIdx}
                        className={isNumericCell(cellText) ? 'mono' : undefined}
                        style={{
                          textAlign: align,
                          padding: '5px 8px',
                          verticalAlign: 'top',
                          whiteSpace: isNumericCell(cellText) ? 'nowrap' : 'normal',
                        }}
                      >
                        {renderInline(cellText, `td-${startIdx}-${rIdx}-${cIdx}`)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      const startIdx = i;
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul
          key={`ul-${startIdx}`}
          style={{
            margin: '4px 0 6px',
            paddingLeft: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul-${startIdx}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      const startIdx = i;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol
          key={`ol-${startIdx}`}
          style={{
            margin: '4px 0 6px',
            paddingLeft: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol-${startIdx}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph (group consecutive plain lines)
    const paraLines: string[] = [];
    const startIdx = i;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s+|[-*•]\s+|\d+\.\s+|-{3,}|\*{3,}|_{3,})/.test(lines[i].trim()) &&
      !(
        lines[i].trim().includes('|') &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1])
      )
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={`p-${startIdx}`} style={{ margin: '4px 0', wordBreak: 'break-word' }}>
        {renderInline(paraLines.join(' '), `p-${startIdx}`)}
      </p>,
    );
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{blocks}</div>;
}
