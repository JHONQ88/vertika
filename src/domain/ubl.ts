import type { DocItem, Documento, Linea, Retencion, Tercero } from './types';

export interface FacturaXmlParseada {
  numero: string;
  fecha: string;
  emisor: string;
  nit: string;
  cufe?: string;
  subtotal: number;
  iva: number;
  total: number;
  descripcion: string;
  items: DocItem[];
  xmlOriginal: string;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripCdata(raw: string): string {
  const m = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : raw;
}

function extractFirstTag(xml: string, localName: string): string | undefined {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localName}>`, 'i');
  const match = xml.match(re);
  if (!match) return undefined;
  return decodeXmlEntities(stripCdata(match[1])).trim();
}

function extractTagWithAttr(
  xml: string,
  localName: string,
): { value: string; attrs: string } | undefined {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${localName}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localName}>`,
    'i',
  );
  const match = xml.match(re);
  if (!match) return undefined;
  return {
    attrs: match[1] ?? '',
    value: decodeXmlEntities(stripCdata(match[2])).trim(),
  };
}

function extractBlock(xml: string, localName: string): string | undefined {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localName}>`,
    'i',
  );
  const match = xml.match(re);
  return match ? match[1] : undefined;
}

function extractAllBlocks(xml: string, localName: string): string[] {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localName}>`,
    'gi',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null = re.exec(xml);
  while (m) {
    out.push(m[1]);
    m = re.exec(xml);
  }
  return out;
}

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  let cleaned = raw.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return 0;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot && cleaned.length - lastComma - 1 <= 2) {
    // Decimal comma (e.g. "1.500,50" or "1500,50")
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

const round100 = (n: number) => Math.round(n / 100) * 100;

/**
 * Unwraps a DIAN AttachedDocument XML to its inner UBL 2.1 <Invoice> or <CreditNote> if present.
 */
function unwrapAttachedInvoice(rawXml: string): string {
  if (!/AttachedDocument/i.test(rawXml)) return rawXml;
  const attachmentBlock = extractBlock(rawXml, 'Attachment');
  if (attachmentBlock) {
    const desc = extractFirstTag(attachmentBlock, 'Description');
    if (desc && /<(?:[a-zA-Z0-9_-]+:)?(?:Invoice|CreditNote)\b/i.test(desc)) {
      return desc;
    }
  }
  const cdataMatch = rawXml.match(
    /<!\[CDATA\[([\s\S]*?<(?:[a-zA-Z0-9_-]+:)?(?:Invoice|CreditNote)\b[\s\S]*?)\]\]>/i,
  );
  if (cdataMatch) return cdataMatch[1];
  return rawXml;
}

export function parsearFacturaXmlUbl(xmlText: string): FacturaXmlParseada {
  const trimmed = xmlText.trim();
  if (!trimmed.startsWith('<')) {
    throw new Error('El archivo no contiene XML válido.');
  }

  const invoiceXml = unwrapAttachedInvoice(trimmed);

  // Strip nested party, line, and extension blocks for top-level header & tax extraction
  const withoutLines = invoiceXml
    .replace(/<(?:[a-zA-Z0-9_-]+:)?InvoiceLine\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?InvoiceLine>/gi, '')
    .replace(/<(?:[a-zA-Z0-9_-]+:)?CreditNoteLine\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?CreditNoteLine>/gi, '');

  const headerOnly = withoutLines
    .replace(/<(?:[a-zA-Z0-9_-]+:)?AccountingSupplierParty\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?AccountingSupplierParty>/gi, '')
    .replace(/<(?:[a-zA-Z0-9_-]+:)?AccountingCustomerParty\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?AccountingCustomerParty>/gi, '')
    .replace(/<(?:[a-zA-Z0-9_-]+:)?UBLExtensions\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?UBLExtensions>/gi, '');

  const numero = extractFirstTag(headerOnly, 'ID') || 'FE-SIN-NUM';
  const rawFecha = extractFirstTag(headerOnly, 'IssueDate') || new Date().toISOString().slice(0, 10);
  const fecha = /^\d{4}-\d{2}-\d{2}/.test(rawFecha)
    ? rawFecha.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const cufe = extractFirstTag(headerOnly, 'UUID');

  const supplierBlock = extractBlock(invoiceXml, 'AccountingSupplierParty') ?? '';
  const emisor =
    extractFirstTag(supplierBlock, 'RegistrationName') ||
    extractFirstTag(supplierBlock, 'Name') ||
    'Proveedor externo';

  const companyIdTag = extractTagWithAttr(supplierBlock, 'CompanyID');
  let nit = companyIdTag?.value ?? '';
  if (companyIdTag) {
    const dvMatch = companyIdTag.attrs.match(/schemeID\s*=\s*["'](\d+)["']/i);
    if (dvMatch && nit && !nit.includes('-')) {
      nit = `${nit}-${dvMatch[1]}`;
    }
  }

  const monetaryBlock = extractBlock(withoutLines, 'LegalMonetaryTotal') ?? withoutLines;
  const subtotal = parseAmount(extractFirstTag(monetaryBlock, 'LineExtensionAmount'));
  const payable = parseAmount(extractFirstTag(monetaryBlock, 'PayableAmount'));

  // Extract document-level IVA (TaxScheme ID = '01' in DIAN UBL 2.1, or sole TaxTotal if scheme omitted)
  const taxBlocks = extractAllBlocks(withoutLines, 'TaxTotal');
  let iva = 0;
  let fallbackTax = 0;
  for (const tb of taxBlocks) {
    const amt = parseAmount(extractFirstTag(tb, 'TaxAmount'));
    if (amt <= 0) continue;
    const schemeBlock = extractBlock(tb, 'TaxScheme') ?? '';
    const schemeId = extractFirstTag(schemeBlock, 'ID');
    const schemeName = (extractFirstTag(schemeBlock, 'Name') ?? '').toUpperCase();
    if (schemeId === '01' || schemeName === 'IVA') {
      iva += amt;
    } else if (!schemeId && !schemeName && fallbackTax === 0) {
      fallbackTax = amt;
    }
  }
  if (iva === 0 && fallbackTax > 0) {
    iva = fallbackTax;
  }

  const total = payable > 0 ? payable : subtotal + iva;
  const finalSubtotal = subtotal > 0 ? subtotal : Math.max(0, total - iva);
  if (finalSubtotal <= 0 && total <= 0) {
    throw new Error('No se encontraron montos válidos (LineExtensionAmount / PayableAmount) en el XML.');
  }

  const lineBlocks = [
    ...extractAllBlocks(invoiceXml, 'InvoiceLine'),
    ...extractAllBlocks(invoiceXml, 'CreditNoteLine'),
  ];
  const items: DocItem[] = lineBlocks
    .map((lb) => {
      const desc = extractFirstTag(lb, 'Description') || 'Servicio / bien facturado';
      const qtyRaw =
        extractFirstTag(lb, 'InvoicedQuantity') || extractFirstTag(lb, 'CreditedQuantity');
      const cantidad = Math.max(1, Number(qtyRaw?.replace(/[^0-9.]/g, '') || 1));
      const priceBlock = extractBlock(lb, 'Price') ?? lb;
      const unitVal =
        parseAmount(extractFirstTag(priceBlock, 'PriceAmount')) ||
        Math.round(parseAmount(extractFirstTag(lb, 'LineExtensionAmount')) / cantidad);
      return { descripcion: desc, cantidad, valorUnitario: unitVal };
    })
    .filter((i) => i.valorUnitario > 0);

  if (items.length === 0) {
    items.push({ descripcion: `Factura ${numero}`, cantidad: 1, valorUnitario: finalSubtotal });
  }

  const descripcion = items[0]?.descripcion
    ? `${items[0].descripcion} · ${emisor}`
    : `Factura ${numero} · ${emisor}`;

  return {
    numero,
    fecha,
    emisor,
    nit: nit || 'Sin NIT',
    cufe,
    subtotal: finalSubtotal,
    iva,
    total,
    descripcion,
    items,
    xmlOriginal: trimmed,
  };
}

export function normalizarNitBase(nit: string): string {
  const withoutDv = nit.split('-')[0] ?? nit;
  return withoutDv.replace(/\D/g, '');
}

export function buscarTerceroPorNit(nit: string, terceros: Tercero[]): Tercero | undefined {
  const base = normalizarNitBase(nit);
  if (!base || base.length < 5) return undefined;
  return terceros.find((t) => normalizarNitBase(t.documento) === base);
}

export function sugerirCuentaGasto(texto: string): string {
  const s = texto.toLowerCase();
  if (/vigilancia|seguridad|celadur/.test(s)) return '513505';
  if (/aseo|limpieza|desinfecci/.test(s)) return '513510';
  if (/energ[ií]a|el[eé]ctric|enel|codensa/.test(s)) return '513525';
  if (/acueducto|agua|alcantarillado|eaab/.test(s)) return '513530';
  if (/gas\s*natural|vanti/.test(s)) return '513535';
  if (/internet|tel[eé]fono|comunicaci/.test(s)) return '513540';
  if (/ascensor|elevador/.test(s)) return '514505';
  if (/jard[ií]n|poda|zonas verdes/.test(s)) return '514515';
  if (/planta|bomba|mantenimiento|zonas comunes/.test(s)) return '514510';
  if (/seguro|p[oó]liza/.test(s)) return '513010';
  if (/honorario|contador|revisor|abogado|jur[ií]dic/.test(s)) return '511005';
  return '519510';
}

export function construirAsientoFactura(params: {
  cuentaGasto: string;
  descripcion: string;
  subtotal: number;
  iva: number;
  tercero?: Tercero;
  aplicarRetenciones: boolean;
  esDocumentoSoporte?: boolean;
}): { lineas: Linea[]; retenciones: Retencion[]; notas: string[] } {
  const subtotal = Math.max(0, Math.round(params.subtotal));
  const iva = Math.max(0, Math.round(params.iva));
  const total = subtotal + iva;
  const terceroId = params.tercero?.id;

  const retenciones: Retencion[] = [];
  const notas: string[] = [];

  if (params.aplicarRetenciones && params.tercero) {
    if (params.tercero.retefuentePct > 0 && subtotal > 0) {
      const valor = round100((subtotal * params.tercero.retefuentePct) / 100);
      if (valor > 0) {
        retenciones.push({
          nombre: `ReteFuente ${params.tercero.retefuentePct}%`,
          base: subtotal,
          tarifa: params.tercero.retefuentePct,
          valor,
          cuenta: '236540',
        });
      }
    }
    if (params.tercero.reteicaPct > 0 && subtotal > 0) {
      const valor = round100((subtotal * params.tercero.reteicaPct) / 100);
      if (valor > 0) {
        retenciones.push({
          nombre: `ReteICA ${params.tercero.reteicaPct}%`,
          base: subtotal,
          tarifa: params.tercero.reteicaPct,
          valor,
          cuenta: '236801',
        });
      }
    }
    if (params.tercero.reteivaPct > 0 && iva > 0) {
      const valor = round100((iva * params.tercero.reteivaPct) / 100);
      if (valor > 0) {
        retenciones.push({
          nombre: `ReteIVA ${params.tercero.reteivaPct}%`,
          base: iva,
          tarifa: params.tercero.reteivaPct,
          valor,
          cuenta: '236705',
        });
      }
    }
  }

  const totalRet = retenciones.reduce((acc, r) => acc + r.valor, 0);
  const netoPagar = Math.max(0, total - totalRet);

  const lineas: Linea[] = [
    {
      id: 'l-1',
      cuenta: params.cuentaGasto,
      descripcion: params.descripcion,
      debito: subtotal,
      credito: 0,
      terceroId,
    },
  ];

  if (iva > 0) {
    lineas.push({
      id: 'l-2',
      cuenta: '135515',
      descripcion: 'IVA descontable en compras/servicios',
      debito: iva,
      credito: 0,
      terceroId,
    });
  }

  lineas.push({
    id: `l-${lineas.length + 1}`,
    cuenta: '220505',
    descripcion: params.esDocumentoSoporte
      ? 'Cuenta por pagar documento soporte'
      : 'Proveedores nacionales',
    debito: 0,
    credito: netoPagar,
    terceroId,
  });

  for (const r of retenciones) {
    lineas.push({
      id: `l-${lineas.length + 1}`,
      cuenta: r.cuenta,
      descripcion: r.nombre,
      debito: 0,
      credito: r.valor,
      terceroId,
    });
  }

  if (retenciones.length > 0) {
    notas.push(
      `Retenciones calculadas automáticamente según perfil fiscal de ${params.tercero?.nombre ?? 'proveedor'}`,
    );
  } else {
    notas.push('Sin retenciones aplicadas; puedes ajustar con F6 · Acarreo IA o editar líneas.');
  }

  return { lineas, retenciones, notas };
}

export function construirDocumentoFactura(params: {
  clase: Documento['clase'];
  numero: string;
  emisor: string;
  nit: string;
  fecha: string;
  cufe?: string;
  items: DocItem[];
  subtotal: number;
  iva: number;
  retenciones: Retencion[];
  xml?: string;
}): Documento {
  return {
    clase: params.clase,
    numero: params.numero,
    emisor: params.emisor,
    nit: params.nit,
    fecha: params.fecha,
    cufe: params.cufe,
    items: params.items,
    subtotal: params.subtotal,
    iva: params.iva,
    total: params.subtotal + params.iva,
    retenciones: params.retenciones,
    xml: params.xml,
  };
}

export const EJEMPLO_XML_DIAN_UBL = `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ID>FE-EA-2026-4418</cbc:ID>
  <cbc:IssueDate>2026-11-22</cbc:IssueDate>
  <cac:Attachment>
    <cac:ExternalReference>
      <cbc:Description><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ID>FE-EA-2026-4418</cbc:ID>
  <cbc:UUID schemeName="CUFE-SHA384">9f8c2a1b7d4e603f8a91c5d2e7b4a0f1c6d8e2b5a9f3c7d1e4b8a2f6c0d9e3b7a1f5c8d2e6b9a3f7c1d4e8b2a5f9c3d7</cbc:UUID>
  <cbc:IssueDate>2026-11-22</cbc:IssueDate>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>Elevadores Andinos Ltda.</cbc:RegistrationName>
        <cbc:CompanyID schemeID="1">830112554</cbc:CompanyID>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">532000.00</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">2800000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">2800000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">3332000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">3332000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">2800000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>Mantenimiento preventivo mensual ascensores Torres A y B</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">1400000.00</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>]]></cbc:Description>
    </cac:ExternalReference>
  </cac:Attachment>
</AttachedDocument>`;
